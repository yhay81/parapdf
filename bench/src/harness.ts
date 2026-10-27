import type { EngineAdapter } from "./engines/types.ts";

/**
 * Runs one benchmark job described by the URL query and publishes the result
 * on `window.__result`. The Playwright runner opens a fresh page per job so
 * caches and leaked memory never carry over between engines.
 */

declare global {
  interface Window {
    __done?: boolean;
    __result?: unknown;
  }
}

interface TaskTiming {
  startTime: number;
  duration: number;
  blockingDuration?: number;
}

const params = new URLSearchParams(location.search);
const engineId = params.get("engine") ?? "pdfjs";
const file = params.get("file") ?? "f1040.pdf";
const scale = Number(params.get("scale") ?? "2.6667");
const maxPages = Number(params.get("pages") ?? "10");
// Synthetic application work per animation frame (ms), standing in for the
// layout and React commits a viewer performs while the user scrolls.
const frameWorkMs = Number(params.get("frameWork") ?? "0");
// Fidelity runs (scripts/fidelity.ts) read every page's pixels back after it
// renders, which costs time, so their timings are not results.
const digestPages = params.get("digest") === "1";
const status = document.getElementById("status");
const stage = document.getElementById("stage");

const longTasks: TaskTiming[] = [];
const animationFrames: TaskTiming[] = [];
for (const [type, sink] of [
  ["longtask", longTasks],
  ["long-animation-frame", animationFrames],
] as const) {
  try {
    new PerformanceObserver((list) => {
      sink.push(...(list.getEntries() as unknown as TaskTiming[]));
    }).observe({ type, buffered: true });
  } catch {
    // Unsupported entry type; the summary reports zero entries.
  }
}

async function loadEngine(engineId: string): Promise<EngineAdapter> {
  // "-pathtext" variants of released pdf.js draw text as paths
  // (`disableFontFace`) instead of with the fonts it loads as FontFaces.
  const pathText = engineId.endsWith("-pathtext");
  const id = pathText ? engineId.slice(0, -"-pathtext".length) : engineId;
  if (pathText && id !== "pdfjs" && id !== "pdfjs-hwa") {
    throw new Error(`${engineId}: -pathtext applies to pdfjs and pdfjs-hwa only`);
  }
  // "-frame" variants of the pdf.js engines draw off screen and show frames,
  // and "-record" variants record each operation's box as pdf.js draws.
  const record = id.endsWith("-record");
  const variantOf = record ? id.slice(0, -"-record".length) : id;
  const frame = variantOf.endsWith("-frame");
  // Only released pdf.js drawing in place records; a label claiming more would mislead.
  if (record && (frame || variantOf.startsWith("pdfjs-next"))) {
    throw new Error(`${id}: -record applies to pdfjs and pdfjs-hwa drawing in place only`);
  }
  switch (frame ? variantOf.slice(0, -"-frame".length) : variantOf) {
    case "pdfjs":
      return (await import("./engines/pdfjs.ts")).createPdfjsEngine({
        hwa: false,
        frame,
        record,
        pathText,
      });
    case "pdfjs-hwa":
      return (await import("./engines/pdfjs.ts")).createPdfjsEngine({
        hwa: true,
        frame,
        record,
        pathText,
      });
    case "pdfjs-next":
      return (await import("./engines/pdfjs-next.ts")).createPdfjsNextEngine({ hwa: false, frame });
    case "pdfjs-next-hwa":
      return (await import("./engines/pdfjs-next.ts")).createPdfjsNextEngine({ hwa: true, frame });
    case "pdfium":
      return (await import("./engines/pdfium.ts")).createPdfiumEngine();
    case "hayro":
      return (await import("./engines/hayro.ts")).createHayroEngine();
    default:
      throw new Error(`unknown engine: ${id}`);
  }
}

function summarize(entries: TaskTiming[], from: number, to: number) {
  const inRange = entries.filter((entry) => entry.startTime >= from && entry.startTime <= to);
  const durations = inRange.map((entry) => entry.duration);
  return {
    count: inRange.length,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    blockingMs: inRange.reduce(
      (sum, entry) => sum + (entry.blockingDuration ?? Math.max(0, entry.duration - 50)),
      0,
    ),
    maxMs: durations.length ? Math.max(...durations) : 0,
  };
}

function thumbnail(source: HTMLCanvasElement, width = 480): string {
  const target = document.createElement("canvas");
  target.width = width;
  target.height = Math.round((source.height * width) / source.width);
  target.getContext("2d")?.drawImage(source, 0, 0, target.width, target.height);
  return target.toDataURL("image/png");
}

/** Width of the pixel sample fidelity runs return for comparing drawings that differ. */
const SAMPLE_WIDTH = 256;

/**
 * The displayed canvas's pixels, read through a 2D canvas so that canvases
 * with any context, `bitmaprenderer` included, read alike: a SHA-256 digest
 * of all of them, and RGBA at SAMPLE_WIDTH pixels wide. Both are composited
 * over white, as the page shows them: engines that leave a page's backdrop
 * transparent (PDFium and hayro on pages with transparency) would otherwise
 * differ from opaque pdf.js canvases wherever nothing is drawn.
 */
async function pagePixels(source: HTMLCanvasElement) {
  const full = document.createElement("canvas");
  full.width = source.width;
  full.height = source.height;
  const context = full.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2D context to read pixels back");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, full.width, full.height);
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, full.width, full.height).data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels));
  const sample = document.createElement("canvas");
  sample.width = SAMPLE_WIDTH;
  sample.height = Math.round((source.height * SAMPLE_WIDTH) / source.width);
  const sampled = sample.getContext("2d", { willReadFrequently: true });
  if (sampled) {
    sampled.fillStyle = "#fff";
    sampled.fillRect(0, 0, sample.width, sample.height);
  }
  sampled?.drawImage(source, 0, 0, sample.width, sample.height);
  const rgba =
    sampled?.getImageData(0, 0, sample.width, sample.height).data ?? new Uint8ClampedArray();
  let binary = "";
  for (let at = 0; at < rgba.length; at += 0x8000) {
    binary += String.fromCharCode(...rgba.subarray(at, at + 0x8000));
  }
  return {
    width: source.width,
    height: source.height,
    digest: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    sample: { width: sample.width, height: sample.height, rgba: btoa(binary) },
  };
}

function gpuRenderer(): string | undefined {
  const gl = document.createElement("canvas").getContext("webgl");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const quantile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;

/**
 * Measures main-thread availability: a 4 ms timer chain records how late each
 * tick fires. Lateness is time the event loop could not service input, so its
 * sum approximates how long rendering kept the main thread busy. Only lateness
 * beyond `thresholdMs` counts as blocked; see blockedThreshold().
 */
function startLagMonitor(thresholdMs: number, intervalMs = 4) {
  const lags: number[] = [];
  let running = true;
  let expected = performance.now() + intervalMs;
  const tick = () => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + intervalMs;
    if (running) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => {
    running = false;
    const sorted = [...lags].sort((a, b) => a - b);
    return {
      samples: lags.length,
      p95Ms: quantile(sorted, 0.95),
      maxMs: sorted.at(-1) ?? 0,
      blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - thresholdMs), 0),
      rawLagMs: lags.reduce((sum, lag) => sum + lag, 0),
    };
  };
}

/**
 * Lateness that counts as blocked: beyond 2 ms, so the small delays every
 * frame adds while a page scrolls or animates do not pile up, and beyond the
 * idle page's 95th percentile, because WebKit delivers even idle timers about
 * 4 ms late.
 */
const blockedThreshold = (idle: { timerLagP95Ms: number }): number =>
  Math.max(2, idle.timerLagP95Ms);

/**
 * Timer lateness and frame interval of the idle page, measured before the
 * engine loads: the baseline that blocked time and dropped frames are judged
 * against in each browser.
 */
async function measureIdle(durationMs = 500) {
  const lags: number[] = [];
  const frames: number[] = [];
  const until = performance.now() + durationMs;
  await Promise.all([
    new Promise<void>((resolve) => {
      let expected = performance.now() + 4;
      const tick = () => {
        const now = performance.now();
        lags.push(Math.max(0, now - expected));
        expected = now + 4;
        if (now < until) setTimeout(tick, 4);
        else resolve();
      };
      setTimeout(tick, 4);
    }),
    new Promise<void>((resolve) => {
      let last = -1;
      const tick = (now: number) => {
        if (last >= 0) frames.push(now - last);
        last = now;
        if (now < until) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    }),
  ]);
  lags.sort((a, b) => a - b);
  frames.sort((a, b) => a - b);
  return {
    timerLagP50Ms: quantile(lags, 0.5),
    timerLagP95Ms: quantile(lags, 0.95),
    frameIntervalMs: quantile(frames, 0.5),
  };
}

/**
 * Records animation-frame intervals while optionally burning `workMs` per
 * frame. A frame longer than 1.5 idle intervals missed at least one vsync.
 */
function startFrameMonitor(workMs: number, idleFrameMs: number) {
  const intervals: number[] = [];
  let running = true;
  let last = performance.now();
  const tick = (now: number) => {
    intervals.push(now - last);
    last = now;
    if (workMs > 0) {
      const until = performance.now() + workMs;
      while (performance.now() < until) {
        // Busy-wait: the point is to occupy the main thread like app work would.
      }
    }
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      frames: intervals.length,
      p50Ms: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      maxMs: sorted.at(-1) ?? 0,
      dropped: intervals.filter((interval) => interval > idleFrameMs * 1.5).length,
    };
  };
}

async function run() {
  if (status) status.textContent = `${engineId} · ${file}`;
  const idle = await measureIdle();
  const start = performance.now();
  const engine = await loadEngine(engineId);
  stage?.append(engine.canvas);
  await engine.init();
  const initMs = performance.now() - start;

  const data = await (await fetch(`/corpus/${file}`)).arrayBuffer();
  const openStart = performance.now();
  const { pageCount } = await engine.open(data);
  const openMs = performance.now() - openStart;

  const pages = Math.min(pageCount, maxPages);
  // `renderMs` ends when pixels are committed to the canvas. GPU canvases may
  // still rasterize afterwards, so `presentMs` also waits two animation frames,
  // by which point the committed frame has been produced.
  const renderMs: number[] = [];
  const presentMs: number[] = [];
  const rasterMs: number[] = [];
  const frameMs: number[] = [];
  const pixels: Awaited<ReturnType<typeof pagePixels>>[] = [];
  await nextFrame();
  const stopFrames = startFrameMonitor(frameWorkMs, idle.frameIntervalMs);
  const stopLag = startLagMonitor(blockedThreshold(idle));
  const phaseStart = performance.now();
  for (let index = 0; index < pages; index++) {
    const renderStart = performance.now();
    const stats = await engine.render(index, scale);
    renderMs.push(performance.now() - renderStart);
    await nextFrame();
    await nextFrame();
    presentMs.push(performance.now() - renderStart);
    if (stats.rasterMs !== undefined) rasterMs.push(stats.rasterMs);
    if (stats.frameMs !== undefined) frameMs.push(stats.frameMs);
    if (digestPages) pixels.push(await pagePixels(engine.canvas));
  }
  const warmStart = performance.now();
  await engine.render(0, scale);
  const warmFirstRenderMs = performance.now() - warmStart;
  const phaseEnd = performance.now();
  const frames = stopFrames();
  const lag = stopLag();

  // Let the observers deliver entries that end inside the render phase.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const result = {
    engine: engineId,
    version: engine.version,
    file,
    scale,
    pageCount,
    renderedPages: pages,
    initMs,
    openMs,
    frameWorkMs,
    firstRenderMs: renderMs[0],
    firstPresentMs: presentMs[0],
    warmFirstRenderMs,
    renderMs,
    presentMs,
    rasterMs,
    frameMs,
    renderPhaseMs: phaseEnd - phaseStart,
    idle,
    frames,
    lag,
    longTasks: summarize(longTasks, phaseStart, phaseEnd),
    animationFrames: summarize(animationFrames, phaseStart, phaseEnd),
    jsHeapBytes: memory?.usedJSHeapSize,
    wasmMemoryBytes: await engine.memoryBytes(),
    usesRendererWorker:
      "usesRendererWorker" in engine && typeof engine.usesRendererWorker === "function"
        ? engine.usesRendererWorker()
        : undefined,
    canvas: { width: engine.canvas.width, height: engine.canvas.height },
    environment: {
      userAgent: navigator.userAgent,
      gpu: gpuRenderer(),
      crossOriginIsolated,
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    thumbnail: thumbnail(engine.canvas),
    ...(digestPages ? { pixels } : {}),
  };
  await engine.close();
  return result;
}

run()
  .then((result) => {
    window.__result = result;
  })
  .catch((error: unknown) => {
    window.__result = {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  })
  .finally(() => {
    window.__done = true;
    if (status) status.textContent += " · done";
  });
