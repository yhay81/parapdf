import type * as Pdfjs from "pdfjs-dist";
import { createFormAccess } from "./pdfjs-forms.ts";
import { type RawDims, StructTreeBuilder } from "./struct-tree.ts";
import {
  type AnnotationLayerHandle,
  type DestinationView,
  type LayerState,
  type LinkHandlers,
  type OpenOptions,
  type OutlineNode,
  type PageSize,
  type PageText,
  type PdfEngine,
  type PdfEngineDocument,
  type PdfInitialView,
  type PdfLayer,
  type PdfMetadata,
  type PdfPageLayout,
  type PdfPageMode,
  type PdfPermissions,
  type PdfSource,
  RenderCancelledError,
  type ResolvedDestination,
  type Rotation,
  type TextLayerHandle,
} from "./types.ts";

/**
 * pdf.js getDocument parameters that ParaPDF does not set from the source,
 * such as canvasMaxAreaInBytes, maxImageSize, or disableAutoFetch.
 */
export type PdfjsDocumentOptions = Omit<
  Exclude<
    Parameters<(typeof Pdfjs)["getDocument"]>[0],
    string | URL | ArrayBuffer | ArrayBufferView | undefined
  >,
  "url" | "data" | "range" | "worker"
>;

export interface PdfjsEngineOptions {
  /**
   * The pdf.js module: the pdfjs-dist ParaPDF depends on, unless
   * configurePdfjs() loads another build, such as the legacy build
   * (`pdfjs-dist/legacy/build/pdf.mjs`) older Safari needs.
   */
  pdfjs: typeof Pdfjs;
  workerSrc: string;
  /** pdf.js's worker, started already from `workerSrc`; the adapter starts one otherwise. */
  port?: Worker;
  /**
   * Renderer worker script (pdf.js master and later). When set, pdf.js draws
   * pages into an OffscreenCanvas on its own thread instead of the main thread.
   */
  rendererSrc?: string;
  /**
   * Base URL of the pdf.js cmaps/, standard_fonts/, wasm/, and iccs/
   * directories, and of web/images/, whose icons mark comments that have no
   * appearance of their own.
   */
  assetBase?: string;
  /**
   * Base URL of pdf.js's annotation icons, ending with a slash; by default
   * `${assetBase}web/images/`. Without either, such comments get a
   * transparent icon that still opens their popup.
   */
  imageResourcesPath?: string;
  /**
   * The annotation icons' own URLs, by file name, as bundlers emit them;
   * used without `imageResourcesPath` and `assetBase`.
   */
  iconUrls?: Record<string, string>;
  /**
   * Draw on GPU-backed canvases, pdf.js's enableHWA (default true); false
   * keeps pdf.js's own default of CPU-backed canvases. See README for what it
   * costs and saves in each browser.
   */
  enableHWA?: boolean;
  /**
   * More getDocument parameters for every document this engine opens. They
   * override enableHWA and the asset URLs from assetBase; the source and the
   * engine's worker always come from ParaPDF.
   */
  documentOptions?: PdfjsDocumentOptions;
}

// The text layer and the search index must see the same items in the same
// order, so both read text content with identical options.
const TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true } as const;

/** The language `element` inherits, "" when none is declared. */
function inheritedLanguage(element: Element): string {
  let node: Element | null = element;
  while (node) {
    const lang = node.getAttribute("lang");
    if (lang !== null) return lang;
    const root = node.getRootNode();
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return "";
}

/**
 * pdf.js's `TextLayer` sizes each run by measuring it on a hidden canvas
 * whose `lang` is the text content's: the PDF's /Lang, or empty, an unknown
 * language, when the PDF declares none. The generic families runs are drawn
 * in, such as `serif`, resolve by language, and an unknown language resolves
 * apart from the page's: to the operating system's in Firefox, to the
 * browser's default in Chromium and WebKit. Runs drawn in other fonts than
 * they were measured in end short of their glyphs or past them: 12–15% short
 * in Firefox on a Japanese system under an English page, 12–18% past in
 * Chromium and WebKit under a Japanese page. So the text content declares the
 * PDF's language or, when it has none, the one the layer inherits, and the
 * layer carries that language itself. For PDFs without a language, assistive
 * technology keeps announcing the page's.
 */
function inLayerLanguage(source: ReadableStream, container: HTMLElement): ReadableStream {
  const inherited = container.parentElement ? inheritedLanguage(container.parentElement) : "";
  container.lang = inherited;
  return source.pipeThrough(
    new TransformStream<{ lang: string | null }, { lang: string | null }>({
      transform(chunk, controller) {
        chunk.lang ||= inherited;
        if (container.lang !== chunk.lang) container.lang = chunk.lang;
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * The part of pdf.js's link service interface that link annotations call.
 * Internal links and named actions go to the runtime; pdf.js's own viewer
 * components are never involved.
 */
function createLinkService(links: LinkHandlers, doc: Pdfjs.PDFDocumentProxy) {
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
    executeSetOCGState(action: unknown) {
      links.setLayers?.(action);
    },
    async getAttachmentContent(id: string) {
      return doc.getAttachmentContent(id).catch(() => null);
    },
  };
}

type OptionalContentConfig = Awaited<
  ReturnType<Pdfjs.PDFDocumentProxy["getOptionalContentConfig"]>
>;

/** pdf.js's state behind each LayerState a pdf.js engine made. */
const layerConfigs = new WeakMap<
  LayerState,
  {
    /** What the screen shows. */
    display: OptionalContentConfig;
    /** The same changes made to a configuration for printing, which pdf.js keeps apart. */
    forPrint(): Promise<OptionalContentConfig>;
  }
>();

/** The layers of `config` in the document's order; headings group the layers under them. */
function layersOf(config: OptionalContentConfig): PdfLayer[] {
  const node = (item: unknown): PdfLayer[] => {
    if (typeof item === "string") {
      const group = config.getGroup(item) as { name?: string | null; visible: boolean } | null;
      return group
        ? [{ id: item, name: group.name ?? "", visible: group.visible, children: [] }]
        : [];
    }
    if (item && typeof item === "object" && Array.isArray((item as { order?: unknown }).order)) {
      const { name, order } = item as { name: string | null; order: unknown[] };
      return [{ id: null, name: name ?? "", visible: true, children: order.flatMap(node) }];
    }
    return [];
  };
  const order = config.getOrder() as unknown[] | null;
  if (order?.length) return order.flatMap(node);
  return [...config].map(([id, group]: [string, { name?: string | null; visible: boolean }]) => ({
    id,
    name: group.name ?? "",
    visible: group.visible,
    children: [],
  }));
}

async function createLayerState(doc: Pdfjs.PDFDocumentProxy): Promise<LayerState> {
  const display = await doc.getOptionalContentConfig({ intent: "display" });
  // Every change, in order, to replay on a configuration for printing.
  const changes: ((config: OptionalContentConfig) => void)[] = [];
  const change = (apply: (config: OptionalContentConfig) => void) => {
    changes.push(apply);
    apply(display);
  };
  const state: LayerState = {
    layers: () => layersOf(display),
    setVisible(id, visible) {
      change((config) => config.setVisibility(id, visible));
    },
    apply(action) {
      const { state: operations, preserveRB } = action as { state?: unknown; preserveRB?: unknown };
      if (!Array.isArray(operations)) return;
      change((config) =>
        config.setOCGState({ state: operations, preserveRB: preserveRB !== false }),
      );
    },
  };
  layerConfigs.set(state, {
    display,
    async forPrint() {
      const config = await doc.getOptionalContentConfig({ intent: "print" });
      for (const apply of changes) apply(config);
      return config;
    },
  });
  return state;
}

/** What pdf.js's annotation elements call to hand over an embedded file. */
const createDownloadManager = (links: LinkHandlers) => ({
  openOrDownloadData(content: Uint8Array, filename: string) {
    links.openAttachment?.({ filename, content });
  },
});

/** The first of `values` that is a non-empty string, trimmed. */
const PAGE_LAYOUTS = new Set<string>([
  "SinglePage",
  "OneColumn",
  "TwoColumnLeft",
  "TwoColumnRight",
  "TwoPageLeft",
  "TwoPageRight",
]);
const PAGE_MODES = new Set<string>([
  "UseNone",
  "UseOutlines",
  "UseThumbs",
  "FullScreen",
  "UseOC",
  "UseAttachments",
]);

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
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

/** The page at `scale` turned by the view on top of its own rotation. */
const viewportOf = (page: Pdfjs.PDFPageProxy, scale: number, rotation: Rotation = 0) =>
  page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });

/**
 * pdf.js appends the icon's file name to its image path: after a data URL's
 * fragment mark, the name changes nothing, and the icon is a transparent
 * image instead of a request for a file the application may not serve.
 */
const TRANSPARENT_ICONS = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E#";

/**
 * Points the icons pdf.js named after the transparent image's fragment mark
 * at their own URLs. pdf.js builds an icon's URL from one base, which files
 * a bundler emits under names of their own do not share; an icon without a
 * file keeps the transparent image.
 */
function placeIcons(container: HTMLElement, icons: Record<string, string>): void {
  for (const image of container.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (!src?.startsWith(TRANSPARENT_ICONS)) continue;
    const url = icons[src.slice(TRANSPARENT_ICONS.length)];
    if (url) image.src = url;
  }
}

/** pdf.js through its core display API only. */
export function createPdfjsEngine(options: PdfjsEngineOptions): PdfEngine {
  const { pdfjs, assetBase } = options;
  // The 2D context pdf.js draws pages with, which kept drawings are drawn
  // back with too, so that later renders into the same canvas get it.
  const contextOptions = {
    alpha: false,
    willReadFrequently: !(options.documentOptions?.enableHWA ?? options.enableHWA ?? true),
  };
  const imageResourcesPath =
    options.imageResourcesPath ?? (assetBase ? `${assetBase}web/images/` : TRANSPARENT_ICONS);
  const iconUrls = imageResourcesPath === TRANSPARENT_ICONS ? options.iconUrls : undefined;
  pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  if (options.rendererSrc) {
    (pdfjs.GlobalWorkerOptions as { rendererSrc?: string }).rendererSrc = options.rendererSrc;
  }
  // Start the parsing worker now, while React mounts, instead of when the
  // first document opens. One worker serves every document of this engine.
  // pdf.js takes any Worker as its port; its typings infer the type from the
  // default, null.
  const worker = new pdfjs.PDFWorker(
    (options.port ? { port: options.port } : {}) as ConstructorParameters<
      typeof pdfjs.PDFWorker
    >[0],
  );

  return {
    name: options.rendererSrc ? "pdf.js (renderer worker)" : "pdf.js (main-thread drawing)",
    async open(source: PdfSource, openOptions: OpenOptions = {}): Promise<PdfEngineDocument> {
      const { onProgress, password: askPassword, signal } = openOptions;
      signal?.throwIfAborted();
      const loadingTask = pdfjs.getDocument({
        enableHWA: options.enableHWA ?? true,
        ...(assetBase
          ? {
              cMapUrl: `${assetBase}cmaps/`,
              cMapPacked: true,
              standardFontDataUrl: `${assetBase}standard_fonts/`,
              wasmUrl: `${assetBase}wasm/`,
              iccUrl: `${assetBase}iccs/`,
            }
          : {}),
        ...options.documentOptions,
        // pdf.js transfers the bytes to its worker, which detaches the
        // caller's buffer. A copy leaves the application its data and lets the
        // same source open again after its document was destroyed.
        ...("url" in source
          ? {
              url: source.url,
              ...(source.httpHeaders ? { httpHeaders: { ...source.httpHeaders } } : {}),
              ...(source.withCredentials !== undefined
                ? { withCredentials: source.withCredentials }
                : {}),
            }
          : { data: source.data.slice(0) }),
        ...(source.password !== undefined ? { password: source.password } : {}),
        worker,
      });
      if (onProgress) {
        loadingTask.onProgress = ({ loaded, total }: { loaded: number; total?: number }) =>
          onProgress(loaded, total && total > 0 ? total : null);
      }
      // Without onPassword, pdf.js fails an encrypted document with a PasswordException.
      if (askPassword) {
        loadingTask.onPassword = (update: (password: string | Error) => void, code: number) => {
          const reason =
            code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "required";
          askPassword(reason).then(
            (password) =>
              update(
                password ??
                  // pdf.js's own exception class, so the failure reads like any other.
                  (new pdfjs.PasswordException("No password was given.", code) as unknown as Error),
              ),
            (error: unknown) => update(error instanceof Error ? error : new Error(String(error))),
          );
        };
      }
      // Aborting stops a load in progress; a loaded document is destroyed through destroy().
      const abort = () => void loadingTask.destroy();
      signal?.addEventListener("abort", abort, { once: true });
      const doc = await loadingTask.promise.finally(() =>
        signal?.removeEventListener("abort", abort),
      );
      const pages = new Map<number, Promise<Pdfjs.PDFPageProxy>>();
      const texts = new Map<number, Promise<PageText>>();
      /**
       * Form layers by container. With forms shown as HTML, pdf.js draws
       * check boxes and radio buttons into canvases of their own, one per
       * state, which the page's annotation layer shows over its input: each
       * render fills the container's map, and the layer takes the canvases
       * from it once built, and again after every later render.
       */
      const formLayers = new WeakMap<
        HTMLElement,
        { canvases: Map<string, HTMLCanvasElement>; layer: Pdfjs.AnnotationLayer | null }
      >();
      const formLayerOf = (container: HTMLElement) => {
        let entry = formLayers.get(container);
        if (!entry) {
          entry = { canvases: new Map(), layer: null };
          formLayers.set(container, entry);
        }
        return entry;
      };
      // The fields of every page, which radio buttons and fields shown on
      // several pages use to keep their widgets in step.
      let fieldObjects: Promise<Map<string, object[]> | null> | undefined;
      // The structure tree of each page's latest text layer, which gives the
      // page's annotations their labels in its annotation layer.
      const structTrees = new Map<number, StructTreeBuilder>();
      const getPage = (pageIndex: number): Promise<Pdfjs.PDFPageProxy> => {
        let page = pages.get(pageIndex);
        if (!page) {
          page = doc.getPage(pageIndex + 1);
          pages.set(pageIndex, page);
        }
        return page;
      };

      const forms = createFormAccess(doc, getPage);
      /** An explicit destination's page, point, and view (PDF 32000-1, 12.3.2.2). */
      const resolveExplicit = async (explicit: unknown): Promise<ResolvedDestination | null> => {
        if (!Array.isArray(explicit)) return null;
        const [target, mode, ...args] = explicit as [unknown, { name?: string }?, ...unknown[]];
        let pageIndex: number;
        if (Number.isInteger(target)) pageIndex = target as number;
        else if (target && typeof target === "object") {
          pageIndex = await doc.getPageIndex(target as Parameters<typeof doc.getPageIndex>[0]);
        } else return null;
        const num = (value: unknown) => (typeof value === "number" ? value : null);
        // [left, top] in PDF user space, and the view asked for.
        let left: number | null = null;
        let top: number | null = null;
        let view: DestinationView | undefined;
        let corner: [number, number] | null = null;
        switch (mode?.name) {
          case "XYZ":
            left = num(args[0]);
            top = num(args[1]);
            // 0 and null keep the zoom.
            view = { fit: "zoom", zoom: num(args[2]) || null };
            break;
          case "Fit":
          case "FitB":
            view = { fit: "page" };
            break;
          case "FitH":
          case "FitBH":
            top = num(args[0]);
            view = { fit: "width" };
            break;
          case "FitV":
          case "FitBV":
            left = num(args[0]);
            view = { fit: "height" };
            break;
          case "FitR": {
            const [x1 = null, y1 = null, x2 = null, y2 = null] = args.map(num);
            if (x1 === null || y1 === null || x2 === null || y2 === null) break;
            left = Math.min(x1, x2);
            top = Math.max(y1, y2);
            corner = [Math.max(x1, x2), Math.min(y1, y2)];
            break;
          }
        }
        const resolved = (x: number | null, y: number | null): ResolvedDestination =>
          view ? { pageIndex, x, y, view } : { pageIndex, x, y };
        if (left === null && top === null) return resolved(null, null);
        const viewport = (await getPage(pageIndex)).getViewport({ scale: 1 });
        const [x = 0, y = 0] = viewport.convertToViewportPoint(left ?? 0, top ?? 0);
        if (corner) {
          // The rectangle's corners on the page as it shows, whichever way it turns.
          const [cx = 0, cy = 0] = viewport.convertToViewportPoint(...corner);
          view = { fit: "rect", width: Math.abs(cx - x), height: Math.abs(cy - y) };
          return resolved(Math.min(x, cx), Math.min(y, cy));
        }
        const quarter = viewport.rotation % 180 !== 0;
        return resolved(
          (quarter ? top : left) === null ? null : x,
          (quarter ? left : top) === null ? null : y,
        );
      };

      return {
        pageCount: doc.numPages,
        proxy: doc,
        async pageSize(pageIndex): Promise<PageSize> {
          const { width, height } = (await getPage(pageIndex)).getViewport({ scale: 1 });
          return { width, height };
        },
        render({ pageIndex, scale, rotation, canvas, region, intent, formLayer, colors, layers }) {
          let task: Pdfjs.RenderTask | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then(async (page) => {
            if (cancelled) throw new RenderCancelledError("render cancelled before it started");
            const viewport = viewportOf(page, scale, rotation);
            const form = formLayer ? formLayerOf(formLayer) : null;
            const configs = layers ? layerConfigs.get(layers) : undefined;
            const parameters = {
              canvas,
              viewport,
              ...(colors ? { pageColors: colors } : {}),
              ...(configs
                ? {
                    optionalContentConfigPromise:
                      intent === "print" ? configs.forPrint() : Promise.resolve(configs.display),
                  }
                : {}),
              ...(intent === "print"
                ? {
                    intent: "print",
                    annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
                    printAnnotationStorage: doc.annotationStorage.print,
                  }
                : form
                  ? {
                      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
                      annotationCanvasMap: form.canvases,
                    }
                  : {}),
            };
            if (region) {
              // Shift the page so the region's corner lands on the canvas origin.
              canvas.width = region.width;
              canvas.height = region.height;
              task = page.render({ ...parameters, transform: [1, 0, 0, 1, -region.x, -region.y] });
            } else {
              // Whole pixels, as pdf.js's viewer sizes them, past a scale's
              // rounding error: a thumbnail 240 px wide came out at 239.99….
              canvas.width = Math.floor(viewport.width + 1e-6);
              canvas.height = Math.floor(viewport.height + 1e-6);
              task = page.render(parameters);
            }
            await task.promise;
            form?.layer?.refreshCanvases();
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
        renderTextLayer({ pageIndex, container, cssScale, rotation, structure }) {
          let layer: Pdfjs.TextLayer | undefined;
          let cancelled = false;
          const promise = getPage(pageIndex).then(async (page): Promise<TextLayerHandle> => {
            if (cancelled) throw new RenderCancelledError("text layer cancelled before it started");
            const viewport = viewportOf(page, cssScale, rotation);
            const tree = structure
              ? new StructTreeBuilder(page.getStructTree(), viewport.rawDims as RawDims)
              : null;
            const rendered = new pdfjs.TextLayer({
              textContentSource: inLayerLanguage(page.streamTextContent(TEXT_OPTIONS), container),
              container,
              // The layer is laid out unturned; pdf.js marks it with
              // data-main-rotation and the viewer CSS turns it.
              viewport,
            });
            layer = rendered;
            await rendered.render();
            if (tree && structure) {
              structTrees.set(pageIndex, tree);
              // An untagged page has no tree; a broken one leaves the text as it is.
              const dom = await tree.render().catch((error: unknown) => {
                console.error(`page ${pageIndex + 1}: structure tree failed`, error);
                return null;
              });
              if (cancelled) throw new RenderCancelledError("text layer cancelled");
              if (dom) {
                tree.updateTextLayer();
                structure.replaceChildren(dom);
              }
            }
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
        renderAnnotationLayer({
          pageIndex,
          container,
          cssScale,
          rotation,
          links,
          forms = false,
          layers,
        }) {
          let cancelled = false;
          if (forms) fieldObjects ??= doc.getFieldObjects().catch(() => null);
          const promise = getPage(pageIndex).then(async (page): Promise<AnnotationLayerHandle> => {
            const [annotations, fields] = await Promise.all([
              page.getAnnotations({ intent: "display" }),
              forms ? fieldObjects : null,
            ]);
            if (cancelled) throw new RenderCancelledError("annotation layer cancelled");
            const viewport = viewportOf(page, cssScale, rotation);
            const linkService = createLinkService(links, doc);
            // Without forms, form fields stay in the drawing (pdf.js's default
            // annotation mode), so only links, popups, and other annotations
            // that are not fields become HTML here.
            const form = forms ? formLayerOf(container) : null;
            const layer = new pdfjs.AnnotationLayer({
              div: container,
              accessibilityManager: null,
              annotationCanvasMap: form?.canvases ?? null,
              annotationEditorUIManager: null,
              page,
              viewport,
              structTreeLayer: structTrees.get(pageIndex) ?? null,
              commentManager: null,
              linkService,
              annotationStorage: doc.annotationStorage,
            });
            await layer.render({
              annotations,
              div: container as HTMLDivElement,
              page,
              viewport,
              linkService: linkService as never,
              downloadManager: createDownloadManager(links) as never,
              annotationStorage: doc.annotationStorage,
              imageResourcesPath,
              renderForms: forms,
              enableScripting: false,
              fieldObjects: fields,
              ...(layers && layerConfigs.has(layers)
                ? { optionalContentConfig: layerConfigs.get(layers)?.display }
                : {}),
            });
            if (iconUrls) placeIcons(container, iconUrls);
            if (form) form.layer = layer;
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
        async getPageLabels() {
          const labels = await doc.getPageLabels();
          // pdf.js returns labels only for documents that define them.
          return labels && labels.length === doc.numPages ? labels : null;
        },
        async getMetadata(): Promise<PdfMetadata> {
          const { info, metadata } = await doc.getMetadata();
          const fields = info as Record<string, unknown>;
          const date = (value: unknown) =>
            typeof value === "string" ? pdfjs.PDFDateString.toDateObject(value) : null;
          return {
            // XMP metadata is newer than the information dictionary when both exist.
            title: text(metadata?.get("dc:title"), fields.Title),
            author: text(metadata?.get("dc:creator"), fields.Author),
            subject: text(metadata?.get("dc:description"), fields.Subject),
            keywords: text(fields.Keywords),
            creator: text(fields.Creator),
            producer: text(fields.Producer),
            creationDate: date(fields.CreationDate),
            modificationDate: date(fields.ModDate),
            pdfVersion: text(fields.PDFFormatVersion),
            language: text(fields.Language),
          };
        },
        async getAttachments() {
          const attachments = await doc.getAttachments();
          return [...(attachments ?? [])].map(([id, attachment]) => {
            const { filename, description } = attachment as {
              filename?: string;
              description?: string;
            };
            return { id, filename: filename || "unnamed", description: text(description) };
          });
        },
        async getAttachmentContent(id) {
          return (await doc.getAttachmentContent(id)) ?? null;
        },
        createLayerState() {
          return createLayerState(doc);
        },
        async createAnnotationEditor(editorOptions) {
          // Loaded only by applications that edit annotations.
          const { createPdfjsAnnotationEditor } = await import("./pdfjs-editor.ts");
          return createPdfjsAnnotationEditor(pdfjs, doc, getPage, editorOptions);
        },
        save() {
          // Without edits, the original bytes; saveDocument() writes form
          // values and the editor's annotations in.
          return doc.annotationStorage.size > 0 ? doc.saveDocument() : doc.getData();
        },
        async resolveDestination(dest): Promise<ResolvedDestination | null> {
          const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
          return resolveExplicit(explicit);
        },
        async getPermissions(): Promise<PdfPermissions> {
          const flags = await doc.getPermissions();
          const flag = pdfjs.PermissionFlag;
          const has = (value: number) => !flags || flags.has(value);
          const permissions = {
            print: has(flag.PRINT),
            printHighQuality: has(flag.PRINT_HIGH_QUALITY),
            modify: has(flag.MODIFY_CONTENTS),
            copy: has(flag.COPY),
            copyForAccessibility: has(flag.COPY_FOR_ACCESSIBILITY),
            annotate: has(flag.MODIFY_ANNOTATIONS),
            fillForms: has(flag.FILL_INTERACTIVE_FORMS),
            assemble: has(flag.ASSEMBLE),
          };
          return { restricted: Object.values(permissions).includes(false), ...permissions };
        },
        async getInitialView(): Promise<PdfInitialView> {
          const [openAction, pageLayout, pageMode] = await Promise.all([
            doc.getOpenAction() as Promise<Map<string, unknown> | null>,
            doc.getPageLayout(),
            doc.getPageMode(),
          ]);
          const dest = openAction?.get("dest");
          return {
            destination: dest ? await resolveExplicit(dest).catch(() => null) : null,
            pageLayout: PAGE_LAYOUTS.has(pageLayout) ? (pageLayout as PdfPageLayout) : null,
            pageMode: PAGE_MODES.has(pageMode) ? (pageMode as PdfPageMode) : null,
          };
        },
        ...forms,
        releasePage(pageIndex) {
          structTrees.delete(pageIndex);
          // The page may never have loaded, or the document may be gone by now.
          pages.get(pageIndex)?.then(
            (page) => page.cleanup(),
            () => {},
          );
        },
        drawKept(canvas, source, size = source) {
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext(
            "2d",
            contextOptions,
          ) as CanvasRenderingContext2D | null;
          context?.drawImage(source, 0, 0, size.width, size.height);
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
