/**
 * GPU-backed canvases (enableHWA, the default) against CPU-backed ones: how
 * long the main thread is blocked and how much memory the browser holds while
 * a document opens, scrolls, zooms in, and pans. Memory is the macOS physical
 * footprint (`footprint`), which counts the IOSurfaces GPU canvases live in,
 * summed over every process of a browser launched for the job alone, less
 * what Playwright processes left before it (WebKit's helpers belong to
 * launchd, so turn-taking does not see another run's).
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   node examples/prototype/scripts/hwa-bench.ts
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS (pdfjs-cpu,pdfjs-hwa,
 * pdfjs-next-cpu,pdfjs-next-hwa), FILES (bill-hr815.pdf,synthetic-vector-200k.pdf), RUNS (3),
 * OUTPUT (hwa-<browser>).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTaking,
  turnTakingSummary,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const browserName = browserFromEnv();
const variants = [
  { name: "pdfjs-cpu", engine: "pdfjs", hwa: false },
  { name: "pdfjs-hwa", engine: "pdfjs", hwa: true },
  { name: "pdfjs-next-cpu", engine: "pdfjs-next", hwa: false },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next", hwa: true },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
const files = (process.env.FILES ?? "bill-hr815.pdf,synthetic-vector-200k.pdf").split(",");
const runs = Number(process.env.RUNS ?? "3");
const output = process.env.OUTPUT ?? `hwa-${browserName}`;

interface JobResult {
  file: string;
  variant: string;
  run: number;
  /** Milliseconds from navigation until the first page was sharp. */
  sharpMs: number;
  blockedMs: number;
  maxLagMs: number;
  dropped: number;
  /** Footprint of all the browser's processes after opening, and at the end. */
  openMiB: number;
  endMiB: number;
  /** The sum of each process's own peak footprint during the job. */
  peakMiB: number;
  canvasMiB: number;
  error?: string;
}

/** Physical footprint of every Playwright browser process, now and at each one's peak, in MiB. */
function browserFootprint(): { current: number; peak: number } {
  const pids = execFileSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes("ms-playwright"))
    .map((line) => line.trim().split(/\s+/, 1)[0] ?? "")
    .filter(Boolean);
  if (pids.length === 0) return { current: 0, peak: 0 };
  const text = execFileSync(
    "footprint",
    ["--noCategories", "-f", "bytes", ...pids.flatMap((pid) => ["-p", pid])],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const sum = (pattern: RegExp) =>
    [...text.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0) / 2 ** 20;
  return {
    current: sum(/\[\d+\]:.*Footprint: (\d+) B/g),
    peak: sum(/phys_footprint_peak: (\d+) B/g),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the visible pages are sharp and stayed sharp for 300 ms (at most 15 s). */
const settle = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const viewer = (window as unknown as { __viewer?: { sharpness(): number } }).__viewer;
        const holder = window as unknown as { __sharpSince?: number | null };
        if (!viewer || viewer.sharpness() < 0.99) {
          holder.__sharpSince = null;
          return false;
        }
        holder.__sharpSince ??= performance.now();
        return performance.now() - holder.__sharpSince > 300;
      },
      null,
      { timeout: 15_000, polling: 50 },
    )
    .catch(() => {});

async function measure(
  page: Page,
  baseUrl: string,
  file: string,
  variant: (typeof variants)[number],
  before: { current: number; peak: number },
) {
  await page.goto(`${baseUrl}?engine=${variant.engine}&hwa=${variant.hwa ? 1 : 0}&file=${file}`);
  const sharpMs = (await (
    await page.waitForFunction(
      () => {
        const viewer = (
          window as unknown as { __viewer?: { firstPaintAt: number | null; sharpness(): number } }
        ).__viewer;
        return viewer?.firstPaintAt != null && viewer.sharpness() >= 0.99
          ? performance.now()
          : false;
      },
      null,
      { timeout: 30_000, polling: "raf" },
    )
  ).jsonValue()) as number;
  await sleep(1000);
  const open = browserFootprint();
  // Timer lateness beyond the idle page's 95th percentile (at least 2 ms) counts as blocked.
  const result = await page.evaluate(async () => {
    const viewer = (
      window as unknown as {
        __viewer: { scroller: HTMLElement; setScale(scale: number): void; sharpness(): number };
      }
    ).__viewer;
    const scroller = viewer.scroller;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const idle: number[] = [];
    let expected = performance.now() + 4;
    await new Promise<void>((resolve) => {
      const until = performance.now() + 1000;
      const tick = () => {
        const now = performance.now();
        idle.push(Math.max(0, now - expected));
        expected = now + 4;
        if (now < until) setTimeout(tick, 4);
        else resolve();
      };
      setTimeout(tick, 4);
    });
    idle.sort((a, b) => a - b);
    const threshold = Math.max(2, idle[Math.floor(idle.length * 0.95)] ?? 0);
    const lags: number[] = [];
    const frames: number[] = [];
    let running = true;
    expected = performance.now() + 4;
    const tick = () => {
      const now = performance.now();
      lags.push(Math.max(0, now - expected));
      expected = now + 4;
      if (running) setTimeout(tick, 4);
    };
    setTimeout(tick, 4);
    let last = await frame();
    const countFrames = (now: number) => {
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(countFrames);
    };
    requestAnimationFrame(countFrames);
    const waitSharp = async () => {
      const until = performance.now() + 8000;
      let since: number | null = null;
      while (performance.now() < until) {
        const now = await frame();
        if (viewer.sharpness() >= 0.99) {
          since ??= now;
          if (now - since > 300) return;
        } else since = null;
      }
    };
    // Scroll at 900 CSS pixels per second for three seconds.
    let start = await frame();
    let previous = start;
    for (;;) {
      const now = await frame();
      scroller.scrollTop += (900 * (now - previous)) / 1000;
      previous = now;
      if (now - start > 3000) break;
    }
    await waitSharp();
    // Zoom to 3 CSS pixels per point, then pan four times by 60% of the viewport.
    viewer.setScale(3);
    await waitSharp();
    for (const [dx, dy] of [
      [0.6, 0],
      [0, 0.6],
      [-0.6, 0],
      [0, -0.6],
    ] as const) {
      start = await frame();
      const fromX = scroller.scrollLeft;
      const fromY = scroller.scrollTop;
      for (;;) {
        const now = await frame();
        const t = Math.min(1, (now - start) / 300);
        scroller.scrollLeft = fromX + dx * scroller.clientWidth * t;
        scroller.scrollTop = fromY + dy * scroller.clientHeight * t;
        if (t >= 1) break;
      }
      await waitSharp();
    }
    running = false;
    let canvasBytes = 0;
    for (const canvas of document.querySelectorAll("canvas")) {
      canvasBytes += canvas.width * canvas.height * 4;
    }
    return {
      blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - threshold), 0),
      maxLagMs: Math.max(0, ...lags),
      dropped: frames.filter((interval) => interval > 25).length,
      canvasMiB: canvasBytes / 2 ** 20,
    };
  });
  await settle(page);
  const end = browserFootprint();
  return {
    sharpMs,
    ...result,
    openMiB: open.current - before.current,
    endMiB: end.current - before.current,
    peakMiB: end.peak - before.peak,
  };
}

const power = assertMeasurementPower();
const loadAtStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4180, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4180/";
const results: JobResult[] = [];
let label = browserName as string;
try {
  for (const file of files) {
    for (let run = 0; run < runs; run++) {
      // Rotate the variants' order so that load changing over a run hits them alike.
      const order = variants.map((_, i) => variants[(i + run) % variants.length]);
      for (const variant of order) {
        if (!variant) continue;
        // A browser of its own per job, so footprints and their peaks belong to this job alone.
        const before = browserFootprint();
        const launched = await launchBrowser(browserName);
        label = launched.label;
        try {
          const result = await measureInTurn(launched, async (browser): Promise<JobResult> => {
            const context = await browser.newContext({
              viewport: { width: 1280, height: 900 },
              deviceScaleFactor: 2,
            });
            try {
              const page = await context.newPage();
              await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
              return {
                file,
                variant: variant.name,
                run,
                ...(await measure(page, baseUrl, file, variant, before)),
              };
            } catch (error) {
              return {
                file,
                variant: variant.name,
                run,
                sharpMs: Number.NaN,
                blockedMs: Number.NaN,
                maxLagMs: Number.NaN,
                dropped: Number.NaN,
                openMiB: Number.NaN,
                endMiB: Number.NaN,
                peakMiB: Number.NaN,
                canvasMiB: Number.NaN,
                error: String(error),
              };
            } finally {
              await context.close();
            }
          });
          results.push(result);
          console.log(
            `${file} ${variant.name} run ${run + 1}: ${
              result.error
                ? `ERROR ${result.error.split("\n")[0]}`
                : `sharp ${result.sharpMs.toFixed(0)} ms, blocked ${result.blockedMs.toFixed(0)} ms, footprint ${result.endMiB.toFixed(0)} MiB (peaks ${result.peakMiB.toFixed(0)}), canvases ${result.canvasMiB.toFixed(0)} MiB`
            }`,
          );
        } finally {
          await launched.close();
        }
        // Let the closed browser's processes exit before the next one measures.
        for (let wait = 0; wait < 50 && browserFootprint().current > 0; wait++) await sleep(100);
      }
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
const keys = [
  "sharpMs",
  "blockedMs",
  "maxLagMs",
  "dropped",
  "openMiB",
  "endMiB",
  "peakMiB",
  "canvasMiB",
] as const;
const summaries = files.flatMap((file) =>
  variants.map((variant) => {
    const ok = results.filter((r) => r.file === file && r.variant === variant.name && !r.error);
    return {
      file,
      variant: variant.name,
      runs: ok.length,
      ...Object.fromEntries(keys.map((key) => [key, median(ok.map((r) => r[key]))])),
    } as { file: string; variant: string; runs: number } & Record<(typeof keys)[number], number>;
  }),
);

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: label,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  settings: { files, runs, viewport: "1280×900 at devicePixelRatio 2" },
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value;
mkdirSync(join(resultsDir, "raw"), { recursive: true });
writeFileSync(
  join(resultsDir, "raw", `${output}-${environment.runAt.replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ environment, results }, round, 2),
);
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, summaries }, round, 2)}\n`,
);

const fmt = (value: number, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "—");
const markdown = [
  `# ParaPDF runtime prototype: GPU-backed canvases, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}; not comparable with AC runs**`}`,
  `- One-minute load average: ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end, on ${cpus().length} cores. The run ${turnTakingSummary()}.`,
  `- Method: each job launches its own browser and opens the file at fit width in a 1280×900 viewport at devicePixelRatio 2. Once the first page is sharp and a second has passed, it scrolls at 900 CSS pixels per second for 3 seconds, zooms to 3 CSS pixels per point, and pans four times by 60% of the viewport, waiting each time until the view is sharp (at most 8 seconds). \`-cpu\` variants pass \`hwa=0\` (enableHWA false), \`-hwa\` ones \`hwa=1\`. Median of ${runs} runs, variants in rotating order.`,
  "- Blocked: summed lateness of a 4 ms timer chain beyond the idle page's 95th percentile (at least 2 ms), from the start of the scroll to the end of the last pan. Dropped: animation frames longer than 25 ms.",
  "- Footprint: the macOS physical footprint (`footprint`) of every process of the job's browser, which includes the IOSurfaces that GPU-backed canvases live in: after opening, at the end, and the sum of each process's own peak during the job, less what Playwright processes left before the job. Canvases: width × height × 4 bytes of every canvas in the document at the end.",
  `- Reproduce: \`pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=${browserName} node examples/prototype/scripts/hwa-bench.ts\``,
  "",
  "| File | Variant | Sharp (ms) | Blocked (ms) | Longest lag (ms) | Dropped frames | Footprint open / end / peaks (MiB) | Canvases (MiB) |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...summaries.map(
    (s) =>
      `| ${s.file} | ${s.variant} | ${fmt(s.sharpMs)} | ${fmt(s.blockedMs)} | ${fmt(s.maxLagMs)} | ${fmt(s.dropped)} | ${fmt(s.openMiB)} / ${fmt(s.endMiB)} / ${fmt(s.peakMiB)} | ${fmt(s.canvasMiB)} |`,
  ),
  "",
];
writeFileSync(join(resultsDir, `${output}.md`), markdown.join("\n"));
console.log(markdown.join("\n"));
