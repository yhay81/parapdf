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
      /** The scale hayro rasterized at: `scale`, or the detail scale when it rendered once. */
      rasterScale?: number;
      /** hayro's rasterization inside the worker; 0 when the base render's pass drew the pixels. */
      rasterMs?: number;
      /** Averaging the full-resolution pixels down for the base layer. */
      reduceMs?: number;
      /** Creating the ImageBitmap inside the worker. */
      bitmapMs?: number;
      /** The worker sent the pixels with the page's base render, before this request. */
      kept?: boolean;
    }
  /** A base render's full-resolution bitmap arrived and waits for the page's detail render. */
  | { type: "kept"; at: number; pageIndex: number; scale: number; bytes: number }
  /**
   * A kept render left the cache: `used` by the detail render, or dropped
   * because the page was released, a newer render replaced it, the cache was
   * full, the request had another scale, or its base render was cancelled or
   * failed. `bytes` is 0 when its bitmap had not arrived yet.
   */
  | {
      type: "kept-released";
      at: number;
      pageIndex: number;
      used: boolean;
      reason: string;
      bytes: number;
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
  /**
   * How hayro draws a page's detail layer when the page's base render
   * carries `detailScale`. hayro decodes a page's images on every render.
   * - `"once"` (default): one pass at the detail scale; the base layer gets a
   *   reduced copy, and the detail render shows the kept full-resolution
   *   bitmap.
   * - `"base-first"`: the base pass, then the detail pass right away, ahead
   *   of other queued renders, kept for the detail render.
   * - `"separate"`: each layer when it is requested, as two independent
   *   renders.
   */
  detailRender?: "once" | "base-first" | "separate";
  /**
   * Detail-layer bitmaps a document keeps until their pages' detail renders
   * ask for them; the oldest is dropped first (default 3: a visible page and
   * the two overscan pages below it, which the scheduler renders before any
   * overscan detail). Each becomes a detail canvas the scheduler would fill
   * anyway, so they add memory only for pages released before that.
   */
  maxKeptRenders?: number;
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

  /** A reply the worker sends without a request of its own, such as a render's `detail`. */
  expect<T>() {
    const id = this.#nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      if (this.#failure) return reject(this.#failure);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    // Callers that drop the reply must not see an unhandled rejection.
    promise.catch(() => {});
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
  detailRender: NonNullable<HybridEngineOptions["detailRender"]>;
  maxKeptRenders: number;
  emit: (event: HybridEvent) => void;
}

/** A base render's full-resolution bitmap, kept for the page's detail render. */
interface Kept {
  /** The worker's id for the delivery, which cancelling drops when still queued. */
  id: number;
  scale: number;
  /** Rejects when the worker did not deliver it (cancelled or failed). */
  delivery: Promise<RenderResult>;
  /** Width × height × 4 once the bitmap arrived, 0 before. */
  bytes: number;
}

const sameScale = (a: number, b: number): boolean => Math.abs(a - b) <= b * 0.01;

/** Closes a kept bitmap whenever it arrives. */
const discard = (kept: Kept) =>
  kept.delivery.then(
    (result) => result.bitmap.close(),
    () => {},
  );

class HybridDocument implements PdfEngineDocument {
  readonly #base: PdfEngineDocument;
  readonly #channel: WorkerChannel | null;
  readonly #doc: number;
  readonly #settings: Settings;
  readonly #decisions = new Map<number, Promise<PageRenderer>>();
  /** Canvases holding a `bitmaprenderer` context, which pdf.js cannot draw into. */
  readonly #bitmapCanvases = new WeakSet<object>();
  /** Full-resolution renders kept for the next detail render, by page, oldest first. */
  readonly #kept = new Map<number, Kept>();
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
    this.#dropKept(pageIndex, "released");
    this.#base.releasePage(pageIndex);
  }

  async destroy(): Promise<void> {
    for (const pageIndex of [...this.#kept.keys()]) this.#dropKept(pageIndex, "closed");
    void this.#channel?.call({ type: "close", doc: this.#doc }).promise.catch(() => {});
    await this.#base.destroy();
  }

  /** Keeps the full-resolution bitmap that a base render of `pageIndex` delivers later. */
  #keep(pageIndex: number, id: number, scale: number, delivery: Promise<RenderResult>): Kept {
    this.#dropKept(pageIndex, "replaced");
    for (const oldest of this.#kept.keys()) {
      if (this.#kept.size < this.#settings.maxKeptRenders) break;
      this.#dropKept(oldest, "cache full");
    }
    const kept: Kept = { id, scale, delivery, bytes: 0 };
    this.#kept.set(pageIndex, kept);
    delivery.then(
      (result) => {
        if (this.#kept.get(pageIndex) !== kept) return;
        kept.bytes = result.width * result.height * 4;
        this.#settings.emit({
          type: "kept",
          at: performance.now(),
          pageIndex,
          scale,
          bytes: kept.bytes,
        });
      },
      () => this.#dropKept(pageIndex, "not delivered", kept),
    );
    return kept;
  }

  /** Removes the kept render of `pageIndex` (only `which`, when given) and closes its bitmap. */
  #dropKept(pageIndex: number, reason: string, which?: Kept): void {
    const kept = this.#kept.get(pageIndex);
    if (!kept || (which && kept !== which)) return;
    this.#kept.delete(pageIndex);
    // A detail pass still queued in the worker is not worth running.
    this.#channel?.cancel(kept.id);
    void discard(kept);
    this.#settings.emit({
      type: "kept-released",
      at: performance.now(),
      pageIndex,
      used: false,
      reason,
      bytes: kept.bytes,
    });
  }

  /** The kept render of `pageIndex` if it has `scale`; one with another scale is dropped. */
  #takeKept(pageIndex: number, scale: number): Kept | undefined {
    const kept = this.#kept.get(pageIndex);
    if (!kept) return undefined;
    if (!sameScale(kept.scale, scale)) {
      this.#dropKept(pageIndex, "other scale");
      return undefined;
    }
    this.#kept.delete(pageIndex);
    this.#settings.emit({
      type: "kept-released",
      at: performance.now(),
      pageIndex,
      used: true,
      reason: "used",
      bytes: kept.bytes,
    });
    return kept;
  }

  render(request: RenderRequest): RenderTask {
    const { pageIndex, scale, detailScale } = request;
    const cancelled = cancellation();
    let isCancelled = false;
    let inner: RenderTask | undefined;
    let workerRequest: number | undefined;

    // A cancel that lands after a step settled but before this code resumes
    // must still stop the render.
    const stopIfCancelled = () => {
      if (isCancelled) throw new RenderCancelledError("render cancelled");
    };

    const promise = (async () => {
      const start = performance.now();
      // The worker may have sent this layer along with the page's base layer.
      const kept = this.#takeKept(pageIndex, scale);
      if (kept) {
        try {
          const result = await Promise.race([kept.delivery, cancelled.promise]);
          if (isCancelled) result.bitmap.close();
          stopIfCancelled();
          show(request.canvas, result.bitmap, this.#bitmapCanvases);
          this.#settings.emit({
            type: "rendered",
            at: performance.now(),
            pageIndex,
            scale,
            renderer: "hayro",
            ms: performance.now() - start,
            rasterScale: result.rasterScale,
            rasterMs: result.rasterMs,
            bitmapMs: result.bitmapMs,
            kept: true,
          });
          return;
        } catch (error) {
          if (isCancelled) {
            this.#channel?.cancel(kept.id);
            void discard(kept);
            throw error;
          }
          // The worker did not deliver the kept pixels; render them now.
        }
      }
      const renderer = await Promise.race([this.#decide(pageIndex), cancelled.promise]);
      stopIfCancelled();
      const channel = this.#channel;
      if (renderer === "hayro" && channel) {
        // The worker sends the detail layer unasked: from the same pass when
        // rendering once (the detail scale must be at least twice this
        // one), or from a second pass right after this one.
        const mode = this.#settings.detailRender;
        const detail =
          detailScale !== undefined &&
          (mode === "once"
            ? Math.round(detailScale / scale) >= 2
            : mode === "base-first" && detailScale > scale * 1.01)
            ? { scale: detailScale, once: mode === "once", ...channel.expect<RenderResult>() }
            : undefined;
        let keptRender: Kept | undefined;
        try {
          const { id, promise: rendering } = channel.call<RenderResult>({
            type: "render",
            doc: this.#doc,
            index: pageIndex,
            scale,
            detail: detail && { id: detail.id, scale: detail.scale, once: detail.once },
          });
          workerRequest = id;
          if (detail) {
            keptRender = this.#keep(pageIndex, detail.id, detail.scale, detail.promise);
          }
          // A bitmap that arrives after cancellation still has to be released.
          rendering.then(
            (result) => isCancelled && result.bitmap.close(),
            () => {},
          );
          const result = await Promise.race([rendering, cancelled.promise]);
          if (isCancelled) result.bitmap.close();
          stopIfCancelled();
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
            scale,
            renderer: "hayro",
            ms: performance.now() - start,
            rasterScale: result.rasterScale,
            rasterMs: result.rasterMs,
            reduceMs: result.reduceMs,
            bitmapMs: result.bitmapMs,
          });
          return;
        } catch (error) {
          if (keptRender) {
            this.#dropKept(pageIndex, isCancelled ? "base cancelled" : "base failed", keptRender);
          }
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
        scale,
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
    detailRender: options.detailRender ?? "once",
    maxKeptRenders: Math.max(1, options.maxKeptRenders ?? 3),
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
