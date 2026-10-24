/**
 * Return-trip benchmark: what pages show when the reader comes back to them
 * after they unmounted, and what showing them again costs, with the canvases
 * of pages that unmount kept and drawn back (`ViewerOptions.maxKeptPixels`)
 * and without. Each job opens the demo at fit-width, settles on page 1, and
 * then:
 *
 * - jump-back: goes to page 13, settles, and goes back to page 1;
 * - scroll-back: scrolls 10 pages down at 3600 CSS px per second, settles,
 *   and scrolls back up at the same speed;
 * - flip-back: in "page" mode flips forward 8 pages, settling after each, and
 *   back 8 pages, one every 50 ms, as a held key repeats.
 *
 * From the moment the way back starts, a probe records after every frame's
 * animation frame callbacks and layout the share of the viewport covered by
 * pages that show no pixels (`blankFraction()`) and how sharp the visible
 * pages are (`sharpness()`), until they have stayed sharp for 300 ms. The
 * report gives the time until no page in view is blank and until the pages
 * are sharp, the frames with blank area, mean sharpness on the way back,
 * the renders and the layers drawn back from kept canvases, main-thread
 * blocked time, dropped frames, and the memory of every canvas in the
 * viewport and of the kept ones.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/return-bench.ts
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs), VARIANTS (none,kept;
 * none keeps no canvases), SCENARIOS, FILES (bill-hr815.pdf,synthetic-vector-pages.pdf), RUNS (3),
 * KEPT (maxKeptPixels in the kept variant; the viewer's default when absent), DIST (another
 * build of the demo to measure), BEFORE (a build of the demo from before a change, measured
 * as the variant "before" in turn with the others), BEFORE_LABEL (its name in the report),
 * OUTPUT (return-<browser>).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
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
const engine = process.env.ENGINE ?? "pdfjs";
const runs = Number(process.env.RUNS ?? "3");
const keptPixels = process.env.KEPT;
const beforeDist = process.env.BEFORE;
const beforeLabel = process.env.BEFORE_LABEL ?? "another build";
const output = process.env.OUTPUT ?? `return-${browserName}`;
const files = (process.env.FILES ?? "bill-hr815.pdf,synthetic-vector-pages.pdf").split(",");
const viewport = { width: 820, height: 1000 };

const allVariants: { name: string; query: Record<string, string>; before?: boolean }[] = [
  ...(beforeDist ? [{ name: "before", query: {}, before: true }] : []),
  { name: "none", query: { maxKeptPixels: "0" } },
  { name: "kept", query: keptPixels ? { maxKeptPixels: keptPixels } : {} },
];
// BEFORE, when set, is always measured, as in the other benchmarks.
const variants = allVariants.filter(
  (variant) =>
    variant.before ||
    !process.env.VARIANTS ||
    process.env.VARIANTS.split(",").includes(variant.name),
);
const allScenarios = [
  { name: "jump-back", description: "page 1 → page 13 → page 1, settling at page 13" },
  {
    name: "scroll-back",
    description: "10 pages down and back up at 3600 CSS px per second, settling at the bottom",
  },
  {
    name: "flip-back",
    description: '"page" mode, 8 flips forward settling after each, then 8 back 50 ms apart',
  },
];
const scenarios = allScenarios.filter(
  (scenario) => !process.env.SCENARIOS || process.env.SCENARIOS.split(",").includes(scenario.name),
);

interface Sample {
  t: number;
  blank: number;
  sharp: number;
  canvasPixels: number;
  cachePixels: number;
}

interface InPageResult {
  /** When the way back started. */
  start: number;
  /** When it ended: the scroll arrived or the last flip; `start` for a jump. */
  arrived: number;
  /** Each flip back's time, in "flip-back". */
  flips: number[];
  samples: Sample[];
  statsBefore: Record<string, number>;
  statsAfter: Record<string, number>;
  blockedMs: number;
  lagMaxMs: number;
  droppedFrames: number;
  frames: number;
}

/**
 * Runs `scenario` in the page and records the way back. Self-contained: it
 * runs in the browser.
 */
async function runScenario(scenario: string): Promise<InPageResult> {
  interface Viewer {
    store: {
      get(): {
        layout: { tops: Float64Array } | null;
        pageCount: number;
        currentPage: number;
      };
    };
    scroller: HTMLElement | null;
    stats: Record<string, number> | null;
    keptPixels: number;
    sharpness(): number;
    blankFraction(): number;
    goToPage(index: number): void;
    nextPage(): void;
    previousPage(): void;
    setScale(scale: "fit-width"): void;
    setScrollMode(mode: string): void;
  }
  const viewer = (window as unknown as { __viewer: Viewer }).__viewer;
  const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Waits until the visible pages have been sharp for `holdMs`. */
  const settle = async (holdMs = 300, timeoutMs = 30_000) => {
    const until = performance.now() + timeoutMs;
    let since: number | null = null;
    while (performance.now() < until) {
      await nextFrame();
      if (viewer.sharpness() < 0.99) since = null;
      else {
        since ??= performance.now();
        if (performance.now() - since >= holdMs) return;
      }
    }
    throw new Error(`${scenario}: the pages did not get sharp`);
  };
  const scroller = viewer.scroller;
  if (!scroller) throw new Error("no viewport");
  const canvasPixels = () => {
    let pixels = 0;
    for (const canvas of scroller.querySelectorAll("canvas"))
      pixels += canvas.width * canvas.height;
    return pixels;
  };

  // The idle page's timer lateness and frame interval, the baseline that
  // blocked time and dropped frames are judged against.
  const idleLags: number[] = [];
  const idleFrames: number[] = [];
  await Promise.all([
    (async () => {
      const until = performance.now() + 500;
      while (performance.now() < until) {
        const expected = performance.now() + 4;
        await sleep(4);
        idleLags.push(Math.max(0, performance.now() - expected));
      }
    })(),
    (async () => {
      let last = await nextFrame();
      const until = last + 500;
      while (last < until) {
        const now = await nextFrame();
        idleFrames.push(now - last);
        last = now;
      }
    })(),
  ]);
  idleLags.sort((a, b) => a - b);
  idleFrames.sort((a, b) => a - b);
  const threshold = Math.max(2, idleLags[Math.floor(idleLags.length * 0.95)] ?? 0);
  const idleFrame = idleFrames[Math.floor(idleFrames.length / 2)] ?? 16.7;

  // Scroll at a constant speed, one step per animation frame.
  const scrollTo = async (target: number, speed: number) => {
    const from = scroller.scrollTop;
    const startAt = await nextFrame();
    const duration = (Math.abs(target - from) / speed) * 1000;
    for (;;) {
      const now = await nextFrame();
      const share = Math.min(1, (now - startAt) / duration);
      scroller.scrollTop = from + (target - from) * share;
      if (share >= 1) return;
    }
  };

  // The way there.
  viewer.setScale("fit-width");
  if (scenario === "flip-back") viewer.setScrollMode("page");
  viewer.goToPage(0);
  await settle();
  const pageCount = viewer.store.get().pageCount;
  if (scenario === "jump-back") {
    viewer.goToPage(Math.min(12, pageCount - 1));
    await settle();
  } else if (scenario === "scroll-back") {
    const top = viewer.store.get().layout?.tops[Math.min(10, pageCount - 1)] ?? 0;
    await scrollTo(top, 3600);
    await settle();
  } else {
    for (let flip = 0; flip < 8; flip++) {
      viewer.nextPage();
      await settle();
    }
  }
  await sleep(300);

  // The way back, recorded after every frame's animation frame callbacks and
  // layout: ResizeObserver callbacks run then, before paint.
  const samples: Sample[] = [];
  let recording = true;
  const sentinel = document.createElement("div");
  sentinel.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  document.body.append(sentinel);
  const observer = new ResizeObserver(() => {
    if (!recording) return;
    samples.push({
      t: performance.now(),
      blank: viewer.blankFraction(),
      sharp: viewer.sharpness(),
      canvasPixels: canvasPixels(),
      cachePixels: viewer.keptPixels,
    });
  });
  observer.observe(sentinel);
  const tick = () => {
    if (!recording) return;
    sentinel.style.width = sentinel.style.width === "2px" ? "1px" : "2px";
    requestAnimationFrame(tick);
  };
  // Main-thread lateness and frame intervals on the way back.
  const lags: number[] = [];
  const intervals: number[] = [];
  let monitoring = true;
  void (async () => {
    while (monitoring) {
      const expected = performance.now() + 4;
      await sleep(4);
      lags.push(Math.max(0, performance.now() - expected));
    }
  })();
  void (async () => {
    let last = await nextFrame();
    while (monitoring) {
      const now = await nextFrame();
      intervals.push(now - last);
      last = now;
    }
  })();

  const statsBefore = { ...(viewer.stats ?? {}) };
  requestAnimationFrame(tick);
  await nextFrame();
  const start = performance.now();
  const flips: number[] = [];
  if (scenario === "jump-back") viewer.goToPage(0);
  else if (scenario === "scroll-back") await scrollTo(0, 3600);
  else {
    for (let flip = 0; flip < 8; flip++) {
      flips.push(performance.now());
      viewer.previousPage();
      if (flip < 7) await sleep(50);
    }
  }
  const arrived = performance.now();
  await settle(300, 20_000);
  recording = false;
  monitoring = false;
  observer.disconnect();
  sentinel.remove();
  return {
    start,
    arrived,
    flips,
    samples,
    statsBefore,
    statsAfter: { ...(viewer.stats ?? {}) },
    blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - threshold), 0),
    lagMaxMs: Math.max(0, ...lags),
    droppedFrames: intervals.filter((interval) => interval > idleFrame * 1.5).length,
    frames: intervals.length,
  };
}

interface JobResult {
  variant: string;
  scenario: string;
  file: string;
  run: number;
  error?: string;
  /** From the start of the way back until no visible page was blank for good, and until sharp for good. */
  pixelsMs?: number | null;
  sharpMs?: number | null;
  /** Frames on the way back with blank area, and the mean blank share and sharpness while moving. */
  blankFrames?: number;
  blankMeanPct?: number;
  sharpMean?: number;
  /** For flip-back: each flip's time until sharp for good, the median and the longest. */
  flipSharpMedianMs?: number;
  flipSharpMaxMs?: number;
  baseRenders?: number;
  detailRenders?: number;
  cancelled?: number;
  cached?: number;
  blockedMs?: number;
  lagMaxMs?: number;
  droppedFrames?: number;
  frames?: number;
  peakCanvasMiB?: number;
  peakCacheMiB?: number;
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The first sample from which `ok` held to the end, as time since `from`; null if it never did. */
function heldFrom(samples: Sample[], from: number, ok: (sample: Sample) => boolean): number | null {
  let since: number | null = null;
  for (const sample of samples) {
    if (sample.t < from) continue;
    if (!ok(sample)) since = null;
    else since ??= sample.t;
  }
  return since === null ? null : since - from;
}

async function measure(
  browser: Browser,
  urls: { build: string; before: string },
  job: { variant: (typeof allVariants)[number]; scenario: string; file: string; run: number },
): Promise<JobResult> {
  const result: JobResult = {
    variant: job.variant.name,
    scenario: job.scenario,
    file: job.file,
    run: job.run,
  };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    const baseUrl = job.variant.before ? urls.before : urls.build;
    await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const query = new URLSearchParams({ engine, file: job.file, ...job.variant.query });
    await page.goto(`${baseUrl}?${query}`);
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __viewer?: { store: { get(): { status: string } } } }
        ).__viewer?.store.get().status === "ready",
      null,
      { timeout: 30_000 },
    );
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    if (ratio !== 2) throw new Error(`devicePixelRatio is ${ratio}, not 2`);
    const run = await page.evaluate(runScenario, job.scenario);
    if (errors.length > 0) throw new Error(errors.join(" | "));
    const { samples, start, arrived } = run;
    const moving = samples.filter((sample) => sample.t >= start && sample.t <= arrived);
    const stat = (key: string) => (run.statsAfter[key] ?? 0) - (run.statsBefore[key] ?? 0);
    const MiB = (pixels: number) => (pixels * 4) / 2 ** 20;
    const flipTimes = run.flips.map((at, index) => {
      // Each flip's samples end where the next flip starts.
      const until = run.flips[index + 1] ?? Number.POSITIVE_INFINITY;
      const within = samples.filter((sample) => sample.t < until);
      return heldFrom(within, at, (sample) => sample.sharp >= 0.99) ?? until - at;
    });
    Object.assign(result, {
      pixelsMs: heldFrom(samples, start, (sample) => sample.blank === 0),
      sharpMs: heldFrom(samples, start, (sample) => sample.sharp >= 0.99),
      blankFrames: samples.filter((sample) => sample.blank > 0).length,
      blankMeanPct: moving.length
        ? (100 * moving.reduce((sum, sample) => sum + sample.blank, 0)) / moving.length
        : Number.NaN,
      sharpMean: moving.length
        ? moving.reduce((sum, sample) => sum + sample.sharp, 0) / moving.length
        : Number.NaN,
      ...(flipTimes.length
        ? { flipSharpMedianMs: median(flipTimes), flipSharpMaxMs: Math.max(...flipTimes) }
        : {}),
      baseRenders: stat("base"),
      detailRenders: stat("detail"),
      cancelled: stat("cancelled"),
      cached: stat("kept"),
      blockedMs: run.blockedMs,
      lagMaxMs: run.lagMaxMs,
      droppedFrames: run.droppedFrames,
      frames: run.frames,
      peakCanvasMiB: MiB(Math.max(0, ...samples.map((sample) => sample.canvasPixels))),
      peakCacheMiB: MiB(Math.max(0, ...samples.map((sample) => sample.cachePixels))),
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
  } finally {
    await context.close();
  }
  return result;
}

const power = assertMeasurementPower();
const loadAtStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4183, host: "127.0.0.1", strictPort: false, open: false },
});
const before = beforeDist
  ? await preview({
      root: exampleDir,
      configFile: join(exampleDir, "vite.config.ts"),
      logLevel: "warn",
      build: { outDir: beforeDist },
      preview: { port: 4184, host: "127.0.0.1", strictPort: false, open: false },
    })
  : null;
const urls = {
  build: server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4183/",
  before: before?.resolvedUrls?.local[0] ?? "http://127.0.0.1:4184/",
};
const launched = await launchBrowser(browserName);
console.log(`${launched.label}, engine ${engine}, kept ${keptPixels ?? "by default"}`);

const results: JobResult[] = [];
try {
  for (let run = 1; run <= runs; run++) {
    for (const file of files) {
      for (const { name: scenario } of scenarios) {
        // The variants of one cell follow each other, so they meet the same machine.
        for (const variant of variants) {
          const result = await measureInTurn(launched, (browser) =>
            measure(browser, urls, { variant, scenario, file, run }),
          );
          results.push(result);
          console.log(
            `run ${run} · ${file} · ${scenario} · ${variant.name}: ${
              result.error ??
              `blank until ${result.pixelsMs?.toFixed(0)} ms, sharp at ${result.sharpMs?.toFixed(0)} ms, ${result.baseRenders}/${result.detailRenders} renders, ${result.cached} cached`
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

const summaries = files.flatMap((file) =>
  scenarios.flatMap(({ name: scenario }) =>
    variants.map(({ name: variant }) => {
      const jobs = results.filter(
        (result) =>
          result.file === file && result.scenario === scenario && result.variant === variant,
      );
      const ok = jobs.filter((job) => !job.error);
      const middle = (pick: (job: JobResult) => number | null | undefined) =>
        median(ok.map((job) => pick(job) ?? Number.NaN));
      return {
        file,
        scenario,
        variant,
        runs: ok.length,
        errors: jobs.filter((job) => job.error).map((job) => job.error),
        pixelsMs: middle((job) => job.pixelsMs),
        sharpMs: middle((job) => job.sharpMs),
        blankFrames: middle((job) => job.blankFrames),
        blankMeanPct: middle((job) => job.blankMeanPct),
        sharpMean: middle((job) => job.sharpMean),
        flipSharpMedianMs: middle((job) => job.flipSharpMedianMs),
        flipSharpMaxMs: middle((job) => job.flipSharpMaxMs),
        baseRenders: middle((job) => job.baseRenders),
        detailRenders: middle((job) => job.detailRenders),
        cancelled: middle((job) => job.cancelled),
        cached: middle((job) => job.cached),
        blockedMs: middle((job) => job.blockedMs),
        lagMaxMs: middle((job) => job.lagMaxMs),
        droppedFrames: middle((job) => job.droppedFrames),
        frames: middle((job) => job.frames),
        peakCanvasMiB: middle((job) => job.peakCanvasMiB),
        peakCacheMiB: middle((job) => job.peakCacheMiB),
      };
    }),
  ),
);

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: launched.label,
  engine,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  before: beforeDist ? beforeLabel : undefined,
  settings: { files: files.join(","), runs, viewport, deviceScaleFactor: 2, keptPixels },
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
  `# ParaPDF runtime prototype: coming back to pages, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${launched.headless ? "headless" : "headed"}); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}; not comparable with AC runs**`}`,
  `- One-minute load average: ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end, on ${cpus().length} cores. The run ${turnTakingSummary()}.`,
  `- Method: ${engine === "pdfjs" ? "pdf.js drawing on the main thread" : engine}, GPU-backed canvases, ${viewport.width}×${viewport.height} at devicePixelRatio 2 and fit-width, ${runs} runs; medians. Variants: none keeps no canvases of pages that unmount (\`maxKeptPixels: 0\`); kept keeps them, ${keptPixels ? `${fmt((Number(keptPixels) * 4) / 2 ** 20)} MiB` : "six viewports' worth"} at most, and draws them back when the pages mount again.${beforeDist ? ` before is ${beforeLabel}, measured in turn with them.` : ""}`,
  "- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.",
  `- Reproduce: \`pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=${browserName} node examples/prototype/scripts/return-bench.ts\``,
  "",
  ...scenarios.flatMap(({ name: scenario, description }) => [
    `## ${scenario}: ${description}`,
    "",
    `| File · variant | No blank (ms) | Sharp (ms) | Blank frames | ${scenario === "jump-back" ? "" : "Mean blank % · sharpness moving | "}${scenario === "flip-back" ? "Each flip sharp, median · max (ms) | " : ""}Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |`,
    `|---|---:|---:|---:|${scenario === "jump-back" ? "" : "---:|"}${scenario === "flip-back" ? "---:|" : ""}---:|---:|---:|---:|---:|`,
    ...summaries
      .filter((summary) => summary.scenario === scenario)
      .map(
        (summary) =>
          `| ${summary.file} · ${summary.variant}${summary.errors.length ? ` (${summary.errors.length} failed)` : ""} | ${fmt(summary.pixelsMs)} | ${fmt(summary.sharpMs)} | ${fmt(summary.blankFrames)} | ${scenario === "jump-back" ? "" : `${fmt(summary.blankMeanPct, 1)} · ${fmt(summary.sharpMean, 2)} | `}${scenario === "flip-back" ? `${fmt(summary.flipSharpMedianMs)} · ${fmt(summary.flipSharpMaxMs)} | ` : ""}${fmt(summary.baseRenders)} / ${fmt(summary.detailRenders)} (${fmt(summary.cancelled)}) | ${fmt(summary.cached)} | ${fmt(summary.blockedMs)} · ${fmt(summary.lagMaxMs)} | ${fmt(summary.droppedFrames)} / ${fmt(summary.frames)} | ${fmt(summary.peakCanvasMiB)} · ${fmt(summary.peakCacheMiB)} |`,
      ),
    "",
  ]),
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
