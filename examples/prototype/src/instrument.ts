import type { HybridEngine, HybridEvent, PdfEngine, PdfEngineDocument } from "parapdf";

/** One completed render; `start` and `end` are `performance.now()` values. */
export interface RenderRecord {
  pageIndex: number;
  scale: number;
  start: number;
  end: number;
}

/**
 * What the benchmark driver reads besides the viewer: the duration of every
 * render, timed the same way for every engine, and the hybrid engine's own
 * events (classification, hayro loading, fallbacks) and memory.
 */
export const benchRecords = {
  renders: [] as RenderRecord[],
  hybrid: [] as HybridEvent[],
  memory: null as HybridEngine["memory"] | null,
};

export const recordHybridEvent = (event: HybridEvent) => {
  benchRecords.hybrid.push(event);
};

function timed(doc: PdfEngineDocument): PdfEngineDocument {
  return {
    get pageCount() {
      return doc.pageCount;
    },
    pageSize: (pageIndex) => doc.pageSize(pageIndex),
    render(request) {
      const start = performance.now();
      const task = doc.render(request);
      task.promise.then(
        () =>
          benchRecords.renders.push({
            pageIndex: request.pageIndex,
            scale: request.scale,
            start,
            end: performance.now(),
          }),
        () => {},
      );
      return task;
    },
    getText: (pageIndex) => doc.getText(pageIndex),
    renderTextLayer: (request) => doc.renderTextLayer(request),
    renderAnnotationLayer: (request) => doc.renderAnnotationLayer(request),
    getOutline: () => doc.getOutline(),
    resolveDestination: (dest) => doc.resolveDestination(dest),
    releasePage: (pageIndex) => doc.releasePage(pageIndex),
    destroy: () => doc.destroy(),
  };
}

/** Wraps `engine` so every document records its render durations. */
export function instrumentEngine(engine: PdfEngine): PdfEngine {
  if ("memory" in engine && typeof engine.memory === "function") {
    const hybrid = engine as HybridEngine;
    benchRecords.memory = () => hybrid.memory();
  }
  return {
    name: engine.name,
    open: async (source) => timed(await engine.open(source)),
  };
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN;
};

const summarize = (values: number[]) => ({
  count: values.length,
  p50Ms: quantile(values, 0.5),
  maxMs: values.length ? Math.max(...values) : Number.NaN,
});

/** The scheduler's base renders use this many device pixels per CSS pixel. */
const BASE_FACTOR = 0.5;
const MiB = 2 ** 20;

/**
 * Render durations by canvas layer and engine, when page 1 got its base and
 * full-resolution pixels (ms since navigation start), and the hybrid
 * engine's classification, hayro loading, fallbacks, and memory.
 */
export async function summarizeRecords(layoutScale: number) {
  const layerOf = (scale: number) => (scale <= layoutScale * BASE_FACTOR * 1.5 ? "base" : "detail");
  const events = benchRecords.hybrid;
  // The hybrid engine's choice per page; other engines draw every page with pdf.js.
  const rendererOf = new Map<number, string>();
  for (const event of events) {
    if (event.type === "classified") {
      rendererOf.set(event.pageIndex, event.renderer === "hayro" ? "hayro" : "pdfjs");
    } else if (event.type === "fallback" && event.pageIndex !== null) {
      if (event.reason.startsWith("hayro failed")) rendererOf.set(event.pageIndex, "pdfjs");
    }
  }
  const durations = new Map<string, number[]>();
  for (const record of benchRecords.renders) {
    const key = `${layerOf(record.scale)} ${rendererOf.get(record.pageIndex) ?? "pdfjs"}`;
    const list = durations.get(key) ?? [];
    list.push(record.end - record.start);
    durations.set(key, list);
  }
  const firstEnd = (layer: string) =>
    benchRecords.renders.find((record) => record.pageIndex === 0 && layerOf(record.scale) === layer)
      ?.end ?? null;

  let hybrid = null;
  if (benchRecords.memory) {
    const opened = events.find((event) => event.type === "opened");
    const classified = events.filter((event) => event.type === "classified");
    const loaded = events.find((event) => event.type === "renderer-loaded");
    const memory = await benchRecords.memory().catch(() => null);
    hybrid = {
      opened: opened
        ? {
            at: opened.at,
            fetchMs: opened.fetchMs,
            classifierWaitMs: opened.classifierWaitMs,
            parseMs: opened.parseMs,
            roundTripMs: opened.roundTripMs,
          }
        : null,
      pagesHayro: classified.filter((event) => event.renderer === "hayro").length,
      pagesBase: classified.filter((event) => event.renderer === "base").length,
      firstClassifiedAt: classified.length
        ? Math.min(...classified.map((event) => event.at))
        : null,
      classifyWorker: summarize(classified.map((event) => event.workerMs)),
      classifyRoundTrip: summarize(classified.map((event) => event.roundTripMs)),
      rendererLoad: loaded
        ? { at: loaded.at, loadMs: loaded.loadMs, parseMs: loaded.parseMs }
        : null,
      fallbacks: events
        .filter((event) => event.type === "fallback")
        .map(
          (event) =>
            `page ${event.pageIndex === null ? "-" : event.pageIndex + 1}: ${event.reason}`,
        ),
      classifierMiB: memory ? memory.classifierBytes / MiB : null,
      rendererMiB: memory ? memory.rendererBytes / MiB : null,
    };
  }
  return {
    renderTimes: Object.fromEntries(
      [...durations].map(([key, values]) => [key, summarize(values)] as const),
    ),
    page1: { baseAt: firstEnd("base"), detailAt: firstEnd("detail") },
    hybrid,
  };
}
