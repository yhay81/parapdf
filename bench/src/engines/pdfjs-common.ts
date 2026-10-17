import type * as Pdfjs from "pdfjs-dist";
import type { EngineAdapter } from "./types.ts";

export interface PdfjsAdapterOptions {
  id: string;
  lib: typeof Pdfjs;
  label: string;
  workerUrl: string;
  /** Renderer worker script; when set, pdf.js may draw pages off the main thread. */
  rendererUrl?: string;
  /** Base URL of the cmaps/, standard_fonts/, wasm/, and iccs/ directories. */
  assetBase: string;
  hwa: boolean;
}

/**
 * pdf.js through its core display API: parsing in the pdf.js worker and
 * drawing either on the main thread or, with `rendererUrl`, in pdf.js's
 * renderer worker. `hwa` selects a GPU-backed 2D context; the default
 * (`enableHWA: false`) requests `willReadFrequently`, a CPU canvas.
 */
export function createPdfjsAdapter(options: PdfjsAdapterOptions): EngineAdapter & {
  usesRendererWorker(): boolean;
} {
  const { lib, hwa, assetBase } = options;
  const canvas = document.createElement("canvas");
  let worker: Pdfjs.PDFWorker | undefined;
  let loadingTask: Pdfjs.PDFDocumentLoadingTask | undefined;
  let doc: Pdfjs.PDFDocumentProxy | undefined;
  const ready = (): Pdfjs.PDFDocumentProxy => {
    if (!doc) throw new Error("pdf.js document is not open");
    return doc;
  };

  return {
    id: options.id,
    version: `${options.label} ${lib.version}`,
    canvas,
    async init() {
      lib.GlobalWorkerOptions.workerSrc = options.workerUrl;
      if (options.rendererUrl) {
        (lib.GlobalWorkerOptions as { rendererSrc?: string }).rendererSrc = options.rendererUrl;
      }
      worker = new lib.PDFWorker();
      await worker.promise;
    },
    async open(data) {
      loadingTask = lib.getDocument({
        data,
        worker,
        enableHWA: hwa,
        cMapUrl: `${assetBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase}standard_fonts/`,
        wasmUrl: `${assetBase}wasm/`,
        iccUrl: `${assetBase}iccs/`,
      });
      doc = await loadingTask.promise;
      return { pageCount: doc.numPages };
    },
    async pageSize(index) {
      const page = await ready().getPage(index + 1);
      const { width, height } = page.getViewport({ scale: 1 });
      return { width, height };
    },
    async render(index, scale) {
      const page = await ready().getPage(index + 1);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return { width: canvas.width, height: canvas.height };
    },
    async memoryBytes() {
      return undefined;
    },
    async close() {
      // pdf.js 6 destroys documents through their loading task.
      await loadingTask?.destroy();
      worker?.destroy();
    },
    // Diagnostic only: pdf.js keeps the renderer worker on a private field and
    // silently falls back to main-thread drawing when it cannot start.
    usesRendererWorker: () =>
      Boolean((loadingTask as { _rendererWorker?: unknown } | undefined)?._rendererWorker),
  };
}
