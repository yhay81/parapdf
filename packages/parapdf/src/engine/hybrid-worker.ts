/**
 * The worker half of the hybrid engine (see hybrid.ts). It classifies pages
 * with a small parser module that loads with the worker, and renders
 * image-only pages with a rasterizer module that loads only when the first
 * such page is about to render. The application's worker entry supplies both
 * modules and calls `serveHybridWorker`.
 */

/** A document opened by the classifier module. */
export interface ClassifierDocument {
  pageCount(): number;
  /**
   * `[visibleText, invisibleText, pathSegments, images, imageCoverage,
   * shadings, forms, annotations, operators, stopped]` for one page.
   */
  classify(index: number, maxPathSegments: number, maxContentBytes: number): Float64Array;
  free(): void;
}

export interface ClassifierModule {
  readonly memory: WebAssembly.Memory;
  open(data: Uint8Array): ClassifierDocument;
}

/** One rasterized page, as tightly packed RGBA8 rows in the module's memory. */
export interface RenderedPixels {
  readonly width: number;
  readonly height: number;
  /** The pixels in place; valid until `free` or the next call into the module. */
  view(): Uint8ClampedArray<ArrayBuffer>;
  /**
   * A copy at `1 / factor` of the size, `floor(width / factor)` ×
   * `floor(height / factor)` pixels, each the mean of a `factor` × `factor`
   * block.
   */
  reduce(factor: number): Uint8Array;
  free(): void;
}

export interface RendererDocument {
  render(index: number, scale: number): RenderedPixels;
  free(): void;
}

export interface RendererModule {
  readonly memory: WebAssembly.Memory;
  open(data: Uint8Array): RendererDocument;
}

export interface HybridWorkerModules {
  loadClassifier(): Promise<ClassifierModule>;
  /** Called once, when the first image-only page is about to render. */
  loadRenderer(): Promise<RendererModule>;
}

export type HybridRequest =
  | { id: number; type: "open"; doc: number; url?: string; data?: ArrayBuffer }
  | {
      id: number;
      type: "classify";
      doc: number;
      index: number;
      maxPathSegments: number;
      maxContentBytes: number;
    }
  | {
      id: number;
      type: "render";
      doc: number;
      index: number;
      scale: number;
      /**
       * The caller renders this page at `detail.scale` next: the worker
       * sends that bitmap too, unasked, to `detail.id`, before any other
       * queued render. With `once`, one pass at `detail.scale` serves both
       * and the reply to `id` gets a reduced copy; otherwise the pass at
       * `scale` comes first, and the detail pass is queued ahead of every
       * other render (a cancel of `detail.id` drops it).
       */
      detail?: { id: number; scale: number; once: boolean };
    }
  | { id: number; type: "close"; doc: number }
  | { id: number; type: "memory" }
  /** Drops a queued request; one already running finishes and is ignored. */
  | { id: number; type: "cancel"; target: number };

export interface OpenResult {
  pageCount: number;
  /** Fetching the PDF bytes (0 when they came with the request). */
  fetchMs: number;
  /** Waiting for the classifier module, which starts loading with the worker. */
  classifierWaitMs: number;
  /** Parsing the document's cross-reference table and page tree. */
  parseMs: number;
}

export interface ClassifyResult {
  stats: number[];
  ms: number;
}

export interface RenderResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** The scale hayro rendered at: the request's, or its detail scale when rendering once. */
  rasterScale: number;
  /** hayro's rasterization; 0 on the detail reply of a render done once, counted on its base. */
  rasterMs: number;
  /** Averaging the full-resolution pixels down to the request's scale. */
  reduceMs?: number;
  /** Creating the ImageBitmap from the pixels. */
  bitmapMs: number;
  /** Set on the render that loaded the rasterizer: module load and document parse. */
  rendererLoad?: { loadMs: number; parseMs: number };
}

export interface MemoryResult {
  classifierBytes: number;
  rendererBytes: number;
}

export type HybridReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; cancelled?: boolean };

// Packages compile with the DOM library, so describe the worker scope directly.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<HybridRequest>) => void) | null;
  postMessage(message: HybridReply, transfer?: Transferable[]): void;
};

interface OpenDocument {
  bytes: Uint8Array;
  classifier: ClassifierDocument;
  renderer?: RendererDocument;
}

type Queued = Exclude<HybridRequest, { type: "cancel" }>;

export function serveHybridWorker(modules: HybridWorkerModules): void {
  // The classifier is small and every document needs it, so it loads with
  // the worker, while the main thread is still mounting.
  const classifier = modules.loadClassifier();
  // Keep a failed load from surfacing as an unhandled rejection before the
  // first open, which reports it.
  classifier.catch(() => {});
  let renderer: Promise<RendererModule> | undefined;
  const docs = new Map<number, OpenDocument>();
  // Classification is quick and decides which engine renders a page, so it
  // overtakes queued renders, and so does everything else that is not a
  // render: a document's open must still come before its classification.
  const urgent: Queued[] = [];
  const renders: Queued[] = [];
  let running = false;

  const reply = (message: HybridReply, transfer: Transferable[] = []) =>
    scope.postMessage(message, transfer);

  const ready = (doc: number): OpenDocument => {
    const open = docs.get(doc);
    if (!open) throw new Error(`document ${doc} is not open`);
    return open;
  };

  /** A handler's reply, or null when it replied itself; `id` defaults to the request's own. */
  type Outcome = { result: unknown; transfer?: Transferable[]; id?: number } | null;

  /** Copies pixels into an ImageBitmap; the browser reads the view once. */
  const bitmapOf = (pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) =>
    createImageBitmap(new ImageData(pixels, width, height));

  /** One hayro pass at `scale`, as a bitmap. */
  const pass = async (
    renderer: RendererDocument,
    index: number,
    scale: number,
  ): Promise<RenderResult> => {
    let start = performance.now();
    const page = renderer.render(index, scale);
    const rasterMs = performance.now() - start;
    try {
      start = performance.now();
      const bitmap = await bitmapOf(page.view(), page.width, page.height);
      const bitmapMs = performance.now() - start;
      const { width, height } = page;
      return { bitmap, width, height, rasterScale: scale, rasterMs, bitmapMs };
    } finally {
      page.free();
    }
  };

  const handlers: {
    [K in Queued["type"]]: (request: Extract<Queued, { type: K }>) => Promise<Outcome>;
  } = {
    async open({ doc, url, data }) {
      let start = performance.now();
      let bytes: Uint8Array;
      let fetchMs = 0;
      if (data) bytes = new Uint8Array(data);
      else if (url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetching ${url} failed: ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
        fetchMs = performance.now() - start;
      } else throw new Error("open needs a url or data");
      start = performance.now();
      const module = await classifier;
      const classifierWaitMs = performance.now() - start;
      start = performance.now();
      const opened = module.open(bytes);
      const parseMs = performance.now() - start;
      docs.set(doc, { bytes, classifier: opened });
      const result: OpenResult = {
        pageCount: opened.pageCount(),
        fetchMs,
        classifierWaitMs,
        parseMs,
      };
      return { result };
    },

    async classify({ doc, index, maxPathSegments, maxContentBytes }) {
      const start = performance.now();
      const stats = ready(doc).classifier.classify(index, maxPathSegments, maxContentBytes);
      const result: ClassifyResult = { stats: Array.from(stats), ms: performance.now() - start };
      return { result };
    },

    async render({ id, doc, index, scale, detail }) {
      const open = ready(doc);
      let rendererLoad: RenderResult["rendererLoad"];
      if (!open.renderer) {
        let start = performance.now();
        renderer ??= modules.loadRenderer();
        const module = await renderer;
        const loadMs = performance.now() - start;
        start = performance.now();
        open.renderer = module.open(open.bytes);
        rendererLoad = { loadMs, parseMs: performance.now() - start };
      }
      const pages = open.renderer;
      // The reduced copy averages blocks of whole pixels, so rendering once
      // needs a detail scale at least twice this one.
      const factor = detail?.once ? Math.round(detail.scale / scale) : 0;
      if (detail?.once && factor < 2) {
        reply({ id: detail.id, ok: false, error: "not rendered once", cancelled: true });
      }
      if (!detail?.once || factor < 2) {
        const base = await pass(pages, index, scale);
        if (!detail || detail.once) {
          return { result: { ...base, rendererLoad }, transfer: [base.bitmap] };
        }
        // The detail pass goes ahead of every queued render, behind
        // classifications, which decide where pages go.
        renders.unshift({ id: detail.id, type: "render", doc, index, scale: detail.scale });
        reply({ id, ok: true, result: { ...base, rendererLoad } }, [base.bitmap]);
        return null;
      }
      // hayro decodes the page's images on every render, so one pass at the
      // detail scale serves both layers.
      let start = performance.now();
      const page = pages.render(index, detail.scale);
      const rasterMs = performance.now() - start;
      const { width, height } = page;
      try {
        start = performance.now();
        const reduced = page.reduce(factor);
        const reduceMs = performance.now() - start;
        start = performance.now();
        const base = await bitmapOf(
          new Uint8ClampedArray(
            reduced.buffer as ArrayBuffer,
            reduced.byteOffset,
            reduced.byteLength,
          ),
          Math.floor(width / factor),
          Math.floor(height / factor),
        );
        const baseResult: RenderResult = {
          bitmap: base,
          width: base.width,
          height: base.height,
          rasterScale: detail.scale,
          rasterMs,
          reduceMs,
          bitmapMs: performance.now() - start,
          rendererLoad,
        };
        // The low-resolution layer goes out first; the full pixels follow.
        reply({ id, ok: true, result: baseResult }, [base]);
        start = performance.now();
        const bitmap = await bitmapOf(page.view(), width, height);
        const result: RenderResult = {
          bitmap,
          width,
          height,
          rasterScale: detail.scale,
          rasterMs: 0,
          bitmapMs: performance.now() - start,
        };
        return { id: detail.id, result, transfer: [bitmap] };
      } finally {
        page.free();
      }
    },

    async close({ doc }) {
      const open = docs.get(doc);
      docs.delete(doc);
      open?.classifier.free();
      open?.renderer?.free();
      return { result: null };
    },

    async memory() {
      const result: MemoryResult = {
        classifierBytes: (await classifier).memory.buffer.byteLength,
        rendererBytes: renderer ? (await renderer).memory.buffer.byteLength : 0,
      };
      return { result };
    },
  };

  const pump = async () => {
    if (running) return;
    running = true;
    for (let request = urgent.shift() ?? renders.shift(); request; ) {
      try {
        const handler = handlers[request.type] as (request: Queued) => Promise<Outcome>;
        const outcome = await handler(request);
        if (outcome) {
          const { result, transfer, id = request.id } = outcome;
          reply({ id, ok: true, result }, transfer);
        }
      } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        // The main thread ignores replies to requests that already settled.
        reply({ id: request.id, ok: false, error: message });
        if (request.type === "render" && request.detail) {
          reply({ id: request.detail.id, ok: false, error: message });
        }
      }
      request = urgent.shift() ?? renders.shift();
    }
    running = false;
  };

  scope.onmessage = (event) => {
    const request = event.data;
    if (request.type === "cancel") {
      for (const list of [urgent, renders]) {
        const at = list.findIndex((queued) => queued.id === request.target);
        if (at < 0) continue;
        const [dropped] = list.splice(at, 1);
        reply({ id: request.target, ok: false, error: "cancelled", cancelled: true });
        if (dropped?.type === "render" && dropped.detail) {
          reply({ id: dropped.detail.id, ok: false, error: "cancelled", cancelled: true });
        }
      }
      return;
    }
    (request.type === "render" ? renders : urgent).push(request);
    void pump();
  };
}
