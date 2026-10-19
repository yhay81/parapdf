/**
 * Scripted scroll benchmark for the runtime prototype. Each job measures the
 * browser's idle baseline on calibrate.html, opens the demo in the same fresh
 * page at devicePixelRatio 2, waits for the first page, scrolls at a constant
 * speed, and records blank area, main-thread lag, dropped frames, React
 * commits, and render counts.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS, TEXT and LINKS (1, 0, or 1,0),
 * FILES, SPEEDS (CSS px per second, 900,3600), RUNS (2), DURATION (ms, 4000), PRELOAD (1),
 * OUTPUT (the browser name).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");

interface Variant {
  name: string;
  engine: string;
  hwa: boolean;
  text: boolean;
  links: boolean;
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
const variants: Variant[] = engineVariants.flatMap((variant) =>
  textModes.flatMap((text) =>
    linkModes.map((links) => ({
      ...variant,
      text,
      links,
      name: [variant.name, text ? "" : "no text", links ? "" : "no links"]
        .filter(Boolean)
        .join(", "),
    })),
  ),
);
const files = (process.env.FILES ?? "synthetic-text-1000.pdf,bill-hr815.pdf").split(",");
const speeds = (process.env.SPEEDS ?? "900,3600").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "2");
const durationMs = Number(process.env.DURATION ?? "4000");
const preloadPdf = process.env.PRELOAD !== "0";
const browserName = browserFromEnv();
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
  pagesCrossed?: number;
  commitsDuringScroll?: number;
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
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4183, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4183/";
const launched = await launchBrowser(browserName, { deviceScaleFactor: 2 });
const { browser } = launched;

const waitForDone = (page: Page) =>
  page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 120_000,
  });

// One discarded navigation warms the GPU process and HTTP cache so the first
// measured job is not penalized.
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}?file=${files[0]}&autoscroll=60&duration=100`);
  await waitForDone(page);
  await context.close();
}

const results: JobResult[] = [];
try {
  for (const file of files) {
    for (const speed of speeds) {
      for (const variant of variants) {
        for (let run = 0; run < runs; run++) {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: 2,
          });
          // Stop without writing results if the machine lost AC power mid-run.
          assertMeasurementPower();
          const page = await context.newPage();
          const job = { variant: variant.name, file, speed, run };
          let result: JobResult;
          try {
            // The idle baseline comes from a page without the viewer, in the
            // same context, right before the job.
            await page.goto(`${baseUrl}calibrate.html`);
            await waitForDone(page);
            const idle = (await page.evaluate(
              () => (window as { __result?: unknown }).__result,
            )) as IdleBaseline;
            const query = new URLSearchParams({
              engine: variant.engine,
              hwa: variant.hwa ? "1" : "0",
              text: variant.text ? "1" : "0",
              links: variant.links ? "1" : "0",
              file,
              autoscroll: String(speed),
              duration: String(durationMs),
              preload: preloadPdf ? "1" : "0",
              idleLag: String(idle.timerLagP95Ms),
              idleFrame: String(idle.frameIntervalMs),
            });
            await page.goto(`${baseUrl}?${query}`);
            await waitForDone(page);
            const payload = (await page.evaluate(
              () => (window as { __result?: unknown }).__result,
            )) as Omit<JobResult, "variant" | "run">;
            result = { ...payload, ...job, idle };
            const ratio = (payload as { devicePixelRatio?: number }).devicePixelRatio;
            if (ratio !== 2) result.error = `devicePixelRatio ${ratio}, expected 2`;
          } catch (error) {
            result = { ...job, error: error instanceof Error ? error.message : String(error) };
          }
          await context.close();
          results.push(result);
          console.log(
            `${file} · ${speed} px/s · ${variant.name} · run ${run + 1}/${runs}: ${
              result.error
                ? `ERROR ${result.error.split("\n")[0]}`
                : `blank ${result.blankMeanPct?.toFixed(1)}%, blocked ${result.lag?.blockedMs.toFixed(0)} ms, commits ${result.commitsDuringScroll}`
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
        firstPaintMs: pick((result) => result.firstPaintMs),
        pagesCrossed: pick((result) => result.pagesCrossed),
        commitsDuringScroll: pick((result) => result.commitsDuringScroll),
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
  // Medians of the per-job idle baselines from calibrate.html.
  idle: {
    timerLagP50Ms: median(okResults.map((result) => result.idle?.timerLagP50Ms ?? Number.NaN)),
    timerLagP95Ms: median(okResults.map((result) => result.idle?.timerLagP95Ms ?? Number.NaN)),
    frameIntervalMs: median(okResults.map((result) => result.idle?.frameIntervalMs ?? Number.NaN)),
  },
  settings: { runs, durationMs, preloadPdf, viewport: "1280x900", devicePixelRatio: 2 },
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
const markdown = [
  `# ParaPDF runtime prototype: scripted scroll, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${environment.headless ? "headless" : "headed"}); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}${power.lowPowerMode ? ", Low Power Mode" : ""}; not comparable with AC runs**`}`,
  `- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by ${fmt(environment.idle.timerLagP50Ms, 1)} ms (median) / ${fmt(environment.idle.timerLagP95Ms, 1)} ms (p95); animation frames every ${fmt(environment.idle.frameIntervalMs, 1)} ms.`,
  `- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, ${durationMs} ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of ${runs} runs. PDF preload: ${preloadPdf ? "on" : "off"}.`,
  "- First paint: time from navigation start until page 1 shows pixels.",
  "- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.",
  "- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.",
  "- Dropped frames: animation frames longer than 1.5 idle frame intervals.",
  `- Reproduce: \`pnpm --filter @parapdf/prototype build && BROWSER=${browserName} pnpm --filter @parapdf/prototype bench\``,
  "",
  ...files.flatMap((file) =>
    speeds.flatMap((speed) => [
      `## ${file}, ${speed} CSS px per second`,
      "",
      "| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...summaries
        .filter((summary) => summary.file === file && summary.speed === speed)
        .map(
          (summary) =>
            `| ${summary.variant} | ${fmt(summary.firstPaintMs)} | ${fmt(summary.pagesCrossed)} | ${fmt(summary.blankMeanPct, 1)} | ${fmt(summary.blankFramesPct, 1)} | ${fmt(summary.blockedMs)} | ${fmt(summary.lagP95Ms, 1)} / ${fmt(summary.lagMaxMs)} | ${fmt(summary.droppedFrames)} / ${fmt(summary.frames)} | ${fmt(summary.commitsDuringScroll)} | ${fmt(summary.baseRenders)} / ${fmt(summary.detailRenders)} / ${fmt(summary.textLayers)} / ${fmt(summary.annotationLayers)} / ${fmt(summary.cancelledRenders)} |`,
        ),
      "",
    ]),
  ),
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
