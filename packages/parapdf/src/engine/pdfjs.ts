import type * as Pdfjs from "pdfjs-dist";
import {
  type PageSize,
  type PageText,
  type PdfEngine,
  type PdfEngineDocument,
  type PdfSource,
  RenderCancelledError,
  type TextLayerHandle,
} from "./types.ts";

export interface PdfjsEngineOptions {
  /** The pdf.js module; the application owns its version. */
  pdfjs: typeof Pdfjs;
  workerSrc: string;
  /**
   * Renderer worker script (pdf.js master and later). When set, pdf.js draws
   * pages into an OffscreenCanvas on its own thread instead of the main thread.
   */
  rendererSrc?: string;
  /** Base URL of the pdf.js cmaps/, standard_fonts/, wasm/, and iccs/ directories. */
  assetBase?: string;
  enableHWA?: boolean;
}

// The text layer and the search index must see the same items in the same
// order, so both read text content with identical options.
const TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true } as const;

/** pdf.js through its core display API only. */
export function createPdfjsEngine(options: PdfjsEngineOptions): PdfEngine {
  const { pdfjs, assetBase } = options;
  pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  if (options.rendererSrc) {
    (pdfjs.GlobalWorkerOptions as { rendererSrc?: string }).rendererSrc = options.rendererSrc;
  }
  // Start the parsing worker now, while React mounts, instead of when the
  // first document opens. One worker serves every document of this engine.
  const worker = new pdfjs.PDFWorker();

  return {
    name: options.rendererSrc ? "pdf.js (renderer worker)" : "pdf.js (main-thread drawing)",
    async open(source: PdfSource): Promise<PdfEngineDocument> {
      const loadingTask = pdfjs.getDocument({
        ...("url" in source ? { url: source.url } : { data: source.data }),
        worker,
        enableHWA: options.enableHWA ?? false,
        ...(assetBase
          ? {
              cMapUrl: `${assetBase}cmaps/`,
              cMapPacked: true,
              standardFontDataUrl: `${assetBase}standard_fonts/`,
              wasmUrl: `${assetBase}wasm/`,
              iccUrl: `${assetBase}iccs/`,
            }
          : {}),
      });
      const doc = await loadingTask.promise;
      const pages = new Map<number, Promise<Pdfjs.PDFPageProxy>>();
      const texts = new Map<number, Promise<PageText>>();
      const getPage = (pageIndex: number): Promise<Pdfjs.PDFPageProxy> => {
        let page = pages.get(pageIndex);
        if (!page) {
          page = doc.getPage(pageIndex + 1);
          pages.set(pageIndex, page);
        }
        return page;
      };

      return {
        pageCount: doc.numPages,
        async pageSize(pageIndex): Promise<PageSize> {
          const { width, height } = (await getPage(pageIndex)).getViewport({ scale: 1 });
          return { width, height };
        },
        render({ pageIndex, scale, canvas }) {
          let task: Pdfjs.RenderTask | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then((page) => {
            if (cancelled) throw new RenderCancelledError("render cancelled before it started");
            const viewport = page.getViewport({ scale });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            task = page.render({ canvas, viewport });
            return task.promise;
          });
          return {
            promise,
            cancel() {
              cancelled = true;
              task?.cancel();
            },
          };
        },
        getText(pageIndex) {
          let text = texts.get(pageIndex);
          if (!text) {
            text = getPage(pageIndex).then(async (page) => {
              const content = await page.getTextContent(TEXT_OPTIONS);
              const viewport = page.getViewport({ scale: 1 });
              const items: string[] = [];
              const endsLine: boolean[] = [];
              const boxes: number[] = [];
              for (const item of content.items) {
                if (!("str" in item)) continue;
                items.push(item.str);
                endsLine.push(item.hasEOL);
                const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform as number[];
                const [x = 0, baseline = 0] = viewport.convertToViewportPoint(e, f);
                const height = Math.hypot(c, d) || Math.hypot(a, b) || item.height;
                boxes.push(x, baseline - height, item.width, height);
              }
              return { items, endsLine, boxes: Float32Array.from(boxes) };
            });
            texts.set(pageIndex, text);
          }
          return text;
        },
        renderTextLayer({ pageIndex, container, cssScale }) {
          let layer: Pdfjs.TextLayer | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then(async (page): Promise<TextLayerHandle> => {
            if (cancelled) throw new RenderCancelledError("text layer cancelled before it started");
            const rendered = new pdfjs.TextLayer({
              textContentSource: page.streamTextContent(TEXT_OPTIONS),
              container,
              viewport: page.getViewport({ scale: cssScale }),
            });
            layer = rendered;
            await rendered.render();
            return {
              elements: rendered.textDivs,
              setScale(next) {
                rendered.update({ viewport: page.getViewport({ scale: next }) });
              },
            };
          });
          return {
            promise,
            cancel() {
              cancelled = true;
              layer?.cancel();
            },
          };
        },
        releasePage(pageIndex) {
          void pages.get(pageIndex)?.then((page) => page.cleanup());
        },
        async destroy() {
          pages.clear();
          texts.clear();
          await loadingTask.destroy();
        },
      };
    },
  };
}
