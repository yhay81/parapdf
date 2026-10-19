import type * as Pdfjs from "pdfjs-dist";
import {
  type AnnotationLayerHandle,
  type LinkHandlers,
  type OutlineNode,
  type PageSize,
  type PageText,
  type PdfEngine,
  type PdfEngineDocument,
  type PdfSource,
  RenderCancelledError,
  type ResolvedDestination,
  type Rotation,
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

/**
 * The part of pdf.js's link service interface that link annotations call.
 * Internal links and named actions go to the runtime; pdf.js's own viewer
 * components are never involved.
 */
function createLinkService(links: LinkHandlers) {
  const external = links.externalLinks !== "disabled";
  return {
    externalLinkEnabled: external,
    eventBus: undefined,
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      // Without an href the element is neither focusable nor a link, and the
      // text it covered stays readable in the text layer.
      if (!external) return;
      link.href = url;
      link.title = url;
      // External pages open in a new tab so the document keeps its position.
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
    },
    getDestinationHash(dest: unknown) {
      return typeof dest === "string" && dest ? `#${encodeURIComponent(dest)}` : "#";
    },
    getAnchorUrl(anchor: string) {
      return `#${anchor}`;
    },
    goToDestination(dest: unknown) {
      links.navigate(dest);
    },
    executeNamedAction(action: string) {
      links.namedAction(action);
    },
    executeSetOCGState() {
      // Optional content toggles are not supported yet.
    },
    async getAttachmentContent() {
      return null;
    },
  };
}

interface PdfjsOutlineItem {
  title: string;
  dest: unknown;
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: PdfjsOutlineItem[];
}

const toOutline = (items: readonly PdfjsOutlineItem[] | null): OutlineNode[] =>
  (items ?? []).map((item) => ({
    title: item.title,
    dest: item.dest ?? null,
    url: item.url ?? null,
    bold: Boolean(item.bold),
    italic: Boolean(item.italic),
    items: toOutline(item.items),
  }));

/** Every PDFDocumentProxy a pdf.js engine has opened, so pdfjsDocumentOf can vouch for it. */
const proxies = new WeakSet<object>();

/**
 * pdf.js's own document behind a document a pdf.js engine opened, for its
 * APIs that ParaPDF does not wrap (metadata, attachments, form fields);
 * null for documents of other engines.
 */
export function pdfjsDocumentOf(
  document: PdfEngineDocument | null | undefined,
): Pdfjs.PDFDocumentProxy | null {
  const native = document?.native;
  return typeof native === "object" && native !== null && proxies.has(native)
    ? (native as Pdfjs.PDFDocumentProxy)
    : null;
}

/** The page at `scale` turned by the view on top of its own rotation. */
const viewportOf = (page: Pdfjs.PDFPageProxy, scale: number, rotation: Rotation = 0) =>
  page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });

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
      proxies.add(doc);
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
        native: doc,
        async pageSize(pageIndex): Promise<PageSize> {
          const { width, height } = (await getPage(pageIndex)).getViewport({ scale: 1 });
          return { width, height };
        },
        render({ pageIndex, scale, rotation, canvas, region }) {
          let task: Pdfjs.RenderTask | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then((page) => {
            if (cancelled) throw new RenderCancelledError("render cancelled before it started");
            const viewport = viewportOf(page, scale, rotation);
            if (region) {
              // Shift the page so the region's corner lands on the canvas origin.
              canvas.width = region.width;
              canvas.height = region.height;
              task = page.render({
                canvas,
                viewport,
                transform: [1, 0, 0, 1, -region.x, -region.y],
              });
            } else {
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              task = page.render({ canvas, viewport });
            }
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
        renderTextLayer({ pageIndex, container, cssScale, rotation }) {
          let layer: Pdfjs.TextLayer | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then(async (page): Promise<TextLayerHandle> => {
            if (cancelled) throw new RenderCancelledError("text layer cancelled before it started");
            const rendered = new pdfjs.TextLayer({
              textContentSource: page.streamTextContent(TEXT_OPTIONS),
              container,
              // The layer is laid out unturned; pdf.js marks it with
              // data-main-rotation and the viewer CSS turns it.
              viewport: viewportOf(page, cssScale, rotation),
            });
            layer = rendered;
            await rendered.render();
            return {
              elements: rendered.textDivs,
              update(nextScale, nextRotation) {
                rendered.update({ viewport: viewportOf(page, nextScale, nextRotation) });
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
        renderAnnotationLayer({ pageIndex, container, cssScale, rotation, links }) {
          let cancelled = false;
          const promise = getPage(pageIndex).then(async (page): Promise<AnnotationLayerHandle> => {
            const annotations = await page.getAnnotations({ intent: "display" });
            if (cancelled) throw new RenderCancelledError("annotation layer cancelled");
            const viewport = viewportOf(page, cssScale, rotation);
            const linkService = createLinkService(links);
            const layer = new pdfjs.AnnotationLayer({
              div: container,
              accessibilityManager: null,
              annotationCanvasMap: null,
              annotationEditorUIManager: null,
              page,
              viewport,
              structTreeLayer: null,
              commentManager: null,
              linkService,
              annotationStorage: doc.annotationStorage,
            });
            // Form widgets stay on the canvas (the default annotation mode),
            // so only links and other non-form annotations become HTML here.
            await layer.render({
              annotations,
              div: container as HTMLDivElement,
              page,
              viewport,
              linkService: linkService as never,
              annotationStorage: doc.annotationStorage,
              renderForms: false,
              enableScripting: false,
            });
            return {
              update(nextScale, nextRotation) {
                layer.update({ viewport: viewportOf(page, nextScale, nextRotation) } as never);
              },
            };
          });
          return {
            promise,
            cancel() {
              cancelled = true;
            },
          };
        },
        async getOutline() {
          return toOutline((await doc.getOutline()) as PdfjsOutlineItem[] | null);
        },
        async resolveDestination(dest): Promise<ResolvedDestination | null> {
          const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
          if (!Array.isArray(explicit)) return null;
          const [target, mode, ...args] = explicit as [unknown, { name?: string }?, ...unknown[]];
          let pageIndex: number;
          if (Number.isInteger(target)) pageIndex = target as number;
          else if (target && typeof target === "object") {
            pageIndex = await doc.getPageIndex(target as Parameters<typeof doc.getPageIndex>[0]);
          } else return null;
          const num = (value: unknown) => (typeof value === "number" ? value : null);
          // [left, top] in PDF user space, per the destination syntax (PDF 32000 12.3.2.2).
          let left: number | null = null;
          let top: number | null = null;
          switch (mode?.name) {
            case "XYZ":
              left = num(args[0]);
              top = num(args[1]);
              break;
            case "FitH":
            case "FitBH":
              top = num(args[0]);
              break;
            case "FitV":
            case "FitBV":
              left = num(args[0]);
              break;
            case "FitR":
              left = num(args[0]);
              top = num(args[3]);
              break;
          }
          if (left === null && top === null) return { pageIndex, x: null, y: null };
          const viewport = (await getPage(pageIndex)).getViewport({ scale: 1 });
          const [x = 0, y = 0] = viewport.convertToViewportPoint(left ?? 0, top ?? 0);
          return { pageIndex, x: left === null ? null : x, y: top === null ? null : y };
        },
        releasePage(pageIndex) {
          // The page may never have loaded, or the document may be gone by now.
          pages.get(pageIndex)?.then(
            (page) => page.cleanup(),
            () => {},
          );
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
