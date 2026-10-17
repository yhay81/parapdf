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

async function loadEngine(id: string): Promise<EngineAdapter> {
  switch (id) {
    case "pdfjs":
      return (await import("./engines/pdfjs.ts")).createPdfjsEngine({ hwa: false });
    case "pdfjs-hwa":
      return (await import("./engines/pdfjs.ts")).createPdfjsEngine({ hwa: true });
    case "pdfjs-next":
      return (await import("./engines/pdfjs-next.ts")).createPdfjsNextEngine({ hwa: false });
    case "pdfjs-next-hwa":
      return (await import("./engines/pdfjs-next.ts")).createPdfjsNextEngine({ hwa: true });
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

function gpuRenderer(): string | undefined {
  const gl = document.createElement("canvas").getContext("webgl");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Measures main-thread availability: a 4 ms timer chain records how late each
 * tick fires. Lateness is time the event loop could not service input, so its
 * sum approximates how long rendering kept the main thread busy.
 */
function startLagMonitor(intervalMs = 4) {
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
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
    return {
      samples: lags.length,
      p95Ms: p(0.95),
      maxMs: sorted.at(-1) ?? 0,
      blockedMs: lags.reduce((sum, lag) => sum + lag, 0),
    };
  };
}

/** Records animation-frame intervals while optionally burning `workMs` per frame. */
function startFrameMonitor(workMs: number) {
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
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
    return {
      frames: intervals.length,
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      maxMs: sorted.at(-1) ?? 0,
      // A frame longer than two vsync intervals at 60 Hz means at least one drop.
      dropped: intervals.filter((interval) => interval > 34).length,
    };
  };
}

async function run() {
  if (status) status.textContent = `${engineId} · ${file}`;
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
  await nextFrame();
  const stopFrames = startFrameMonitor(frameWorkMs);
  const stopLag = startLagMonitor();
  const phaseStart = performance.now();
  for (let index = 0; index < pages; index++) {
    const renderStart = performance.now();
    const stats = await engine.render(index, scale);
    renderMs.push(performance.now() - renderStart);
    await nextFrame();
    await nextFrame();
    presentMs.push(performance.now() - renderStart);
    if (stats.rasterMs !== undefined) rasterMs.push(stats.rasterMs);
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
    renderPhaseMs: phaseEnd - phaseStart,
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
