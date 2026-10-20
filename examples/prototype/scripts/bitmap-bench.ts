/**
 * Bitmap display benchmark: main-thread cost of showing worker-made page
 * bitmaps, apart from any rendering. bitmaps.html gets page-sized bitmaps
 * from a worker in one of several ways and shows them on page canvases in a
 * scroll container: while a page is visible, while it is below the viewport,
 * on its first and later trips into the viewport, during a back-and-forth
 * scroll, and when its canvas is released. Writes results/<OUTPUT>.{md,json}.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/bitmap-bench.ts
 * Environment: BROWSERS (firefox,chromium,webkit), COMBOS (make+show pairs, see
 * `combos`), RUNS (3), PAGES (4), SIZE (device pixels, 2512x3690: page 1 of
 * patent-us223898.pdf at the demo's fit-width zoom and devicePixelRatio 2),
 * SCROLL_SPEED (CSS px/s, 1800), OUTPUT (bitmaps), MAX_LOAD (half the logical
 * cores). Like hybrid-bench.ts, each job waits until no other Playwright
 * browser is open and the load average is at most MAX_LOAD, and is repeated
 * if another Playwright browser started meanwhile.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import {
  assertMeasurementPower,
  type BrowserName,
  browserNames,
  launchBrowser,
} from "../../../bench/scripts/browsers.ts";
import type { BitmapBenchConfig, BitmapBenchResult, BitmapEvent } from "../src/bitmaps.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const requested = (process.env.BROWSERS ?? "firefox,chromium,webkit").split(",");
const browsers = browserNames.filter((name) => requested.includes(name));
const combos = (
  process.env.COMBOS ??
  [
    // The hybrid engine today.
    "imagedata+bitmaprenderer",
    "imagedata+2d",
    "offscreen+bitmaprenderer",
    // pdf.js's renderer worker and drawFrame().
    "offscreen+2d",
    "pixels+putimagedata",
    // Canvases handed to the worker with transferControlToOffscreen().
    "imagedata+worker-2d",
    "imagedata+worker-bitmaprenderer",
  ].join(",")
).split(",");
const runs = Number(process.env.RUNS ?? "3");
const [width = 2512, height = 3690] = (process.env.SIZE ?? "2512x3690").split("x").map(Number);
const pages = Number(process.env.PAGES ?? "4");
const scrollSpeed = Number(process.env.SCROLL_SPEED ?? "1800");
const output = process.env.OUTPUT ?? "bitmaps";
const maxLoad = Number(process.env.MAX_LOAD ?? String(cpus().length / 2));

/** Playwright browsers started by other processes; see hybrid-bench.ts. */
function foreignBrowsers(): string[] {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 2 ** 20,
  })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, command = ""]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const ours = (pid: number) => {
    for (let at = pid, depth = 0; at > 1 && depth < 50; at = parent.get(at) ?? 0, depth++) {
      if (at === process.pid) return true;
    }
    return false;
  };
  const browserMain = (command: string) =>
    (/ms-playwright\/chromium/.test(command) && !command.includes("--type=")) ||
    (/ms-playwright\/firefox/.test(command) && !command.includes("-contentproc")) ||
    (/ms-playwright\/webkit/.test(command) && !command.includes("com.apple.WebKit."));
  const driver = (command: string) => /@playwright\/test|playwright(-core)?\/cli\.js/.test(command);
  return rows
    .filter((row) => (browserMain(row.command) || driver(row.command)) && !ours(row.pid))
    .map((row) => `${row.pid} ${row.command.slice(0, 140)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForQuietMachine(): Promise<void> {
  if (process.env.ALLOW_PARALLEL) return;
  let reported = "";
  for (const start = Date.now(); ; ) {
    const foreign = foreignBrowsers();
    const [load = 0] = loadavg();
    if (foreign.length === 0 && load <= maxLoad) return;
    const reason = foreign.length
      ? `other Playwright browsers are open:\n  ${foreign.join("\n  ")}`
      : `the load average is ${load.toFixed(1)}, above ${maxLoad}`;
    if (Date.now() - start > 4 * 60 * 60_000) throw new Error(`gave up after 4 hours: ${reason}`);
    const minute = Math.floor((Date.now() - start) / 300_000);
    if (`${reason.split(":")[0]}${minute}` !== reported) {
      reported = `${reason.split(":")[0]}${minute}`;
      console.log(`Waiting: ${reason}`);
    }
    await sleep(15_000);
  }
}

interface Job {
  browser: string;
  name: BrowserName;
  combo: string;
  run: number;
  load: number;
  error?: string;
  result?: BitmapBenchResult;
}

assertMeasurementPower();
await waitForQuietMachine();
const power = assertMeasurementPower();
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { host: "127.0.0.1", port: 4188, strictPort: true, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4188/";
const jobs: Job[] = [];
try {
  for (const name of browsers) {
    await waitForQuietMachine();
    const launched = await launchBrowser(name, { deviceScaleFactor: 2 });
    const runJob = async (combo: string, run: number): Promise<Job> => {
      const [make, show] = combo.split("+") as [
        BitmapBenchConfig["make"],
        BitmapBenchConfig["show"],
      ];
      const config: BitmapBenchConfig = {
        make,
        show,
        pages,
        width,
        height,
        scrollSpeed,
        scrollMs: 4000,
        windowMs: 700,
      };
      const job: Job = { browser: launched.label, name, combo, run, load: loadavg()[0] ?? 0 };
      const context = await launched.browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 2,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}bitmaps.html`);
        await page.waitForFunction(() => window.__ready === true);
        const result = await page.evaluate(
          (config) =>
            (window.__runBitmapBench as NonNullable<typeof window.__runBitmapBench>)(config),
          config,
        );
        if (result.devicePixelRatio !== 2)
          job.error = `devicePixelRatio ${result.devicePixelRatio}`;
        else if (!result.crossOriginIsolated) job.error = "not cross-origin isolated";
        job.result = result;
      } catch (error) {
        job.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
      } finally {
        await context.close();
      }
      return job;
    };
    try {
      // One discarded job warms the browser's GPU process.
      await runJob(combos[0] ?? "imagedata+bitmaprenderer", -1);
      for (let run = 0; run < runs; run++) {
        // Alternate the order so drift affects every combination alike.
        for (const combo of run % 2 ? [...combos].reverse() : combos) {
          let job: Job | undefined;
          for (let attempt = 0; attempt < 10 && !job; attempt++) {
            await waitForQuietMachine();
            assertMeasurementPower();
            const candidate = await runJob(combo, run);
            if (process.env.ALLOW_PARALLEL || foreignBrowsers().length === 0) job = candidate;
            else console.log("Another Playwright browser started during the job; repeating it.");
          }
          if (!job) throw new Error("other Playwright browsers kept overlapping the jobs");
          jobs.push(job);
          const r = job.result;
          console.log(
            `${launched.label} · ${combo} · run ${run + 1}/${runs}: ${
              job.error
                ? `ERROR ${job.error}`
                : `scroll blocked ${r?.scroll.blockedMs.toFixed(0)} ms, total blocked ${r?.totalBlockedMs.toFixed(0)} ms`
            }`,
          );
        }
      }
    } finally {
      await launched.close();
    }
  }
} finally {
  await server.close();
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const fmt = (value: number, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

/** Per job, the median over the matching events; then the median over jobs. */
const eventCell = (
  subset: Job[],
  match: (event: BitmapEvent) => boolean,
  read: (event: BitmapEvent) => number,
) => median(subset.map((job) => median((job.result?.events ?? []).filter(match).map(read))));

const groups = {
  "deliver, visible": (event: BitmapEvent) => event.kind === "deliver" && event.visible,
  "deliver, below": (event: BitmapEvent) => event.kind === "deliver" && !event.visible,
  "first reveal": (event: BitmapEvent) => event.kind === "reveal",
  revisit: (event: BitmapEvent) => event.kind === "revisit",
  release: (event: BitmapEvent) => event.kind === "release",
};

const ok = jobs.filter((job) => !job.error && job.result);
const summary = browsers.flatMap((name) =>
  combos.map((combo) => {
    const subset = ok.filter((job) => job.name === name && job.combo === combo);
    return {
      browser: subset[0]?.browser ?? name,
      combo,
      jobs: subset.length,
      deliverCallMs: eventCell(subset, groups["deliver, visible"], (event) => event.callMs),
      workerMs: eventCell(
        subset,
        (event) => event.kind === "deliver",
        (event) => event.workerMs ?? Number.NaN,
      ),
      events: Object.fromEntries(
        Object.entries(groups).map(([label, match]) => [
          label,
          {
            blockedMs: eventCell(subset, match, (event) => event.blockedMs),
            maxLagMs: eventCell(subset, match, (event) => event.maxLagMs),
            twoFramesMs: eventCell(subset, match, (event) => event.twoFramesMs),
            droppedFrames: eventCell(subset, match, (event) => event.droppedFrames),
          },
        ]),
      ),
      scroll: {
        blockedMs: median(subset.map((job) => job.result?.scroll.blockedMs ?? Number.NaN)),
        maxLagMs: median(subset.map((job) => job.result?.scroll.maxLagMs ?? Number.NaN)),
        droppedFrames: median(subset.map((job) => job.result?.scroll.droppedFrames ?? Number.NaN)),
        frames: median(subset.map((job) => job.result?.scroll.frames ?? Number.NaN)),
      },
      totalBlockedMs: median(subset.map((job) => job.result?.totalBlockedMs ?? Number.NaN)),
    };
  }),
);

const runAt = new Date().toISOString();
const environment = {
  runAt,
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  power,
  load: {
    median: median(jobs.map((job) => job.load)),
    max: Math.max(...jobs.map((job) => job.load)),
  },
  settings: { runs, pages, width, height, scrollSpeed, viewport: "1280x900", devicePixelRatio: 2 },
  errors: jobs.filter((job) => job.error).map((job) => `${job.browser} ${job.combo}: ${job.error}`),
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
mkdirSync(join(resultsDir, "raw"), { recursive: true });
writeFileSync(
  join(resultsDir, "raw", `${output}-${runAt.replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ environment, jobs }, round, 2),
);
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, summary }, round, 2)}\n`,
);

const eventColumns = Object.keys(groups);
const markdown = [
  "# ParaPDF bitmap display benchmark",
  "",
  `- Run at: ${runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; Playwright's headless browsers; power: ${power.source}${power.lowPowerMode ? ", Low Power Mode" : ""}; load at job start ${fmt(environment.load.median, 1)} (median), ${fmt(environment.load.max, 1)} at most.`,
  `- Method: bitmaps.html at 1280×900 and devicePixelRatio 2, fresh context per job, ${runs} runs per combination in alternating order. A worker makes ${pages} opaque ${width}×${height} bitmaps (grey noise; ${((width * height) / 1e6).toFixed(1)} MP, ${((width * height * 4) / 2 ** 20).toFixed(0)} MiB of RGBA) and the page shows each on its own page canvas: page 1 while it is visible, the others while they are below the viewport. Then each other page is scrolled into view (first reveal), pages 1 and 2 again (revisit), all pages are scrolled back and forth for 4 s at ${scrollSpeed} CSS px/s with nothing new to show, and the canvases are released (width and height 0). Each event's numbers cover 700 ms from its start; blocked counts 4 ms timer lateness beyond 2 ms or the idle 95th percentile, as in the scroll benchmark.`,
  "- Make: `imagedata` is createImageBitmap(new ImageData(...)) in the worker (the hybrid engine), `offscreen` is putImageData on an opaque 2D OffscreenCanvas and transferToImageBitmap() (pdf.js's renderer worker), `pixels` transfers the RGBA buffer. Show: `bitmaprenderer` is transferFromImageBitmap(), `2d` is drawImage() on an opaque 2D context (pdf.js's drawFrame), `putimagedata` puts the raw pixels, and `worker-*` canvases were handed to the worker with transferControlToOffscreen(), which draws into them itself.",
  "- Reproduce: `pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/bitmap-bench.ts`",
  ...(environment.errors.length ? ["", "Errors:", ...environment.errors.map((e) => `- ${e}`)] : []),
  "",
  "## Blocked / longest stall per event (ms, median)",
  "",
  `| Browser | Make + show | Show call (ms) | ${eventColumns.join(" | ")} | Scroll 4 s: blocked / stall / dropped frames | Total blocked |`,
  `|---|---|---:|${eventColumns.map(() => "---:").join("|")}|---:|---:|`,
  ...summary.map(
    (row) =>
      `| ${row.browser} | ${row.combo} | ${fmt(row.deliverCallMs, 1)} | ${eventColumns
        .map((label) => {
          const cell = row.events[label] as { blockedMs: number; maxLagMs: number };
          return `${fmt(cell.blockedMs)} / ${fmt(cell.maxLagMs, 1)}`;
        })
        .join(
          " | ",
        )} | ${fmt(row.scroll.blockedMs)} / ${fmt(row.scroll.maxLagMs, 1)} / ${fmt(row.scroll.droppedFrames)} of ${fmt(row.scroll.frames)} | ${fmt(row.totalBlockedMs)} |`,
  ),
  "",
  "## Until the second animation frame after each event (ms, median)",
  "",
  `| Browser | Make + show | Worker (ms) | ${eventColumns.join(" | ")} |`,
  `|---|---|---:|${eventColumns.map(() => "---:").join("|")}|`,
  ...summary.map(
    (row) =>
      `| ${row.browser} | ${row.combo} | ${fmt(row.workerMs, 1)} | ${eventColumns
        .map((label) => fmt((row.events[label] as { twoFramesMs: number }).twoFramesMs, 1))
        .join(" | ")} |`,
  ),
  "",
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
