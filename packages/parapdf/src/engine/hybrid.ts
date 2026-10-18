import type {
  ClassifyResult,
  HybridReply,
  HybridRequest,
  MemoryResult,
  OpenResult,
  RenderResult,
} from "./hybrid-worker.ts";
import {
  isRenderCancelled,
  type PdfEngine,
  type PdfEngineDocument,
  type PdfSource,
  RenderCancelledError,
  type RenderRequest,
  type RenderTask,
} from "./types.ts";

/** Which engine draws a page: the base engine (pdf.js) or hayro. */
export type PageRenderer = "base" | "hayro";

/** What the classifier found on one page; see bench/hayro-classify. */
export interface PageClassification {
  /** Text-showing operators in a visible rendering mode. */
  visibleText: number;
  /** Text-showing operators in the invisible modes OCR text layers use. */
  invisibleText: number;
  pathSegments: number;
  images: number;
  /** Share of the page the largest image covers, 0 to 1. */
  imageCoverage: number;
  shadings: number;
  forms: number;
  /** Visible non-link annotations with an appearance stream. */
  annotations: number;
  operators: number;
  /** The walk stopped early because the page cannot be image-only. */
  stopped: boolean;
}

/** Measurement events; `at` is `performance.now()` when the event happened. */
export type HybridEvent =
  | ({ type: "opened"; at: number; roundTripMs: number } & OpenResult)
  | {
      type: "classified";
      at: number;
      pageIndex: number;
      renderer: PageRenderer;
      classification: PageClassification | null;
      /** Time spent classifying inside the worker. */
      workerMs: number;
      /** From the request until the answer reached the main thread. */
      roundTripMs: number;
    }
  | { type: "renderer-loaded"; at: number; loadMs: number; parseMs: number }
  | {
      type: "rendered";
      at: number;
      pageIndex: number;
      scale: number;
      renderer: PageRenderer;
      /** From the render request until the pixels were on the canvas. */
      ms: number;
      /** hayro's raster and bitmap time inside the worker. */
      rasterMs?: number;
    }
  | { type: "fallback"; at: number; pageIndex: number | null; reason: string };

export interface HybridEngineOptions {
  /**
   * Renders every page that is not image-only, and provides text layers,
   * links, search, the outline, and page sizes for all pages.
   */
  base: PdfEngine;
  /** Starts the worker entry that calls `serveHybridWorker`. */
  createWorker: () => Worker;
  /** hayro draws a page only if one image covers at least this share of it. */
  minImageCoverage?: number;
  /** ... and the page has at most this many path segments. */
  maxPathSegments?: number;
  /** Pages with more encoded content than this go to the base engine unread. */
  maxContentBytes?: number;
  /** How long a render waits for its page's classification before using the base engine. */
  classifyTimeoutMs?: number;
  onEvent?: (event: HybridEvent) => void;
}

export interface HybridEngine extends PdfEngine {
  /** WebAssembly memory of the worker's modules, or null without a worker. */
  memory(): Promise<MemoryResult | null>;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** Request/response channel to the hybrid worker. */
class WorkerChannel {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #failure: Error | null = null;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<HybridReply>) => {
      const reply = event.data;
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      if (reply.ok) pending.resolve(reply.result);
      else if (reply.cancelled) pending.reject(new RenderCancelledError("cancelled in the worker"));
      else pending.reject(new Error(reply.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.#failure = new Error(`hybrid worker failed: ${event.message}`);
      for (const pending of this.#pending.values()) pending.reject(this.#failure);
      this.#pending.clear();
    };
  }

  call<T>(request: WithoutId<HybridRequest>, transfer: Transferable[] = []) {
    const id = this.#nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      if (this.#failure) return reject(this.#failure);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#worker.postMessage({ ...request, id }, transfer);
    });
    return { id, promise };
  }

  cancel(target: number): void {
    if (this.#pending.has(target)) this.#worker.postMessage({ id: 0, type: "cancel", target });
  }
}

const toClassification = (stats: readonly number[]): PageClassification => {
  const [
    visibleText = 0,
    invisibleText = 0,
    pathSegments = 0,
    images = 0,
    imageCoverage = 0,
    shadings = 0,
    forms = 0,
    annotations = 0,
    operators = 0,
    stopped = 0,
  ] = stats;
  return {
    visibleText,
    invisibleText,
    pathSegments,
    images,
    imageCoverage,
    shadings,
    forms,
    annotations,
    operators,
    stopped: stopped !== 0,
  };
};

/** A promise that rejects once `cancel` runs, to race against slow steps. */
function cancellation() {
  let cancel = () => {};
  const promise = new Promise<never>((_, reject) => {
    cancel = () => reject(new RenderCancelledError("render cancelled"));
  });
  promise.catch(() => {});
  return { promise, cancel };
}

/**
 * Shows a worker bitmap without copying it. A canvas that pdf.js drew before
 * (a render that ran before its page was classified) already has a 2D
 * context, so it gets the bitmap drawn instead.
 */
function show(canvas: HTMLCanvasElement, bitmap: ImageBitmap, bitmapCanvases: WeakSet<object>) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const renderer = canvas.getContext("bitmaprenderer");
  if (renderer) {
    bitmapCanvases.add(canvas);
    renderer.transferFromImageBitmap(bitmap);
    return;
  }
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
}

interface Settings {
  minImageCoverage: number;
  maxPathSegments: number;
  maxContentBytes: number;
  classifyTimeoutMs: number;
  emit: (event: HybridEvent) => void;
}

class HybridDocument implements PdfEngineDocument {
  readonly #base: PdfEngineDocument;
  readonly #channel: WorkerChannel | null;
  readonly #doc: number;
  readonly #settings: Settings;
  readonly #decisions = new Map<number, Promise<PageRenderer>>();
  /** Canvases holding a `bitmaprenderer` context, which pdf.js cannot draw into. */
  readonly #bitmapCanvases = new WeakSet<object>();
  #hayroFailures = 0;

  constructor(
    base: PdfEngineDocument,
    channel: WorkerChannel | null,
    doc: number,
    settings: Settings,
  ) {
    this.#base = base;
    this.#channel = channel;
    this.#doc = doc;
    this.#settings = settings;
  }

  get pageCount(): number {
    return this.#base.pageCount;
  }

  pageSize(pageIndex: number) {
    return this.#base.pageSize(pageIndex);
  }

  getText(pageIndex: number) {
    return this.#base.getText(pageIndex);
  }

  renderTextLayer(request: Parameters<PdfEngineDocument["renderTextLayer"]>[0]) {
    return this.#base.renderTextLayer(request);
  }

  renderAnnotationLayer(request: Parameters<PdfEngineDocument["renderAnnotationLayer"]>[0]) {
    return this.#base.renderAnnotationLayer(request);
  }

  getOutline() {
    return this.#base.getOutline();
  }

  resolveDestination(dest: unknown) {
    return this.#base.resolveDestination(dest);
  }

  releasePage(pageIndex: number): void {
    this.#base.releasePage(pageIndex);
  }

  async destroy(): Promise<void> {
    void this.#channel?.call({ type: "close", doc: this.#doc }).promise.catch(() => {});
    await this.#base.destroy();
  }

  render(request: RenderRequest): RenderTask {
    const { pageIndex } = request;
    const cancelled = cancellation();
    let isCancelled = false;
    let inner: RenderTask | undefined;
    let workerRequest: number | undefined;

    const promise = (async () => {
      const start = performance.now();
      const renderer = await Promise.race([this.#decide(pageIndex), cancelled.promise]);
      const channel = this.#channel;
      if (renderer === "hayro" && channel) {
        try {
          const { id, promise: rendering } = channel.call<RenderResult>({
            type: "render",
            doc: this.#doc,
            index: pageIndex,
            scale: request.scale,
          });
          workerRequest = id;
          // A bitmap that arrives after cancellation still has to be released.
          rendering.then(
            (result) => isCancelled && result.bitmap.close(),
            () => {},
          );
          const result = await Promise.race([rendering, cancelled.promise]);
          if (result.rendererLoad) {
            this.#settings.emit({
              type: "renderer-loaded",
              at: performance.now(),
              ...result.rendererLoad,
            });
          }
          show(request.canvas, result.bitmap, this.#bitmapCanvases);
          this.#settings.emit({
            type: "rendered",
            at: performance.now(),
            pageIndex,
            scale: request.scale,
            renderer: "hayro",
            ms: performance.now() - start,
            rasterMs: result.rasterMs,
          });
          return;
        } catch (error) {
          if (isCancelled || isRenderCancelled(error)) throw error;
          this.#hayroFailed(pageIndex, error);
        }
      }
      inner = this.#renderBase(request);
      await inner.promise;
      this.#settings.emit({
        type: "rendered",
        at: performance.now(),
        pageIndex,
        scale: request.scale,
        renderer: "base",
        ms: performance.now() - start,
      });
    })();

    return {
      promise,
      cancel: () => {
        isCancelled = true;
        cancelled.cancel();
        inner?.cancel();
        if (workerRequest !== undefined) this.#channel?.cancel(workerRequest);
      },
    };
  }

  /** The base engine's render, through a scratch canvas when hayro owns `canvas`. */
  #renderBase(request: RenderRequest): RenderTask {
    if (!this.#bitmapCanvases.has(request.canvas)) return this.#base.render(request);
    const scratch = document.createElement("canvas");
    const task = this.#base.render({ ...request, canvas: scratch });
    return {
      promise: task.promise.then(async () => {
        show(request.canvas, await createImageBitmap(scratch), this.#bitmapCanvases);
        scratch.width = 0;
        scratch.height = 0;
      }),
      cancel: () => task.cancel(),
    };
  }

  #hayroFailed(pageIndex: number, error: unknown): void {
    this.#hayroFailures++;
    this.#decisions.set(pageIndex, Promise.resolve("base"));
    this.#settings.emit({
      type: "fallback",
      at: performance.now(),
      pageIndex,
      reason: `hayro failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    });
  }

  /** The page's renderer, or the base engine if classification is slow or failed. */
  async #decide(pageIndex: number): Promise<PageRenderer> {
    // After repeated failures, stop sending pages to hayro for this document.
    if (!this.#channel || this.#hayroFailures >= 2) return "base";
    let decision = this.#decisions.get(pageIndex);
    if (!decision) {
      decision = this.#classify(pageIndex);
      this.#decisions.set(pageIndex, decision);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.#settings.classifyTimeoutMs);
    });
    const renderer = await Promise.race([decision, timeout]);
    clearTimeout(timer);
    if (renderer !== "timeout") return renderer;
    // This render uses the base engine; later renders of the page still get the answer.
    this.#settings.emit({
      type: "fallback",
      at: performance.now(),
      pageIndex,
      reason: "classification timed out",
    });
    return "base";
  }

  async #classify(pageIndex: number): Promise<PageRenderer> {
    const channel = this.#channel;
    if (!channel) return "base";
    const { minImageCoverage, maxPathSegments, maxContentBytes } = this.#settings;
    const start = performance.now();
    let classification: PageClassification | null = null;
    let workerMs = 0;
    let renderer: PageRenderer = "base";
    try {
      const result = await channel.call<ClassifyResult>({
        type: "classify",
        doc: this.#doc,
        index: pageIndex,
        maxPathSegments,
        maxContentBytes,
      }).promise;
      classification = toClassification(result.stats);
      workerMs = result.ms;
      const imageOnly =
        !classification.stopped &&
        classification.visibleText === 0 &&
        classification.images > 0 &&
        classification.imageCoverage >= minImageCoverage &&
        classification.pathSegments <= maxPathSegments &&
        classification.shadings === 0 &&
        classification.annotations === 0;
      if (imageOnly) renderer = "hayro";
    } catch (error) {
      this.#settings.emit({
        type: "fallback",
        at: performance.now(),
        pageIndex,
        reason: `classification failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      });
    }
    this.#settings.emit({
      type: "classified",
      at: performance.now(),
      pageIndex,
      renderer,
      classification,
      workerMs,
      roundTripMs: performance.now() - start,
    });
    return renderer;
  }
}

/**
 * Renders image-only pages (scans) with hayro, compiled to WebAssembly, and
 * every other page with the base engine, which also keeps text layers,
 * links, and search for all pages. A small classifier module in the worker
 * reads each page's content stream before its first render, without decoding
 * images; the hayro module loads only when the first image-only page is
 * about to render.
 */
export function createHybridEngine(options: HybridEngineOptions): HybridEngine {
  const { base } = options;
  const emit = options.onEvent ?? (() => {});
  const settings: Settings = {
    minImageCoverage: options.minImageCoverage ?? 0.5,
    maxPathSegments: options.maxPathSegments ?? 64,
    maxContentBytes: options.maxContentBytes ?? 256 * 1024,
    classifyTimeoutMs: options.classifyTimeoutMs ?? 250,
    emit,
  };
  // Like pdf.js's parsing worker, start now so the classifier module loads
  // while React mounts. One worker serves every document of this engine.
  let channel: WorkerChannel | null = null;
  try {
    channel = new WorkerChannel(options.createWorker());
  } catch (error) {
    emit({ type: "fallback", at: performance.now(), pageIndex: null, reason: String(error) });
  }
  let nextDoc = 1;

  return {
    name: `${base.name} + hayro for image-only pages`,
    async open(source: PdfSource): Promise<PdfEngineDocument> {
      const doc = nextDoc++;
      if (channel) {
        const start = performance.now();
        let opening: { promise: Promise<OpenResult> };
        if ("url" in source) {
          opening = channel.call<OpenResult>({
            type: "open",
            doc,
            url: new URL(source.url, document.baseURI).href,
          });
        } else {
          // pdf.js takes ownership of the typed arrays it is given, so the
          // worker gets its own copy first.
          const { data } = source;
          const copy = data instanceof Uint8Array ? data.slice().buffer : data.slice(0);
          opening = channel.call<OpenResult>({ type: "open", doc, data: copy }, [copy]);
        }
        opening.promise.then(
          (result) =>
            emit({
              type: "opened",
              at: performance.now(),
              roundTripMs: performance.now() - start,
              ...result,
            }),
          (error: unknown) =>
            emit({
              type: "fallback",
              at: performance.now(),
              pageIndex: null,
              reason: `the classifier could not open the document: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
            }),
        );
      }
      try {
        return new HybridDocument(await base.open(source), channel, doc, settings);
      } catch (error) {
        void channel?.call({ type: "close", doc }).promise.catch(() => {});
        throw error;
      }
    },
    async memory() {
      return channel ? channel.call<MemoryResult>({ type: "memory" }).promise : null;
    },
  };
}
