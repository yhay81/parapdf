/**
 * Zoom commit benchmark: what the visible pages show in every frame after a
 * zoom commits, and what the commit costs. A probe composites each visible
 * page's canvases as the page shows them, the hidden ones left out, once all
 * of a frame's animation frame callbacks have run, and reads their pixels:
 * a page is blank when none of the pixels it shows is darker than 250 while
 * the settled drawing of the same area has ink, and down to its base when it
 * showed a detail canvas before the commit and shows none. A second pass
 * without the probe, which reads canvases back from the GPU, times how long
 * the visible pages take to get sharp, counts the renders, and sums the
 * pixels of every canvas in each frame.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/commit-bench.ts
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs), SCENARIOS, RUNS (3),
 * THROTTLE (Chromium's CPU slowdown, 1), DIST (another build of the demo to measure), LABEL
 * (that build's name in the report), OUTPUT (commit-<browser>).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
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
const throttle = Number(process.env.THROTTLE ?? "1");
const label = process.env.LABEL ?? "this build";
const output =
  process.env.OUTPUT ?? `commit-${browserName}${throttle > 1 ? `-throttle${throttle}` : ""}`;
const file = "bill-hr815.pdf";
const viewport = { width: 820, height: 1000 };
const SHARP = 0.99;

interface ProbeFrame {
  t: number;
  scale: number;
  sharpness: number;
  /** Width × height of every canvas in the viewport. */
  canvasPixels: number;
  pages: {
    page: number;
    /** Share of the shown pixels darker than 250 in the page's visible part. */
    ink: number;
    /** Whether a detail canvas shows. */
    detail: boolean;
    /** The ink of the same part once the view settled; null when the page was unmounted. */
    reference?: number | null;
  }[];
}

interface ProbeResult {
  frames: ProbeFrame[];
  /** When the scale changed, and the render counts then and at the end. */
  commitAt: number | null;
  statsAtCommit: Record<string, number> | null;
  statsAtEnd: Record<string, number> | null;
}

/**
 * Installed in the page: records every frame from `start()` to `stop()`,
 * reading the visible pages' pixels when `readPixels` is set.
 */
function installProbe(readPixels: boolean): void {
  const w = window as unknown as {
    __viewer: {
      store: {
        get(): { scale: number };
        subscribe(listener: () => void): () => void;
      };
      sharpness(): number;
      stats: Record<string, number> | null;
    };
    __commitProbe: unknown;
  };
  const viewer = w.__viewer;
  const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d") as CanvasRenderingContext2D;
  /** Probe pixels per CSS pixel. */
  const S = 0.25;
  const frames: ProbeFrame[] = [];
  const regions: number[][][] = [];
  let running = false;
  let commitAt: number | null = null;
  let statsAtCommit: Record<string, number> | null = null;
  let lastScale = viewer.store.get().scale;
  viewer.store.subscribe(() => {
    const { scale } = viewer.store.get();
    if (running && commitAt === null && scale !== lastScale) {
      commitAt = performance.now();
      statsAtCommit = { ...(viewer.stats ?? {}) };
    }
    lastScale = scale;
  });
  /** Draws what `section` shows into the probe canvas, the hidden canvases left out. */
  const composite = (section: HTMLElement, rect: DOMRect): boolean[] => {
    probe.width = Math.max(1, Math.round(rect.width * S));
    probe.height = Math.max(1, Math.round(rect.height * S));
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, probe.width, probe.height);
    const shown: boolean[] = [];
    for (const canvas of section.querySelectorAll<HTMLCanvasElement>(
      ":scope > div[aria-hidden] > canvas",
    )) {
      // A canvas never drawn keeps the default size, 300 by 150, and shows nothing.
      const visible =
        canvas.width * canvas.height > 0 &&
        !(canvas.width === 300 && canvas.height === 150) &&
        getComputedStyle(canvas).visibility !== "hidden";
      shown.push(visible);
      if (!visible) continue;
      const box = canvas.getBoundingClientRect();
      ctx.drawImage(
        canvas,
        (box.left - rect.left) * S,
        (box.top - rect.top) * S,
        box.width * S,
        box.height * S,
      );
    }
    return shown;
  };
  /** The share of pixels darker than 250 in `region`, shares of the page, of the probe canvas. */
  const inkIn = (region: number[]): number => {
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = region;
    const x = Math.floor(x0 * probe.width);
    const y = Math.floor(y0 * probe.height);
    const data = ctx.getImageData(
      x,
      y,
      Math.max(1, Math.floor(x1 * probe.width) - x),
      Math.max(1, Math.floor(y1 * probe.height) - y),
    ).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3 < 250) ink++;
    }
    return ink / (data.length / 4);
  };
  const record = () => {
    let canvasPixels = 0;
    for (const canvas of scroller.querySelectorAll("canvas")) {
      canvasPixels += canvas.width * canvas.height;
    }
    const frame: ProbeFrame = {
      t: performance.now(),
      scale: viewer.store.get().scale,
      sharpness: viewer.sharpness(),
      canvasPixels,
      pages: [],
    };
    const frameRegions: number[][] = [];
    if (readPixels) {
      const box = scroller.getBoundingClientRect();
      const left = box.left + scroller.clientLeft;
      const top = box.top + scroller.clientTop;
      const right = left + scroller.clientWidth;
      const bottom = top + scroller.clientHeight;
      for (const section of scroller.querySelectorAll<HTMLElement>("section[data-page]")) {
        if (getComputedStyle(section).visibility === "hidden") continue;
        const rect = section.getBoundingClientRect();
        // At least 16 CSS pixels each way: four probe pixels.
        const visible = [
          Math.max(left, rect.left),
          Math.max(top, rect.top),
          Math.min(right, rect.right),
          Math.min(bottom, rect.bottom),
        ];
        const [vl = 0, vt = 0, vr = 0, vb = 0] = visible;
        if (vr - vl < 16 || vb - vt < 16) continue;
        const shown = composite(section, rect);
        const region = [
          (vl - rect.left) / rect.width,
          (vt - rect.top) / rect.height,
          (vr - rect.left) / rect.width,
          (vb - rect.top) / rect.height,
        ];
        frame.pages.push({
          page: Number(section.dataset.page),
          ink: inkIn(region),
          detail: shown.slice(1).some(Boolean),
        });
        frameRegions.push(region);
      }
    }
    frames.push(frame);
    regions.push(frameRegions);
  };
  // ResizeObserver callbacks run after every animation frame callback and
  // layout, before paint: the canvases then hold what the frame shows.
  const sentinel = document.createElement("div");
  sentinel.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  document.body.append(sentinel);
  new ResizeObserver(() => {
    if (running) record();
  }).observe(sentinel);
  const tick = () => {
    if (!running) return;
    sentinel.style.width = sentinel.style.width === "2px" ? "1px" : "2px";
    requestAnimationFrame(tick);
  };
  w.__commitProbe = {
    start() {
      running = true;
      requestAnimationFrame(tick);
    },
    stop(): ProbeResult {
      running = false;
      // A blank page counts only where the settled drawing has ink.
      for (const [index, frame] of frames.entries()) {
        for (const [at, shot] of frame.pages.entries()) {
          if (shot.ink > 0) continue;
          const section = scroller.querySelector<HTMLElement>(`section[data-page="${shot.page}"]`);
          if (!section) {
            shot.reference = null;
            continue;
          }
          composite(section, section.getBoundingClientRect());
          shot.reference = inkIn(regions[index]?.[at] ?? []);
        }
      }
      return { frames, commitAt, statsAtCommit, statsAtEnd: { ...(viewer.stats ?? {}) } };
    },
  };
}

const settle = (page: Page) =>
  page.waitForFunction(
    (sharp) => {
      const viewer = (window as unknown as { __viewer?: { sharpness(): number } }).__viewer;
      const holder = window as unknown as { __settledSince?: number | null };
      if (!viewer || viewer.sharpness() < sharp) {
        holder.__settledSince = null;
        return false;
      }
      holder.__settledSince ??= performance.now();
      return performance.now() - holder.__settledSince > 300;
    },
    SHARP,
    { timeout: 60_000, polling: 50 },
  );

const viewerCall = async (page: Page, code: string): Promise<void> => {
  await page.evaluate(`(() => { const v = window.__viewer; ${code} })()`);
};

/** A point a third from the viewport's left and two fifths from its top. */
const pinchPoint = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    return {
      x: Math.round(rect.left + scroller.clientWidth / 3),
      y: Math.round(rect.top + (scroller.clientHeight * 2) / 5),
    };
  });

/**
 * Two touch pointers dispatched one move per animation frame, from ± `half`
 * to ± `toHalf` CSS pixels around the pinch point, moving `dy` along.
 */
const pinch = async (page: Page, half: number, toHalf: number, steps: number, dy = 0) => {
  const point = await pinchPoint(page);
  await page.evaluate(
    async ({ point, half, toHalf, steps, dy }) => {
      const target = document.elementFromPoint(point.x, point.y) ?? document.body;
      const pointer = (type: string, id: number, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 41,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      pointer("pointerdown", 41, point.x - half, point.y);
      pointer("pointerdown", 42, point.x + half, point.y);
      let y = point.y;
      for (let step = 1; step <= steps; step++) {
        const spread = half + ((toHalf - half) * step) / steps;
        y = point.y + (dy * step) / steps;
        pointer("pointermove", 41, point.x - spread, y);
        pointer("pointermove", 42, point.x + spread, y);
        await new Promise(requestAnimationFrame);
      }
      pointer("pointerup", 41, point.x - toHalf, y);
      pointer("pointerup", 42, point.x + toHalf, y);
    },
    { point, half, toHalf, steps, dy },
  );
};

interface Scenario {
  name: string;
  description: string;
  setup: string;
  act: (page: Page) => Promise<void>;
}

const fitWidth = (page: number) => `v.setScale("fit-width"); v.goToPage(${page});`;
const allScenarios: Scenario[] = [
  {
    name: "pinch-out",
    description: "a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width",
    setup: fitWidth(2),
    act: (page) => pinch(page, 50, 100, 15),
  },
  {
    name: "pinch-in-start",
    description: "a touch pinch in, 300 to 80 CSS pixels, at the document's start",
    setup: fitWidth(0),
    act: (page) => pinch(page, 150, 40, 10),
  },
  {
    name: "pinch-in-drag",
    description: "a touch pinch in, 300 to 150, dragging 400 CSS pixels up, at scale 0.4",
    setup: "v.setScale(0.4); v.goToPage(4);",
    act: (page) => pinch(page, 150, 75, 30, -400),
  },
  {
    name: "scale-up",
    description: "setScale() to 1.75 times fit-width",
    setup: fitWidth(2),
    act: (page) => viewerCall(page, "v.setScale(v.store.get().scale * 1.75);"),
  },
  {
    name: "scale-down",
    description: "setScale() from 1.5 to 0.25",
    setup: "v.setScale(1.5); v.goToPage(2);",
    act: (page) => viewerCall(page, "v.setScale(0.25);"),
  },
  {
    name: "zoom-step",
    description: "zoomBy(1.1) at fit-width",
    setup: fitWidth(2),
    act: (page) => viewerCall(page, "v.zoomBy(1.1);"),
  },
  {
    name: "zoom-in-far",
    description: "setScale() from fit-width to 5, where detail covers part of the page",
    setup: fitWidth(2),
    act: (page) => viewerCall(page, "v.setScale(5);"),
  },
  {
    name: "zoom-out-far",
    description: 'setScale() from 5 back to "fit-width"',
    setup: "v.goToPage(2); v.setScale(5);",
    act: (page) => viewerCall(page, 'v.setScale("fit-width");'),
  },
  {
    name: "zoom-twice",
    description: "zoomBy(1.25) twice 30 ms apart at fit-width",
    setup: fitWidth(2),
    act: async (page) => {
      await viewerCall(page, "v.zoomBy(1.25);");
      await page.waitForTimeout(30);
      await viewerCall(page, "v.zoomBy(1.25);");
    },
  },
  {
    name: "ctrl-wheel",
    description: "ctrl+wheel up by 50 at fit-width, which commits 150 ms after the event",
    setup: fitWidth(2),
    act: async (page) => {
      const point = await pinchPoint(page);
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -50);
      await page.keyboard.up("Control");
    },
  },
];
const scenarios = allScenarios.filter(
  (scenario) => !process.env.SCENARIOS || process.env.SCENARIOS.split(",").includes(scenario.name),
);

interface PassResult {
  scale: [number, number];
  /** Frames after the commit with a blank page, and the longest a page stayed blank. */
  blankFrames?: number;
  blankMs?: number;
  /** Frames after the commit with a page down to its base, and the longest. */
  baseFrames?: number;
  baseMs?: number;
  timeToSharpMs?: number | null;
  baseRenders?: number;
  detailRenders?: number;
  cancelled?: number;
  canvasMiBBefore?: number;
  peakCanvasMiB?: number;
}

/** How long each page stayed in a state, from its first frame in it to the first frame out of it. */
function longest(frames: ProbeFrame[], inState: (shot: ProbeFrame["pages"][number]) => boolean) {
  let longestMs = 0;
  const since = new Map<number, number>();
  for (const frame of frames) {
    for (const shot of frame.pages) {
      if (inState(shot)) {
        if (!since.has(shot.page)) since.set(shot.page, frame.t);
      } else if (since.has(shot.page)) {
        longestMs = Math.max(longestMs, frame.t - (since.get(shot.page) ?? frame.t));
        since.delete(shot.page);
      }
    }
  }
  const end = frames.at(-1)?.t ?? 0;
  for (const start of since.values()) longestMs = Math.max(longestMs, end - start);
  return longestMs;
}

async function measure(
  browser: Browser,
  baseUrl: string,
  scenario: Scenario,
  readPixels: boolean,
): Promise<PassResult> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true });
  try {
    const page = await context.newPage();
    await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}?engine=${engine}&file=${file}`);
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
    await settle(page);
    await viewerCall(page, scenario.setup);
    await page.waitForTimeout(300);
    await settle(page);
    await page.evaluate(installProbe, readPixels);
    if (throttle > 1 && browserName === "chromium") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    await page.evaluate(() =>
      (window as unknown as { __commitProbe: { start(): void } }).__commitProbe.start(),
    );
    await page.waitForTimeout(150);
    await scenario.act(page);
    await page.waitForFunction(
      () => {
        const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
        return (scroller.querySelector(":scope > div") as HTMLElement).style.transform === "";
      },
      null,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(200);
    await settle(page);
    await page.waitForTimeout(200);
    const result = (await page.evaluate(() =>
      (window as unknown as { __commitProbe: { stop(): unknown } }).__commitProbe.stop(),
    )) as ProbeResult;
    if (errors.length > 0) throw new Error(errors.join(" | "));
    const { frames, commitAt } = result;
    if (commitAt === null) throw new Error("the zoom never committed");
    const before = frames.filter((frame) => frame.t < commitAt);
    const after = frames.filter((frame) => frame.t >= commitAt);
    const scale: [number, number] = [frames[0]?.scale ?? 0, frames.at(-1)?.scale ?? 0];
    if (readPixels) {
      const blank = (shot: ProbeFrame["pages"][number]) => shot.ink === 0 && shot.reference !== 0;
      const sharpBefore = new Set(
        (before.at(-1)?.pages ?? []).filter((shot) => shot.detail).map((shot) => shot.page),
      );
      const downToBase = (shot: ProbeFrame["pages"][number]) =>
        sharpBefore.has(shot.page) && !shot.detail;
      return {
        scale,
        blankFrames: after.filter((frame) => frame.pages.some(blank)).length,
        blankMs: longest(after, blank),
        baseFrames: after.filter((frame) => frame.pages.some(downToBase)).length,
        baseMs: longest(after, downToBase),
      };
    }
    // Sharp from the first frame after which sharpness never dropped below SHARP.
    let sharpFrom: number | null = null;
    for (const frame of after) {
      if (frame.sharpness < SHARP) sharpFrom = null;
      else sharpFrom ??= frame.t;
    }
    const diff = (key: string) =>
      (result.statsAtEnd?.[key] ?? 0) - (result.statsAtCommit?.[key] ?? 0);
    const MiB = (pixels: number) => (pixels * 4) / 2 ** 20;
    return {
      scale,
      timeToSharpMs: sharpFrom === null ? null : sharpFrom - commitAt,
      baseRenders: diff("base"),
      detailRenders: diff("detail"),
      cancelled: diff("cancelled"),
      canvasMiBBefore: MiB(before[0]?.canvasPixels ?? 0),
      peakCanvasMiB: MiB(Math.max(...after.map((frame) => frame.canvasPixels))),
    };
  } finally {
    await context.close();
  }
}

const power = assertMeasurementPower();
const loadAtStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4182, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4182/";
const launched = await launchBrowser(browserName);
console.log(`${launched.label}, engine ${engine}, ${label}, CPU throttle ${throttle}`);

interface JobResult {
  scenario: string;
  run: number;
  error?: string;
  frames?: PassResult;
  timing?: PassResult;
}
const results: JobResult[] = [];
try {
  for (let run = 1; run <= runs; run++) {
    for (const scenario of scenarios) {
      const job: JobResult = { scenario: scenario.name, run };
      try {
        job.frames = await measureInTurn(launched, (browser) =>
          measure(browser, baseUrl, scenario, true),
        );
        job.timing = await measureInTurn(launched, (browser) =>
          measure(browser, baseUrl, scenario, false),
        );
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
      }
      results.push(job);
      console.log(
        `run ${run} ${scenario.name}: ${job.error ?? JSON.stringify({ ...job.frames, ...job.timing })}`,
      );
    }
  }
} finally {
  await launched.close();
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
const summaries = scenarios.map((scenario) => {
  const ok = results.filter((result) => result.scenario === scenario.name && !result.error);
  const sum = (pick: (result: JobResult) => number | undefined) =>
    ok.reduce((total, result) => total + (pick(result) ?? 0), 0);
  const most = (pick: (result: JobResult) => number | undefined) =>
    Math.max(0, ...ok.map((result) => pick(result) ?? 0));
  const middle = (pick: (result: JobResult) => number | null | undefined) =>
    median(ok.map((result) => pick(result) ?? Number.NaN));
  return {
    scenario: scenario.name,
    description: scenario.description,
    runs: ok.length,
    errors: results
      .filter((result) => result.scenario === scenario.name && result.error)
      .map((result) => result.error),
    scale: ok[0]?.timing?.scale ?? ok[0]?.frames?.scale ?? [0, 0],
    blankFrames: sum((result) => result.frames?.blankFrames),
    blankMs: most((result) => result.frames?.blankMs),
    baseFrames: sum((result) => result.frames?.baseFrames),
    baseMs: most((result) => result.frames?.baseMs),
    timeToSharpMs: middle((result) => result.timing?.timeToSharpMs),
    sharpRuns: ok.filter((result) => result.timing?.timeToSharpMs != null).length,
    baseRenders: middle((result) => result.timing?.baseRenders),
    detailRenders: middle((result) => result.timing?.detailRenders),
    cancelled: middle((result) => result.timing?.cancelled),
    canvasMiBBefore: middle((result) => result.timing?.canvasMiBBefore),
    peakCanvasMiB: middle((result) => result.timing?.peakCanvasMiB),
  };
});

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: launched.label,
  engine,
  build: label,
  throttle,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  settings: { file, runs, viewport, deviceScaleFactor: 2 },
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
  `# ParaPDF runtime prototype: zoom commits, ${environment.browser}, ${label}`,
  "",
  `- Run at: ${environment.runAt}`,
  `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${launched.headless ? "headless" : "headed"})${throttle > 1 ? `, CPU slowed down ${throttle} times through the DevTools protocol` : ""}; power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}; not comparable with AC runs**`}`,
  `- One-minute load average: ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end, on ${cpus().length} cores. The run ${turnTakingSummary()}.`,
  `- Method: ${file} in ${engine === "pdfjs" ? "pdf.js drawing on the main thread" : engine}, ${viewport.width}×${viewport.height} at devicePixelRatio 2, ${runs} runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.`,
  "- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport, before the gesture and at its peak after the commit. Medians.",
  `- Reproduce: \`pnpm --filter @parapdf/prototype build && BROWSER=${browserName}${throttle > 1 ? ` THROTTLE=${throttle}` : ""} node examples/prototype/scripts/commit-bench.ts\`${process.env.DIST ? `, with \`DIST\` pointing at the demo built from ${label.split(",")[0]} in a directory of its own` : ""}`,
  "",
  "| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...summaries.map(
    (summary) =>
      `| ${summary.scenario}${summary.errors.length ? ` (${summary.errors.length} failed)` : ""} | ${fmt(summary.scale[0], 2)} → ${fmt(summary.scale[1], 2)} | ${summary.blankFrames} | ${fmt(summary.blankMs)} | ${summary.baseFrames} | ${fmt(summary.baseMs)} | ${summary.sharpRuns === summary.runs ? fmt(summary.timeToSharpMs) : `${summary.sharpRuns}/${summary.runs} runs sharp`} | ${fmt(summary.baseRenders)} | ${fmt(summary.detailRenders)} | ${fmt(summary.cancelled)} | ${fmt(summary.canvasMiBBefore)} (${fmt(summary.peakCanvasMiB)}) |`,
  ),
  "",
  "Scenarios:",
  "",
  ...summaries.map((summary) => `- ${summary.scenario}: ${summary.description}.`),
  "",
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
