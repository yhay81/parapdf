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

/** One rasterized page; `takePixels` moves out tightly packed RGBA8 rows. */
export interface RenderedPixels {
  readonly width: number;
  readonly height: number;
  takePixels(): Uint8Array;
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
  | { id: number; type: "render"; doc: number; index: number; scale: number }
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
  rasterMs: number;
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

  const handlers: {
    [K in Queued["type"]]: (
      request: Extract<Queued, { type: K }>,
    ) => Promise<{ result: unknown; transfer?: Transferable[] }>;
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

    async render({ doc, index, scale }) {
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
      const start = performance.now();
      const page = open.renderer.render(index, scale);
      const { width, height } = page;
      const bytes = page.takePixels();
      // wasm-bindgen copies the pixels into a fresh, non-shared ArrayBuffer.
      const pixels = new Uint8ClampedArray(
        bytes.buffer as ArrayBuffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
      const result: RenderResult = {
        bitmap,
        width,
        height,
        rasterMs: performance.now() - start,
        rendererLoad,
      };
      return { result, transfer: [bitmap] };
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
        const handler = handlers[request.type] as (
          request: Queued,
        ) => Promise<{ result: unknown; transfer?: Transferable[] }>;
        const { result, transfer } = await handler(request);
        reply({ id: request.id, ok: true, result }, transfer);
      } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        reply({ id: request.id, ok: false, error: message });
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
        if (at >= 0) {
          list.splice(at, 1);
          reply({ id: request.target, ok: false, error: "cancelled", cancelled: true });
        }
      }
      return;
    }
    (request.type === "render" ? renders : urgent).push(request);
    void pump();
  };
}
