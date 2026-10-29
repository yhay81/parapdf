/**
 * Zoom benchmark: after zooming far in and after panning at that zoom, how
 * sharp the visible pages get, how fast, and how much canvas memory the
 * mounted pages hold. Sharpness is the runtime's own measure: the resolution
 * of the visible pixels as a share of full device resolution, weighted by
 * area. Canvas memory counts width × height × 4 bytes for every canvas in the
 * document and those kept for pages that unmounted; pixels held inside
 * workers are not included. Renders count the base and detail drawings
 * completed from the zoom until drawing stops after the pan.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/zoom-bench.ts
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS (pdfjs-hwa,pdfjs-next-hwa),
 * FILE (bill-hr815.pdf), SCALES (CSS px per point, 4,8), RUNS (3), DIST (another build of the
 * demo to measure), BEFORE (a build of the demo from before a change, measured in turn with
 * the variants on released pdf.js), BEFORE_LABEL (its name in the report), OUTPUT
 * (zoom-<browser>).
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
const browserName = browserFromEnv();
const beforeDist = process.env.BEFORE;
const variants = [
  ...(beforeDist
    ? [{ name: process.env.BEFORE_LABEL ?? "before", engine: "pdfjs", before: true }]
    : []),
  { name: "pdfjs-hwa", engine: "pdfjs", before: false },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next", before: false },
].filter(
  (variant) =>
    variant.before ||
    !process.env.VARIANTS ||
    process.env.VARIANTS.split(",").includes(variant.name),
);
const devices = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
];
const file = process.env.FILE ?? "bill-hr815.pdf";
const scales = (process.env.SCALES ?? "4,8").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "3");
const output = process.env.OUTPUT ?? `zoom-${browserName}`;
const SHARP = 0.99;

interface Phase {
  /** Milliseconds until the visible pages became sharp and stayed sharp; null if they never did. */
  timeToSharpMs: number | null;
  /** Sharpness when the measurement ended. */
  sharpness: number;
  peakCanvasMiB: number;
  canvasMiB: number;
}

interface Renders {
  base: number;
  detail: number;
}

interface JobResult {
  device: string;
  variant: string;
  scale: number;
  run: number;
  error?: string;
  zoom?: Phase;
  pan?: Phase;
  /** Renders completed from the zoom until none completed for a second after the pan. */
  renders?: Renders;
}

const renderCount = (page: Page): Promise<Renders> =>
  page.evaluate(() => {
    const { stats } = (window as unknown as { __viewer: { stats: Renders | null } }).__viewer;
    return { base: stats?.base ?? 0, detail: stats?.detail ?? 0 };
  });

/** Waits until no render has completed for a second, ten seconds at most, and counts those since `from`. */
const rendersSince = (page: Page, from: Renders): Promise<Renders> =>
  page.evaluate(async (from) => {
    const viewer = (window as unknown as { __viewer: { stats: Renders | null } }).__viewer;
    const count = () => ({ base: viewer.stats?.base ?? 0, detail: viewer.stats?.detail ?? 0 });
    const start = performance.now();
    let last = count();
    let quietSince = start;
    while (performance.now() - quietSince < 1000 && performance.now() - start < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const now = count();
      if (now.base !== last.base || now.detail !== last.detail) {
        last = now;
        quietSince = performance.now();
      }
    }
    return { base: last.base - from.base, detail: last.detail - from.detail };
  }, from);

/**
 * Zooms or pans inside the page, then samples every animation frame until the
 * view has been sharp for half a second or eight seconds have passed.
 */
const measure = (page: Page, action: { zoom: number } | { pan: true }): Promise<Phase> =>
  page.evaluate(async (action) => {
    const viewer = (
      window as unknown as {
        __viewer: {
          sharpness(): number;
          setScale(scale: number): void;
          scroller: HTMLElement;
          /** Absent in builds from before kept canvases. */
          keptPixels?: number;
        };
      }
    ).__viewer;
    // Kept canvases are out of the document, and hold memory all the same.
    const canvasBytes = () =>
      [...document.querySelectorAll("canvas")].reduce(
        (sum, canvas) => sum + canvas.width * canvas.height * 4,
        (viewer.keptPixels ?? 0) * 4,
      );
    const start = performance.now();
    if ("zoom" in action) viewer.setScale(action.zoom);
    else {
      const { scroller } = viewer;
      scroller.scrollTop += scroller.clientHeight * 0.6;
      scroller.scrollLeft += scroller.clientWidth * 0.3;
    }
    let sharpSince: number | null = null;
    let peak = 0;
    let sharpness = 0;
    while (performance.now() - start < 8000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now() - start;
      sharpness = viewer.sharpness();
      peak = Math.max(peak, canvasBytes());
      if (sharpness >= 0.99) {
        sharpSince ??= now;
        if (now - sharpSince >= 500) break;
      } else sharpSince = null;
    }
    return {
      timeToSharpMs: sharpSince,
      sharpness,
      peakCanvasMiB: peak / 2 ** 20,
      canvasMiB: canvasBytes() / 2 ** 20,
    };
  }, action);

const power = assertMeasurementPower();
// Timing depends on what else the machine runs; record the one-minute load.
const loadAtStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4182, host: "127.0.0.1", strictPort: false, open: false },
});
const before = beforeDist
  ? await preview({
      root: exampleDir,
      configFile: join(exampleDir, "vite.config.ts"),
      logLevel: "warn",
      build: { outDir: beforeDist },
      preview: { port: 4186, host: "127.0.0.1", strictPort: false, open: false },
    })
  : null;
const builds = {
  current: server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4182/",
  before: before?.resolvedUrls?.local[0] ?? "http://127.0.0.1:4186/",
};
const launched = await launchBrowser(browserName);
const results: JobResult[] = [];
try {
  for (const device of devices) {
    for (const scale of scales) {
      // The variants of one run follow each other, so they meet the same machine.
      for (let run = 0; run < runs; run++) {
        for (const variant of variants) {
          const job = { device: device.name, variant: variant.name, scale, run };
          const baseUrl = variant.before ? builds.before : builds.current;
          const result = await measureInTurn(launched, async (browser): Promise<JobResult> => {
            const context = await browser.newContext({
              viewport: device.viewport,
              deviceScaleFactor: device.deviceScaleFactor,
            });
            try {
              const page = await context.newPage();
              await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
              const query = new URLSearchParams({
                engine: variant.engine,
                hwa: "1",
                file,
                maxScale: "10",
              });
              await page.goto(`${baseUrl}?${query}`);
              // Start from a settled, sharp first page at the fit-width zoom.
              await page.waitForFunction(
                (sharp) =>
                  ((
                    window as unknown as { __viewer?: { sharpness(): number } }
                  ).__viewer?.sharpness() ?? 0) >= sharp,
                SHARP,
                { timeout: 30_000 },
              );
              await page.waitForTimeout(500);
              const ratio = await page.evaluate(() => devicePixelRatio);
              if (ratio !== device.deviceScaleFactor) {
                throw new Error(`devicePixelRatio ${ratio}, expected ${device.deviceScaleFactor}`);
              }
              const from = await renderCount(page);
              const zoom = await measure(page, { zoom: scale });
              const pan = await measure(page, { pan: true });
              const renders = await rendersSince(page, from);
              return { ...job, zoom, pan, renders };
            } catch (error) {
              return { ...job, error: error instanceof Error ? error.message : String(error) };
            } finally {
              await context.close();
            }
          });
          results.push(result);
          const format = (phase?: Phase) =>
            phase
              ? `sharp ${phase.sharpness.toFixed(2)} after ${phase.timeToSharpMs?.toFixed(0) ?? "never"} ms, canvas ${phase.canvasMiB.toFixed(0)} MiB (peak ${phase.peakCanvasMiB.toFixed(0)})`
              : "—";
          console.log(
            `${device.name} · ${scale}× · ${variant.name} · run ${run + 1}/${runs}: ${
              result.error
                ? `ERROR ${result.error.split("\n")[0]}`
                : `zoom ${format(result.zoom)}; pan ${format(result.pan)}; renders ${result.renders?.base}/${result.renders?.detail}`
            }`,
          );
        }
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
  await before?.close();
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const summarize = (ok: JobResult[], key: "zoom" | "pan") => ({
  timeToSharpMs: median(ok.map((result) => result[key]?.timeToSharpMs ?? Number.NaN)),
  sharpRuns: ok.filter((result) => result[key]?.timeToSharpMs !== null).length,
  sharpness: median(ok.map((result) => result[key]?.sharpness ?? Number.NaN)),
  canvasMiB: median(ok.map((result) => result[key]?.canvasMiB ?? Number.NaN)),
  peakCanvasMiB: median(ok.map((result) => result[key]?.peakCanvasMiB ?? Number.NaN)),
});
const summaries = devices.flatMap((device) =>
  scales.flatMap((scale) =>
    variants.map((variant) => {
      const ok = results.filter(
        (result) =>
          result.device === device.name &&
          result.scale === scale &&
          result.variant === variant.name &&
          !result.error,
      );
      return {
        device: device.name,
        scale,
        variant: variant.name,
        runs: ok.length,
        zoom: summarize(ok, "zoom"),
        pan: summarize(ok, "pan"),
        renders: {
          base: median(ok.map((result) => result.renders?.base ?? Number.NaN)),
          detail: median(ok.map((result) => result.renders?.detail ?? Number.NaN)),
        },
      };
    }),
  ),
);

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: launched.label,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  settings: { file, runs, devices },
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
const cell = (phase: ReturnType<typeof summarize>, runCount: number) =>
  `${fmt(phase.sharpness, 2)} | ${phase.sharpRuns === runCount ? fmt(phase.timeToSharpMs) : `${phase.sharpRuns}/${runCount} runs sharp`} | ${fmt(phase.canvasMiB)} (${fmt(phase.peakCanvasMiB)})`;
const markdown = [
  `# ParaPDF runtime prototype: zoom, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${launched.headless ? "headless" : "headed"}); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}; not comparable with AC runs**`}`,
  `- One-minute load average: ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end, on ${cpus().length} cores; times are only comparable between quiet runs. The run ${turnTakingSummary()}.`,
  `- Method: ${file} opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of ${runs} runs.`,
  "- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.",
  "- Canvas memory: width × height × 4 bytes for every canvas in the document and those kept for pages that unmounted when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.",
  "- Renders: the base and detail drawings completed from the zoom until none completed for a second after the pan.",
  `- Reproduce: \`pnpm --filter @parapdf/prototype build && BROWSER=${browserName} node examples/prototype/scripts/zoom-bench.ts\``,
  "",
  "| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) | Renders: base / detail |",
  "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|",
  ...summaries.map(
    (summary) =>
      `| ${summary.device} | ${summary.scale} | ${summary.variant} | ${cell(summary.zoom, summary.runs)} | ${cell(summary.pan, summary.runs)} | ${fmt(summary.renders.base)} / ${fmt(summary.renders.detail)} |`,
  ),
  "",
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
