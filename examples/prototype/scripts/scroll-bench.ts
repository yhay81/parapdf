/**
 * Scripted scroll benchmark for the runtime prototype. Each job opens the demo
 * in a fresh page at devicePixelRatio 2, waits for the first page, scrolls at
 * a constant speed, and records blank area, main-thread lag, dropped frames,
 * React commits, and render counts.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench
 * Environment: VARIANTS, TEXT (1, 0, or 1,0), FILES, SPEEDS (px per frame), RUNS (2),
 * DURATION (ms, 4000), PRELOAD (1), OUTPUT (latest).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");

interface Variant {
  name: string;
  engine: string;
  hwa: boolean;
  text: boolean;
}

const engineVariants = [
  { name: "pdfjs", engine: "pdfjs", hwa: false },
  { name: "pdfjs-hwa", engine: "pdfjs", hwa: true },
  { name: "pdfjs-next", engine: "pdfjs-next", hwa: false },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next", hwa: true },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
// TEXT=1,0 measures every engine variant with and without text layers.
const textModes = (process.env.TEXT ?? "1").split(",").map((mode) => mode !== "0");
const variants: Variant[] = engineVariants.flatMap((variant) =>
  textModes.map((text) => ({
    ...variant,
    text,
    name: text ? variant.name : `${variant.name}, no text`,
  })),
);
const files = (process.env.FILES ?? "synthetic-text-1000.pdf,bill-hr815.pdf").split(",");
const speeds = (process.env.SPEEDS ?? "15,60").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "2");
const durationMs = Number(process.env.DURATION ?? "4000");
const preloadPdf = process.env.PRELOAD !== "0";
const output = process.env.OUTPUT ?? "latest";

interface JobResult {
  variant: string;
  file: string;
  speed: number;
  run: number;
  error?: string;
  firstPaintMs?: number | null;
  pagesCrossed?: number;
  commitsDuringScroll?: number;
  blankMeanPct?: number;
  blankFramesPct?: number;
  settleMs?: number;
  lag?: { p95Ms: number; maxMs: number; blockedMs: number };
  frames?: { frames: number; p95Ms: number; maxMs: number; dropped: number };
  renders?: { base: number; detail: number; text: number; cancelled: number; failed: number };
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4183, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4183/";
const gpuArgs = platform() === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : ["--enable-gpu"];
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", ...gpuArgs] });
const chromiumVersion = browser.version();

// One discarded navigation warms the GPU process and HTTP cache so the first
// measured job is not penalized.
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}?file=${files[0]}&autoscroll=1&duration=100`);
  await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 120_000,
  });
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
          const page = await context.newPage();
          const query = new URLSearchParams({
            engine: variant.engine,
            hwa: variant.hwa ? "1" : "0",
            text: variant.text ? "1" : "0",
            file,
            autoscroll: String(speed),
            duration: String(durationMs),
            preload: preloadPdf ? "1" : "0",
          });
          const job = { variant: variant.name, file, speed, run };
          let result: JobResult;
          try {
            await page.goto(`${baseUrl}?${query}`);
            await page.waitForFunction(
              () => (window as { __done?: boolean }).__done === true,
              undefined,
              {
                timeout: 120_000,
              },
            );
            const payload = (await page.evaluate(
              () => (window as { __result?: unknown }).__result,
            )) as Omit<JobResult, "variant" | "run">;
            result = { ...payload, ...job };
          } catch (error) {
            result = { ...job, error: error instanceof Error ? error.message : String(error) };
          }
          await context.close();
          results.push(result);
          console.log(
            `${file} · ${speed}px/frame · ${variant.name} · run ${run + 1}/${runs}: ${
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
  await browser.close();
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
        cancelledRenders: pick((result) => result.renders?.cancelled),
        settleMs: pick((result) => result.settleMs),
      };
    }),
  ),
);

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  chromium: chromiumVersion,
  settings: { runs, durationMs, preloadPdf, viewport: "1280x900", devicePixelRatio: 2 },
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
mkdirSync(join(resultsDir, "raw"), { recursive: true });
writeFileSync(
  join(resultsDir, "raw", `${environment.runAt.replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ environment, results }, round, 2),
);
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, summaries }, round, 2)}\n`,
);

const fmt = (value: number, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "—");
const markdown = [
  "# ParaPDF runtime prototype: scripted scroll",
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; Chromium ${environment.chromium} (headless, Metal GPU)`,
  `- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, ${durationMs} ms of constant-speed scrolling after the first page is painted, median of ${runs} runs. PDF preload: ${preloadPdf ? "on" : "off"}.`,
  "- First paint: time from navigation start until page 1 shows pixels.",
  "- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.",
  "- Main thread: summed lateness beyond 2 ms of a 4 ms timer while scrolling, plus the raw p95 and maximum lateness.",
  "- Reproduce: `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`",
  "",
  ...files.flatMap((file) =>
    speeds.flatMap((speed) => [
      `## ${file}, ${speed} px per frame`,
      "",
      "| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / cancelled |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...summaries
        .filter((summary) => summary.file === file && summary.speed === speed)
        .map(
          (summary) =>
            `| ${summary.variant} | ${fmt(summary.firstPaintMs)} | ${fmt(summary.pagesCrossed)} | ${fmt(summary.blankMeanPct, 1)} | ${fmt(summary.blankFramesPct, 1)} | ${fmt(summary.blockedMs)} | ${fmt(summary.lagP95Ms, 1)} / ${fmt(summary.lagMaxMs)} | ${fmt(summary.droppedFrames)} / ${fmt(summary.frames)} | ${fmt(summary.commitsDuringScroll)} | ${fmt(summary.baseRenders)} / ${fmt(summary.detailRenders)} / ${fmt(summary.textLayers)} / ${fmt(summary.cancelledRenders)} |`,
        ),
      "",
    ]),
  ),
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
