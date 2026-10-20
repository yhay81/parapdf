/**
 * Scripted scroll benchmark for the runtime prototype. Each job measures the
 * browser's idle baseline on calibrate.html, opens the demo in the same fresh
 * page at devicePixelRatio 2, waits for the first page, scrolls at a constant
 * speed along the direction pages follow each other, and records blank area,
 * main-thread lag, dropped frames, React commits, the store's window and
 * current-page changes, and render counts.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS, TEXT and LINKS (1, 0, or 1,0),
 * SCROLL (scroll modes: vertical, horizontal, wrapped, or a list; vertical), SCALE (fit-width,
 * fit-page, CSS px per point, or a list; fit-width), FILES, SPEEDS (CSS px per second, 900,3600),
 * RUNS (2), DURATION (ms, 4000), LATENCY (ms added to every request, Chromium only), BANDWIDTH
 * (Mbit/s, Chromium only), and OUTPUT (the browser name).
 */
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

interface Variant {
  name: string;
  engine: string;
  hwa: boolean;
  text: boolean;
  links: boolean;
  scroll: string;
  scale: string;
}

const engineVariants = [
  { name: "pdfjs", engine: "pdfjs", hwa: false },
  { name: "pdfjs-hwa", engine: "pdfjs", hwa: true },
  { name: "pdfjs-next", engine: "pdfjs-next", hwa: false },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next", hwa: true },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
// TEXT=1,0 and LINKS=1,0 measure every engine variant with and without
// text and annotation layers.
const textModes = (process.env.TEXT ?? "1").split(",").map((mode) => mode !== "0");
const linkModes = (process.env.LINKS ?? "1").split(",").map((mode) => mode !== "0");
// SCROLL=vertical,horizontal and SCALE=fit-width,0.5 measure every variant in
// each scroll mode at each zoom; variant names say them when they are set.
const scrollModes = (process.env.SCROLL ?? "vertical").split(",");
for (const mode of scrollModes) {
  if (mode === "page") throw new Error('"page" mode flips pages instead of scrolling them');
  if (!["vertical", "horizontal", "wrapped"].includes(mode)) {
    throw new Error(`unknown scroll mode ${mode}`);
  }
}
const scales = (process.env.SCALE ?? "fit-width").split(",");
const variants: Variant[] = engineVariants.flatMap((variant) =>
  textModes.flatMap((text) =>
    linkModes.flatMap((links) =>
      scrollModes.flatMap((scroll) =>
        scales.map((scale) => ({
          ...variant,
          text,
          links,
          scroll,
          scale,
          name: [
            variant.name,
            text ? "" : "no text",
            links ? "" : "no links",
            process.env.SCROLL ? scroll : "",
            process.env.SCALE ? (Number.isNaN(Number(scale)) ? scale : `scale ${scale}`) : "",
          ]
            .filter(Boolean)
            .join(", "),
        })),
      ),
    ),
  ),
);
const files = (process.env.FILES ?? "synthetic-text-1000.pdf,bill-hr815.pdf").split(",");
const speeds = (process.env.SPEEDS ?? "900,3600").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "2");
const durationMs = Number(process.env.DURATION ?? "4000");
const browserName = browserFromEnv();
// Network conditions, which a server on this machine otherwise lacks.
const latencyMs = Number(process.env.LATENCY ?? "0");
const bandwidthMbps = Number(process.env.BANDWIDTH ?? "0");
const throttled = latencyMs > 0 || bandwidthMbps > 0;
if (throttled && browserName !== "chromium") {
  throw new Error("LATENCY and BANDWIDTH need Chromium's DevTools protocol");
}
const output = process.env.OUTPUT ?? browserName;

interface IdleBaseline {
  timerLagP50Ms: number;
  timerLagP95Ms: number;
  frameIntervalMs: number;
}

interface JobResult {
  variant: string;
  file: string;
  speed: number;
  run: number;
  error?: string;
  idle?: IdleBaseline;
  firstPaintMs?: number | null;
  scrollMs?: number;
  pagesCrossed?: number;
  commitsDuringScroll?: number;
  /** Store notifications while scrolling, and those that moved the window or the current page. */
  published?: { updates: number; windows: number; currentPages: number };
  blankMeanPct?: number;
  blankFramesPct?: number;
  settleMs?: number;
  lag?: { p95Ms: number; maxMs: number; blockedMs: number };
  frames?: { frames: number; p95Ms: number; maxMs: number; dropped: number };
  renders?: {
    base: number;
    detail: number;
    text: number;
    annotations: number;
    cancelled: number;
    failed: number;
  };
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const power = assertMeasurementPower();
// Timing depends on what else the machine runs; record the one-minute load.
const loadAtStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4183, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4183/";
const waitForDone = (page: Page) =>
  page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 120_000,
  });

// After every launch, one discarded navigation warms the GPU process and HTTP
// cache so the first measured job is not penalized.
const launched = await launchBrowser(browserName, {
  async warmUp(browser) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
    // The first variant's engine: the demo's default needs a pdf.js master build.
    await page.goto(
      `${baseUrl}?engine=${variants[0]?.engine ?? "pdfjs"}&file=${files[0]}&autoscroll=60&duration=100`,
    );
    await waitForDone(page);
    await context.close();
  },
});

const results: JobResult[] = [];
try {
  for (const file of files) {
    for (const speed of speeds) {
      for (const variant of variants) {
        for (let run = 0; run < runs; run++) {
          const job = { variant: variant.name, file, speed, run };
          // Waits its turn with other Playwright browsers, and stops without
          // writing results if the machine lost AC power mid-run.
          const result = await measureInTurn(launched, async (browser): Promise<JobResult> => {
            const context = await browser.newContext({
              viewport: { width: 1280, height: 900 },
              deviceScaleFactor: 2,
            });
            try {
              const page = await context.newPage();
              await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
              // The idle baseline comes from a page without the viewer, in the
              // same context, right before the job.
              await page.goto(`${baseUrl}calibrate.html`);
              await waitForDone(page);
              const idle = (await page.evaluate(
                () => (window as { __result?: unknown }).__result,
              )) as IdleBaseline;
              if (throttled) {
                const cdp = await context.newCDPSession(page);
                await cdp.send("Network.enable");
                await cdp.send("Network.emulateNetworkConditions", {
                  offline: false,
                  latency: latencyMs,
                  downloadThroughput: bandwidthMbps > 0 ? (bandwidthMbps * 1e6) / 8 : -1,
                  uploadThroughput: -1,
                });
              }
              const query = new URLSearchParams({
                engine: variant.engine,
                hwa: variant.hwa ? "1" : "0",
                text: variant.text ? "1" : "0",
                links: variant.links ? "1" : "0",
                scroll: variant.scroll,
                scale: variant.scale,
                file,
                autoscroll: String(speed),
                duration: String(durationMs),
                idleLag: String(idle.timerLagP95Ms),
                idleFrame: String(idle.frameIntervalMs),
              });
              await page.goto(`${baseUrl}?${query}`);
              await waitForDone(page);
              const payload = (await page.evaluate(
                () => (window as { __result?: unknown }).__result,
              )) as Omit<JobResult, "variant" | "run">;
              const measured: JobResult = { ...payload, ...job, idle };
              const ratio = (payload as { devicePixelRatio?: number }).devicePixelRatio;
              if (ratio !== 2) measured.error = `devicePixelRatio ${ratio}, expected 2`;
              return measured;
            } catch (error) {
              return { ...job, error: error instanceof Error ? error.message : String(error) };
            } finally {
              await context.close();
            }
          });
          results.push(result);
          console.log(
            `${file} · ${speed} px/s · ${variant.name} · run ${run + 1}/${runs}: ${
              result.error
                ? `ERROR ${result.error.split("\n")[0]}`
                : `blank ${result.blankMeanPct?.toFixed(1)}%, blocked ${result.lag?.blockedMs.toFixed(0)} ms, commits ${result.commitsDuringScroll}, window / current-page changes ${result.published?.windows} / ${result.published?.currentPages}`
            }`,
          );
        }
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}

const summaries = files.flatMap((file) =>
  speeds.flatMap((speed) =>
    variants.map((variant) => {
      const ok = results.filter(
        (result) =>
          result.file === file &&
          result.speed === speed &&
          result.variant === variant.name &&
          !result.error,
      );
      const pick = (read: (result: JobResult) => number | null | undefined) =>
        median(ok.map((result) => read(result) ?? Number.NaN));
      return {
        file,
        speed,
        variant: variant.name,
        runs: ok.length,
        scrollMode: variant.scroll,
        scale: variant.scale,
        firstPaintMs: pick((result) => result.firstPaintMs),
        pagesCrossed: pick((result) => result.pagesCrossed),
        commitsDuringScroll: pick((result) => result.commitsDuringScroll),
        commitsPerSecond: pick((result) =>
          result.scrollMs ? ((result.commitsDuringScroll ?? 0) * 1000) / result.scrollMs : null,
        ),
        storeUpdates: pick((result) => result.published?.updates),
        windowChanges: pick((result) => result.published?.windows),
        currentPageChanges: pick((result) => result.published?.currentPages),
        blankMeanPct: pick((result) => result.blankMeanPct),
        blankFramesPct: pick((result) => result.blankFramesPct),
        blockedMs: pick((result) => result.lag?.blockedMs),
        lagP95Ms: pick((result) => result.lag?.p95Ms),
        lagMaxMs: pick((result) => result.lag?.maxMs),
        droppedFrames: pick((result) => result.frames?.dropped),
        frames: pick((result) => result.frames?.frames),
        baseRenders: pick((result) => result.renders?.base),
        detailRenders: pick((result) => result.renders?.detail),
        textLayers: pick((result) => result.renders?.text),
        annotationLayers: pick((result) => result.renders?.annotations),
        cancelledRenders: pick((result) => result.renders?.cancelled),
        settleMs: pick((result) => result.settleMs),
      };
    }),
  ),
);

const okResults = results.filter((result) => !result.error);
const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browserName,
  browser: launched.label,
  headless: launched.headless,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  // Medians of the per-job idle baselines from calibrate.html.
  idle: {
    timerLagP50Ms: median(okResults.map((result) => result.idle?.timerLagP50Ms ?? Number.NaN)),
    timerLagP95Ms: median(okResults.map((result) => result.idle?.timerLagP95Ms ?? Number.NaN)),
    frameIntervalMs: median(okResults.map((result) => result.idle?.frameIntervalMs ?? Number.NaN)),
  },
  settings: {
    runs,
    durationMs,
    latencyMs,
    bandwidthMbps,
    scrollModes,
    scales,
    viewport: "1280x900",
    devicePixelRatio: 2,
  },
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
mkdirSync(join(resultsDir, "raw"), { recursive: true });
writeFileSync(
  join(resultsDir, "raw", `${browserName}-${environment.runAt.replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ environment, results }, round, 2),
);
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, summaries }, round, 2)}\n`,
);

const fmt = (value: number, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "—");
// The settings this run was given, so the report says how to repeat it.
const reproduceEnv = [
  "VARIANTS",
  "TEXT",
  "LINKS",
  "SCROLL",
  "SCALE",
  "FILES",
  "SPEEDS",
  "RUNS",
  "DURATION",
  "LATENCY",
  "BANDWIDTH",
  "OUTPUT",
]
  .filter((name) => process.env[name] !== undefined)
  .map((name) => {
    const value = process.env[name] ?? "";
    return `${name}=${/^[\w.,-]+$/.test(value) ? value : `'${value}'`} `;
  })
  .join("");
const zoomText = scales
  .map((scale) => (Number.isNaN(Number(scale)) ? `${scale} zoom` : `${scale} CSS px per point`))
  .join(" or ");
const markdown = [
  `# ParaPDF runtime prototype: scripted scroll, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${environment.headless ? "headless" : "headed"}); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}${power.lowPowerMode ? ", Low Power Mode" : ""}; not comparable with AC runs**`}; one-minute load average ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end; ${turnTakingSummary()}`,
  `- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by ${fmt(environment.idle.timerLagP50Ms, 1)} ms (median) / ${fmt(environment.idle.timerLagP95Ms, 1)} ms (p95); animation frames every ${fmt(environment.idle.frameIntervalMs, 1)} ms.`,
  `- Method: 1280×900 viewport at devicePixelRatio 2, ${zoomText}, ${scrollModes.join(" or ")} scroll mode, ${durationMs} ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of ${runs} runs.${throttled ? ` Network: ${latencyMs} ms latency, ${bandwidthMbps > 0 ? `${bandwidthMbps} Mbit/s` : "unlimited bandwidth"} (DevTools protocol).` : ""}`,
  "- First paint: time from navigation start until page 1 shows pixels.",
  "- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.",
  "- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.",
  "- Dropped frames: animation frames longer than 1.5 idle frame intervals.",
  "- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.",
  `- Reproduce: \`pnpm --filter @parapdf/prototype build && BROWSER=${browserName} ${reproduceEnv}pnpm --filter @parapdf/prototype bench\``,
  "",
  ...files.flatMap((file) =>
    speeds.flatMap((speed) => [
      `## ${file}, ${speed} CSS px per second`,
      "",
      "| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...summaries
        .filter((summary) => summary.file === file && summary.speed === speed)
        .map(
          (summary) =>
            `| ${summary.variant} | ${fmt(summary.firstPaintMs)} | ${fmt(summary.pagesCrossed)} | ${fmt(summary.blankMeanPct, 1)} | ${fmt(summary.blankFramesPct, 1)} | ${fmt(summary.blockedMs)} | ${fmt(summary.lagP95Ms, 1)} / ${fmt(summary.lagMaxMs)} | ${fmt(summary.droppedFrames)} / ${fmt(summary.frames)} | ${fmt(summary.commitsDuringScroll)} (${fmt(summary.commitsPerSecond, 1)}) | ${fmt(summary.storeUpdates)} (${fmt(summary.windowChanges)} / ${fmt(summary.currentPageChanges)}) | ${fmt(summary.baseRenders)} / ${fmt(summary.detailRenders)} / ${fmt(summary.textLayers)} / ${fmt(summary.annotationLayers)} / ${fmt(summary.cancelledRenders)} |`,
        ),
      "",
    ]),
  ),
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
