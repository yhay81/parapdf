import type {
  DestinationRef,
  LayerState,
  LinkHandlers,
  OutlineNode,
  PageColors,
  PageSize,
  PasswordReason,
  PdfAttachment,
  PdfEngine,
  PdfEngineDocument,
  PdfLayer,
  PdfMetadata,
  PdfSource,
  Rotation,
  TextLayerHandle,
} from "../engine/types.ts";
import { acquireDocument, type DocumentLease } from "./documents.ts";
import { downloadBytes, filenameFromUrl } from "./files.ts";
import { SearchHighlights } from "./highlights.ts";
import {
  computeLayout,
  type Layout,
  type LayoutOptions,
  type PageArea,
  pageAtPoint,
  pageLeft,
  pageTop,
  rowBounds,
  rowEnd,
  rowStart,
  type ScrollMode,
  type SpreadMode,
  sameRows,
  showPage,
  turnBox,
  turnedSize,
  type Viewport,
  visibleArea,
  visibleRange,
} from "./layout.ts";
import { type PrintOptions, printDocument } from "./print.ts";
import { RenderScheduler, type SchedulerStats } from "./scheduler.ts";
import { TextSelectionTracker } from "./selection.ts";
import { Store } from "./store.ts";
import {
  buildPageIndex,
  findMatches,
  normalizeQuery,
  type PageIndex,
  type SearchMatch,
  type SearchOptions,
} from "./text-search.ts";
import { ThumbnailRenderer } from "./thumbnails.ts";

export interface SearchState {
  query: string;
  /** How the query compares with the text. */
  options: SearchOptions;
  status: "idle" | "searching" | "done";
  /** Matches in page order. */
  matches: readonly SearchMatch[];
  /** Index into `matches` of the selected result, -1 when none. */
  current: number;
  pagesSearched: number;
}

export interface ViewerState {
  /**
   * "password" while an encrypted document waits for `submitPassword()`;
   * `passwordReason` says whether one is needed or the last one was wrong.
   */
  status: "idle" | "loading" | "password" | "ready" | "error";
  error: string | null;
  passwordReason: PasswordReason | null;
  /**
   * Bytes of the document received so far, and its size when the server
   * reported it; null before any arrive. pdf.js may keep fetching the rest
   * of a large document in the background after it is ready.
   */
  progress: LoadProgress | null;
  pageCount: number;
  layout: Layout | null;
  /** Mounted page window: visible pages plus overscan. */
  first: number;
  last: number;
  /**
   * The page being read: the page nearest the viewport's center, except that
   * the current page stays current while all of it is in view, as in pdf.js.
   * `goToPage()`, links, `back()`, and search make the page they show
   * current, which then stays so even when it is too small to reach the
   * center, as the first page at the start of a row of pages is.
   */
  currentPage: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /**
   * "fit-width" keeps fitting the width of the current page as the viewport
   * resizes or the view turns, "fit-page" all of that page; "custom" keeps
   * `scale`.
   */
  zoomMode: ZoomMode;
  /**
   * What a mouse drag does: "select" selects text, "hand" scrolls the
   * document like grabbing paper.
   */
  tool: PointerTool;
  /** Clockwise view rotation of every page. */
  rotation: Rotation;
  /** Whether pages show one per row or side by side in pairs. */
  spread: SpreadMode;
  /**
   * How pages are arranged and scrolled: in a column, in a row, in rows
   * filling the viewport's width, or one page or spread at a time.
   */
  scrollMode: ScrollMode;
  /** The open document, for engine features ParaPDF does not wrap; null until it loads. */
  document: PdfEngineDocument | null;
  search: SearchState;
  /** Document outline; null until loaded, empty when the PDF has none. */
  outline: readonly OutlineNode[] | null;
  /** Whether `back()` can return to a position before a link or outline jump. */
  canGoBack: boolean;
  /** Each page's label, such as "iv"; null while loading and when the PDF defines none. */
  pageLabels: readonly string[] | null;
  /** The document's title, author, dates, and so on; null until loaded. */
  metadata: PdfMetadata | null;
  /** Files embedded in the document; null until loaded, empty when it has none. */
  attachments: readonly PdfAttachment[] | null;
  /**
   * The document's layers (optional content) in its own order, and which
   * show; null until loaded, empty when it has none.
   */
  layers: readonly PdfLayer[] | null;
}

export type ZoomMode = "fit-width" | "fit-page" | "custom";

/** A rectangle in PDF points from the top-left corner of a page, unturned by the view. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The text selected in a viewer and where it lies on its pages. */
export interface PdfSelection {
  /** The selected text, as the browser copies it. */
  text: string;
  /** The rectangles the selected text covers, page by page, in page order. */
  pages: readonly { pageIndex: number; rects: readonly PdfRect[] }[];
}

export type PointerTool = "select" | "hand";

export interface LoadProgress {
  loaded: number;
  total: number | null;
}

export interface ViewerOptions {
  /** Space between pages in CSS pixels. */
  gap?: number;
  /** One page per row (the default), or pairs side by side; see `setSpread()`. */
  spread?: SpreadMode;
  /** How pages are arranged and scrolled (default "vertical"); see `setScrollMode()`. */
  scrollMode?: ScrollMode;
  /** Pages mounted beyond each edge of the viewport. */
  overscan?: number;
  maxConcurrentRenders?: number;
  /**
   * A scale in CSS pixels per point, "fit-width" (the default) to keep
   * fitting the page width, or "fit-page" to keep fitting the whole page.
   */
  initialScale?: number | "fit-width" | "fit-page";
  /** The zero-based page shown first, at the top of the viewport (default 0). */
  initialPage?: number;
  /** What a mouse drag does at first (default "select"); see `setTool()`. */
  initialTool?: PointerTool;
  minScale?: number;
  maxScale?: number;
  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
  /**
   * Build annotation layers (default true): focusable links, comment popups,
   * and, with `forms`, form fields.
   */
  annotationLayer?: boolean;
  /**
   * Show form fields as HTML that the reader can fill in (default false: the
   * drawing shows them as they are). Typed values belong to the document,
   * which `save()` writes them into. Needs `annotationLayer`.
   */
  forms?: boolean;
  /**
   * Draw pages in these two colors instead of their own, for example
   * `{ background: "Canvas", foreground: "CanvasText" }` in forced-colors mode.
   */
  pageColors?: PageColors;
  /**
   * What links to other documents do: open in a new tab (the default), or
   * nothing, for apps that must not lead away from the document. Internal
   * links and the outline keep working.
   */
  externalLinks?: "new-tab" | "disabled";
  /**
   * Called when the reader opens a file attachment annotation or a link to
   * an embedded file. By default the browser downloads the file.
   */
  openAttachment?: (attachment: { filename: string; content: Uint8Array }) => void;
  /**
   * The most pixels one page's detail canvas holds (default 16 777 216, the
   * canvas area limit of iOS). A page larger at full resolution gets detail
   * only for its visible area plus a margin, still at full resolution.
   */
  maxDetailPixels?: number;
  /**
   * The most pixels one page's detail canvas holds, as a multiple of the
   * viewport's device pixels (default unlimited): the margin drawn around the
   * visible area then follows the viewport's size, small on a phone and large
   * on a wide desktop panel. maxDetailPixels still caps it. At 1 the detail
   * holds just the viewport; below 1 the visible area loses resolution.
   */
  maxDetailViewports?: number;
  /** The most pixels one page's base canvas holds (default 2 097 152). */
  maxBasePixels?: number;
  /**
   * The most pixels all of this viewer's canvases hold together (default
   * unlimited), for memory-capped browsers such as iOS Safari. Visible pages
   * come first: after their bases, each visible page's detail gets a share of
   * the rest by visible area, losing its margin first and then resolution, in
   * quarter-octave steps down to its base's. Pages outside the viewport
   * render only within what is left and give their pixels back, farthest
   * first and detail before base. Visible bases are never given back, so a
   * visible page never goes blank, and a budget smaller than they are is
   * exceeded by them.
   */
  maxCanvasPixels?: number;
}

/** Jumps kept for `back()`. */
const HISTORY_LIMIT = 50;

/** Scrolling faster than this (CSS px/ms) defers full-resolution renders. */
const SETTLE_VELOCITY = 2;
/** Scrolling is considered stopped after this many milliseconds without events. */
const SETTLE_DELAY = 120;
/** A ctrl/pinch wheel gesture or a Safari gesture commits this long after its last event. */
const ZOOM_COMMIT_DELAY = 150;
/**
 * Two touches start zooming once the distance between them changed by this
 * many CSS pixels, and only pan before: otherwise the jitter of a two-finger
 * drag or tap changed the zoom by a fraction and rendered every page again.
 */
const PINCH_SLOP = 16;
/** Safari's events for trackpad pinches, which iPadOS also sends for touch pinches. */
const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;
/** What Ctrl or ⌘ with + and - zooms by. */
const ZOOM_STEP = 1.25;
/** Search publishes partial results at most this often. */
const SEARCH_PUBLISH_INTERVAL = 100;

const IDLE_SEARCH: SearchState = {
  query: "",
  options: {},
  status: "idle",
  matches: [],
  current: -1,
  pagesSearched: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether a visible area is all of its page. */
const whole = (area: PageArea | null): boolean =>
  area !== null && area.minX === 0 && area.minY === 0 && area.maxX === 1 && area.maxY === 1;

const viewportOf = (scroller: HTMLElement): Viewport => ({
  left: scroller.scrollLeft,
  top: scroller.scrollTop,
  width: scroller.clientWidth,
  height: scroller.clientHeight,
  scrollerWidth: scroller.clientWidth,
  scrollerHeight: scroller.clientHeight,
});

/**
 * Add the rectangles of the text `range` selects in a text `layer` to
 * `rects`, in PDF points of its unturned page of `size`: each text node's
 * selected part, measured on screen against the page's box, then turned
 * back by the view's rotation.
 */
function selectedRects(
  range: Range,
  layer: HTMLElement,
  section: HTMLElement,
  size: PageSize,
  rotation: Rotation,
  rects: PdfRect[],
): void {
  const box = section.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const turned = turnedSize(size, rotation);
  const back = ((360 - rotation) % 360) as Rotation;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || !(node instanceof Text)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    if (part.collapsed) continue;
    for (const rect of part.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      rects.push(
        turnBox(
          {
            x: ((rect.left - box.left) / box.width) * turned.width,
            y: ((rect.top - box.top) / box.height) * turned.height,
            width: (rect.width / box.width) * turned.width,
            height: (rect.height / box.height) * turned.height,
          },
          turned,
          back,
        ),
      );
    }
  }
}

/**
 * How fast the shown content moves along the direction pages follow each
 * other: full-resolution work waits while it moves fast.
 */
interface Motion {
  /** The shown content's top, or left in "horizontal" mode, at its last move, in CSS pixels. */
  position: number;
  /** `performance.now()` at that move. */
  at: number;
  /** CSS pixels per millisecond, smoothed over moves that follow each other quickly. */
  velocity: number;
}

/** The shown content moved to `position` at `now`. */
function move(motion: Motion, position: number, now: number): void {
  const elapsed = now - motion.at;
  if (elapsed > 0) {
    const instant = (position - motion.position) / elapsed;
    motion.velocity = elapsed > SETTLE_DELAY ? instant : motion.velocity * 0.6 + instant * 0.4;
  }
  motion.position = position;
  motion.at = now;
}

/** Where `viewport` is along the direction pages follow each other in `scrollMode`. */
const positionOf = (scrollMode: ScrollMode, viewport: { left: number; top: number }): number =>
  scrollMode === "horizontal" ? viewport.left : viewport.top;

const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

type PageElements = [
  HTMLCanvasElement,
  HTMLCanvasElement,
  HTMLElement | null,
  HTMLElement | null,
  HTMLElement | null,
];

/** The scroller's size, which rows are centered in. */
interface ScrollerSize {
  width: number;
  height: number;
}

/**
 * The scroll position at which the content point `point` of `layout` shows
 * at `anchor` (viewport coordinates) in `next`, as a share of the same page
 * along both axes: rows are centered in the viewport and may wrap
 * differently, so a share of the content's size moved points sideways. The
 * browser clamps it to the scrollable range.
 */
function zoomTarget(
  layout: Layout,
  next: Layout,
  scroller: ScrollerSize,
  anchor: { x: number; y: number },
  point: { x: number; y: number },
): { left: number; top: number } {
  const { width, height } = scroller;
  const page = pageAtPoint(layout, point.x, point.y, width);
  const withinX = (point.x - pageLeft(layout, page, width)) / (layout.widths[page] || 1);
  const withinY = (point.y - pageTop(layout, page, height)) / (layout.heights[page] || 1);
  return {
    left: pageLeft(next, page, width) + withinX * (next.widths[page] ?? 0) - anchor.x,
    top: pageTop(next, page, height) + withinY * (next.heights[page] ?? 0) - anchor.y,
  };
}

const sizeOf = (scroller: HTMLElement): ScrollerSize => ({
  width: scroller.clientWidth,
  height: scroller.clientHeight,
});

/**
 * A zoom gesture in progress: the wheel with ctrl or meta (also trackpad
 * pinches in Chromium and Firefox), two touches, or Safari's gesture events.
 * A CSS transform previews it until it commits.
 */
interface ZoomGesture {
  source: "wheel" | "touch" | "gesture";
  /** Zoom relative to the committed scale. */
  factor: number;
  /** The point the gesture zooms around, in the content's unscaled CSS pixels. */
  originX: number;
  originY: number;
  /** How far a two-finger drag moved that point on screen. */
  panX: number;
  panY: number;
  /** What the preview adds to the pan to show the content where the commit puts it. */
  shiftX: number;
  shiftY: number;
  /**
   * How the content the preview shows moves. It is kept apart from
   * scrolling's: a zoom's commit jumps to another scroll position, which,
   * measured against the preview's last move, would look like a fling.
   */
  motion: Motion;
  /** Pending commit of a wheel or Safari gesture. */
  timer: number;
}

/** Two touches on the viewport, zooming around their midpoint and panning with it. */
interface Pinch {
  ids: readonly [number, number];
  zoom: ZoomGesture;
  /** Midpoint of the touches when the pinch started, in client coordinates. */
  startX: number;
  startY: number;
  startDistance: number;
  /** The distance the zoom is relative to, from when the touches moved past PINCH_SLOP; 0 before. */
  baseDistance: number;
}

/** Safari's GestureEvent, which TypeScript's DOM library does not declare. */
interface SafariGestureEvent extends UIEvent {
  /** The distance between the touches, or the trackpad's magnification, relative to the start. */
  readonly scale: number;
  /** The pointer's position on macOS, the midpoint of the touches on iPadOS. */
  readonly clientX?: number;
  readonly clientY?: number;
}

/**
 * The imperative core behind the React components. It owns scrolling, layout,
 * zoom, search, navigation, and the render scheduler; React only re-renders
 * when the published store fields change.
 */
export class PdfViewerRuntime {
  readonly store = new Store<ViewerState>({
    status: "idle",
    error: null,
    passwordReason: null,
    progress: null,
    pageCount: 0,
    layout: null,
    first: 0,
    last: -1,
    currentPage: 0,
    scale: 1,
    zoomMode: "custom",
    tool: "select",
    search: IDLE_SEARCH,
    outline: null,
    canGoBack: false,
    rotation: 0,
    spread: "none",
    scrollMode: "vertical",
    document: null,
    pageLabels: null,
    metadata: null,
    attachments: null,
    layers: null,
  });
  readonly #engine: PdfEngine;
  readonly #gap: number;
  readonly #overscan: number;
  readonly #maxConcurrentRenders: number;
  readonly #initialScale: number | "fit-width" | "fit-page";
  readonly #initialPage: number;
  readonly #minScale: number;
  readonly #maxScale: number;
  readonly #textLayer: boolean;
  readonly #annotationLayer: boolean;
  readonly #forms: boolean;
  readonly #pageColors: PageColors | undefined;
  readonly #canvasLimits: Pick<
    ViewerOptions,
    "maxDetailPixels" | "maxDetailViewports" | "maxBasePixels" | "maxCanvasPixels"
  >;
  readonly #links: LinkHandlers;
  /**
   * Positions before link and outline jumps: the page at the viewport's
   * top-left corner and where that corner is, as a share of the page.
   */
  #history: { pageIndex: number; x: number; y: number; current: number }[] = [];
  readonly #highlights = new SearchHighlights();
  readonly #selection = new TextSelectionTracker();
  readonly #thumbnails = new ThumbnailRenderer({
    scheduler: () => this.#scheduler,
    pageSize: (pageIndex) => this.#sizes[pageIndex],
    rotation: () => this.store.get().rotation,
    layers: () => this.#layers,
  });
  /** Which of the open document's layers show in this viewer. */
  #layers: LayerState | null = null;
  #generation = 0;
  /** The open document's lease, through which a password is submitted. */
  #lease: DocumentLease | null = null;
  /** Progress waiting to be published at the next animation frame. */
  #progress: LoadProgress | null = null;
  #progressFrame = 0;
  #doc: PdfEngineDocument | null = null;
  /** The file name the open document's URL gives, for download(). */
  #sourceName: string | null = null;
  #scheduler: RenderScheduler | null = null;
  #sizes: PageSize[] = [];
  #pendingPages = new Map<number, PageElements>();
  #textPages = new Map<number, TextLayerHandle>();
  /** Each page's search index, by the options that shape it ("case-sensitive diacritics"). */
  #indexes = new Map<string, Map<number, Promise<PageIndex>>>();
  #searchGeneration = 0;
  #scroller: HTMLElement | null = null;
  #content: HTMLElement | null = null;
  #frame = 0;
  #settleTimer = 0;
  /** How scrolling moves the content; a gesture's preview tracks its own motion. */
  readonly #scrolling: Motion = { position: 0, at: 0, velocity: 0 };
  #zoom: ZoomGesture | null = null;
  /** Touch pointers down on the viewport, in client coordinates. */
  readonly #touches = new Map<number, { x: number; y: number }>();
  #pinch: Pinch | null = null;
  /** Removes the window listeners that follow the touches down on the viewport. */
  #touchListeners: AbortController | null = null;
  /** The scale of Safari's gesture in progress at its latest event; null without one. */
  #gestureScale: number | null = null;
  /** The gesture scale at which a gesture zoom's factor is 1. */
  #gestureBase = 1;
  #firstPaintAt: number | null = null;
  /** Viewport size the "fit-width" or "fit-page" scale was last computed for. */
  #fittedWidth = 0;
  #fittedHeight = 0;
  /** The hand tool's drag in progress: the pointer and where it last was. */
  #grab: { pointerId: number; x: number; y: number } | null = null;

  constructor(engine: PdfEngine, options: ViewerOptions = {}) {
    this.#engine = engine;
    this.#gap = options.gap ?? 12;
    this.#overscan = options.overscan ?? 2;
    this.#maxConcurrentRenders = options.maxConcurrentRenders ?? 2;
    this.#initialScale = options.initialScale ?? "fit-width";
    this.#initialPage = options.initialPage ?? 0;
    this.#minScale = options.minScale ?? 0.25;
    this.#maxScale = options.maxScale ?? 10;
    this.#textLayer = options.textLayer ?? true;
    this.#annotationLayer = options.annotationLayer ?? true;
    this.#forms = options.forms ?? false;
    this.#pageColors = options.pageColors;
    this.#links = {
      navigate: (dest) => void this.goToDestination(dest),
      namedAction: (action) => this.#namedAction(action),
      externalLinks: options.externalLinks ?? "new-tab",
      openAttachment:
        options.openAttachment ?? (({ filename, content }) => downloadBytes(content, filename)),
      setLayers: (action) => this.#changeLayers((layers) => layers.apply(action)),
    };
    this.#canvasLimits = {
      maxDetailPixels: options.maxDetailPixels,
      maxDetailViewports: options.maxDetailViewports,
      maxBasePixels: options.maxBasePixels,
      maxCanvasPixels: options.maxCanvasPixels,
    };
    this.store.set({
      zoomMode: this.#initialZoomMode(),
      tool: options.initialTool ?? "select",
      spread: options.spread ?? "none",
      scrollMode: options.scrollMode ?? "vertical",
    });
  }

  get engineName(): string {
    return this.#engine.name;
  }

  get textLayer(): boolean {
    return this.#textLayer;
  }

  get annotationLayer(): boolean {
    return this.#annotationLayer;
  }

  get scroller(): HTMLElement | null {
    return this.#scroller;
  }

  /** Render counters for the current document. */
  get stats(): SchedulerStats | null {
    return this.#scheduler?.stats ?? null;
  }

  /** `performance.now()` when the first page first showed pixels. */
  get firstPaintAt(): number | null {
    return this.#firstPaintAt;
  }

  /**
   * Open a document and return the function that closes it. Viewers of the
   * same source share one loaded document (see documents.ts).
   */
  open(source: PdfSource): () => void {
    const generation = ++this.#generation;
    let closed = false;
    const lease = acquireDocument(this.#engine, source, {
      onProgress: (loaded, total) => {
        if (closed) return;
        this.#progress = { loaded, total };
        // Chunks arrive many times a frame; the store hears of them once a frame.
        this.#progressFrame ||= requestAnimationFrame(() => {
          this.#progressFrame = 0;
          if (!closed && this.#progress) this.store.set({ progress: this.#progress });
        });
      },
      onPassword: (reason) => {
        if (!closed) this.store.set({ status: "password", passwordReason: reason });
      },
    });
    this.#lease = lease;
    this.#sourceName = "url" in source ? filenameFromUrl(source.url) : null;
    this.#firstPaintAt = null;
    this.#history = [];
    this.store.set({
      status: "loading",
      error: null,
      passwordReason: null,
      progress: null,
      search: IDLE_SEARCH,
      outline: null,
      canGoBack: false,
      currentPage: 0,
      rotation: 0,
      zoomMode: this.#initialZoomMode(),
      document: null,
      pageLabels: null,
      metadata: null,
      attachments: null,
      layers: null,
    });

    void (async () => {
      try {
        const doc = await lease.document;
        if (closed) return;
        const firstSize = await doc.pageSize(0);
        if (closed) return;
        this.#doc = doc;
        // Assume every page matches the first until the background pass knows better.
        this.#sizes = Array.from({ length: doc.pageCount }, () => firstSize);
        this.#scheduler = new RenderScheduler(doc, {
          maxConcurrent: this.#maxConcurrentRenders,
          ...this.#canvasLimits,
          links: this.#links,
          forms: this.#forms,
          ...(this.#pageColors ? { pageColors: this.#pageColors } : {}),
          selection: this.#selection,
          onPainted: (pageIndex) => {
            if (pageIndex === 0 && this.#firstPaintAt === null) {
              this.#firstPaintAt = performance.now();
            }
          },
          onTextReady: (pageIndex, handle) => {
            this.#textPages.set(pageIndex, handle);
            this.#highlightPage(pageIndex);
          },
          onTextRemoved: (pageIndex) => {
            this.#textPages.delete(pageIndex);
            this.#highlights.clearPage(pageIndex);
          },
        });
        for (const [index, [base, detail, text, annotations, structure]] of this.#pendingPages) {
          this.#scheduler.attach(index, base, detail, text, annotations, structure);
        }
        this.#pendingPages.clear();
        this.#thumbnails.refresh();
        const scale = this.#resolveInitialScale();
        this.#applyLayout(scale);
        this.store.set({
          status: "ready",
          passwordReason: null,
          pageCount: doc.pageCount,
          scale,
          document: doc,
        });
        if (this.#initialPage > 0) this.goToPage(this.#initialPage);
        this.#update();
        this.#background(this.#refineSizes(doc, generation), "measuring page sizes", generation);
        // The outline and the rest parse in the worker; each is published when ready.
        this.#publishLater(generation, doc.getOutline(), "outline", []);
        this.#publishLater(generation, doc.getPageLabels(), "pageLabels", null);
        this.#publishLater(generation, doc.getMetadata(), "metadata", null);
        this.#publishLater(generation, doc.getAttachments(), "attachments", []);
        // Until its own state arrives, the viewer draws the document's
        // default layers, which that state starts with: nothing is drawn again.
        this.#publishLater(
          generation,
          doc.createLayerState().then((layers) => {
            if (this.#generation === generation) {
              this.#layers = layers;
              this.#scheduler?.setLayers(layers);
            }
            return layers.layers();
          }),
          "layers",
          [],
        );
      } catch (error) {
        if (!closed)
          this.store.set({ status: "error", error: String(error), passwordReason: null });
      }
    })();

    return () => {
      closed = true;
      cancelAnimationFrame(this.#progressFrame);
      this.#progressFrame = 0;
      if (this.#lease === lease) this.#lease = null;
      if (this.#generation === generation) {
        // Work still running for this document now sees a stale generation.
        this.#generation++;
        this.#scheduler?.dispose();
        this.#thumbnails.reset();
        this.#searchGeneration++;
        this.#highlights.clear();
        this.#selection.clear();
        this.#textPages.clear();
        this.#indexes.clear();
        this.#history = [];
        this.#doc = null;
        this.#layers = null;
        this.#scheduler = null;
        this.store.set({
          status: "idle",
          passwordReason: null,
          progress: null,
          pageCount: 0,
          layout: null,
          first: 0,
          last: -1,
          search: IDLE_SEARCH,
          outline: null,
          canGoBack: false,
          document: null,
          pageLabels: null,
          metadata: null,
          attachments: null,
          layers: null,
        });
      }
      // Destroyed once no viewer uses it, even if it is still loading.
      lease.release();
    };
  }

  /** Publish what `work` loads as `field` while `generation` is open, or `fallback` if it fails. */
  #publishLater<K extends keyof ViewerState>(
    generation: number,
    work: Promise<ViewerState[K]>,
    field: K,
    fallback: ViewerState[K],
  ): void {
    const publish = (value: ViewerState[K]) => {
      if (this.#generation === generation)
        this.store.set({ [field]: value } as Partial<ViewerState>);
    };
    work.then(publish, (error: unknown) => {
      if (this.#generation === generation) console.error(`loading ${field} failed`, error);
      publish(fallback);
    });
  }

  /**
   * The document's bytes, with what was typed into its form fields saved in
   * them; null while no document is open.
   */
  async save(): Promise<Uint8Array | null> {
    return (await this.#doc?.save()) ?? null;
  }

  /**
   * Save the document as `save()` does and hand it to the browser as a
   * download, named `filename`, by default after the document's URL.
   */
  async download(filename?: string): Promise<void> {
    const bytes = await this.save();
    if (!bytes) return;
    downloadBytes(bytes, filename ?? this.#sourceName ?? "document.pdf", "application/pdf");
  }

  /**
   * Show or hide one of the document's layers (see `layers`) in this viewer.
   * Showing one of a set of exclusive layers hides the others. Pages keep
   * their pixels until they are drawn again.
   */
  setLayerVisible(id: string, visible: boolean): void {
    this.#changeLayers((layers) => layers.setVisible(id, visible));
  }

  #changeLayers(change: (layers: LayerState) => void): void {
    const layers = this.#layers;
    if (!layers) return;
    change(layers);
    this.store.set({ layers: layers.layers() });
    this.#scheduler?.invalidateContent();
    this.#thumbnails.reset();
    this.#thumbnails.refresh();
  }

  /**
   * Print the document through the browser's print dialog: every page is
   * drawn for printing, with what was typed into its form fields, and only
   * those pages print. Resolves once the browser returns from printing.
   */
  async print(options?: PrintOptions): Promise<void> {
    const doc = this.#doc;
    if (doc) await printDocument(doc, { ...options, layers: this.#layers });
  }

  /** The content of the embedded file `id` (see `attachments`), null when there is none. */
  async getAttachmentContent(id: string): Promise<Uint8Array | null> {
    return (await this.#doc?.getAttachmentContent(id)) ?? null;
  }

  /** Open an embedded file the way activating its annotation does: by default, download it. */
  async openAttachment(attachment: PdfAttachment): Promise<void> {
    const content = await this.getAttachmentContent(attachment.id);
    if (content) this.#links.openAttachment?.({ filename: attachment.filename, content });
  }

  /**
   * Try a password for the encrypted document that waits for one (status
   * "password"); a wrong one asks again with the reason "incorrect". Null
   * stops opening the document, which then fails.
   */
  submitPassword(password: string | null): void {
    if (this.store.get().status !== "password") return;
    this.store.set({ status: "loading", passwordReason: null });
    this.#lease?.submitPassword(password);
  }

  /** Bind the scroll container and its sized content element. */
  attachViewport(scroller: HTMLElement, content: HTMLElement): () => void {
    this.#scroller = scroller;
    this.#content = content;
    const layout = this.store.get().layout;
    if (layout) this.#sizeContent(layout);
    scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    scroller.addEventListener("wheel", this.#onWheel, { passive: false });
    scroller.addEventListener("pointerdown", this.#onPointerDown, { passive: true });
    scroller.addEventListener("pointerdown", this.#onGrabStart);
    scroller.addEventListener("pointermove", this.#onGrabMove, { passive: true });
    scroller.addEventListener("pointerup", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("pointercancel", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("keydown", this.#onKeyDown);
    scroller.classList.toggle("parapdf-hand", this.store.get().tool === "hand");
    // Not passive: Safari zooms the whole page unless they are prevented.
    for (const type of GESTURE_EVENTS) {
      scroller.addEventListener(type, this.#onGesture, { passive: false });
    }
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    const detachSelection = this.#selection.attachPages(content);
    this.#requestUpdate();
    return () => {
      scroller.removeEventListener("scroll", this.#onScroll);
      scroller.removeEventListener("wheel", this.#onWheel);
      scroller.removeEventListener("pointerdown", this.#onPointerDown);
      scroller.removeEventListener("pointerdown", this.#onGrabStart);
      scroller.removeEventListener("pointermove", this.#onGrabMove);
      scroller.removeEventListener("pointerup", this.#onGrabEnd);
      scroller.removeEventListener("pointercancel", this.#onGrabEnd);
      scroller.removeEventListener("keydown", this.#onKeyDown);
      scroller.classList.remove("parapdf-hand", "parapdf-grabbing");
      this.#grab = null;
      for (const type of GESTURE_EVENTS) scroller.removeEventListener(type, this.#onGesture);
      resize.disconnect();
      detachSelection();
      if (this.#frame) cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (this.#scroller === scroller) {
        this.#dropZoom();
        this.#scroller = null;
        this.#content = null;
      }
    };
  }

  /** Register a mounted page's layers; returns the function that releases them. */
  attachPage(
    index: number,
    base: HTMLCanvasElement,
    detail: HTMLCanvasElement,
    text: HTMLElement | null,
    annotations: HTMLElement | null = null,
    structure: HTMLElement | null = null,
  ): () => void {
    const textLayer = this.#textLayer ? text : null;
    const annotationLayer = this.#annotationLayer ? annotations : null;
    // The structure takes the text layer's runs in, so it comes with them.
    const structureLayer = textLayer ? structure : null;
    const scheduler = this.#scheduler;
    if (scheduler) {
      scheduler.attach(index, base, detail, textLayer, annotationLayer, structureLayer);
    } else {
      this.#pendingPages.set(index, [base, detail, textLayer, annotationLayer, structureLayer]);
    }
    return () => {
      this.#pendingPages.delete(index);
      if (this.#scheduler === scheduler) scheduler?.detach(index);
    };
  }

  /**
   * Draw page `pageIndex` into `canvas` as a thumbnail `width` CSS pixels
   * wide while it is near the visible part of its scroll container; returns
   * the function that releases it. `<PdfThumbnail>` calls this.
   */
  attachThumbnail(pageIndex: number, canvas: HTMLCanvasElement, width: number): () => void {
    return this.#thumbnails.attach(pageIndex, canvas, width);
  }

  hasPixels(index: number): boolean {
    return this.#scheduler?.hasPixels(index) ?? false;
  }

  /**
   * The text selected in this viewer's pages and the rectangles it covers,
   * in the coordinates `<PdfPageRect>` takes, for example to keep it as a
   * highlight; null when nothing is selected there. Only mounted pages have
   * text to select.
   */
  getSelection(): PdfSelection | null {
    const content = this.#content;
    const layout = this.store.get().layout;
    const selection = document.getSelection();
    if (!content || !layout || !selection || selection.isCollapsed) return null;
    const rectsByPage = new Map<number, PdfRect[]>();
    let text = "";
    let outside = false;
    for (let at = 0; at < selection.rangeCount; at++) {
      const range = selection.getRangeAt(at);
      if (!range.intersectsNode(content)) {
        outside = true;
        continue;
      }
      if (!content.contains(range.commonAncestorContainer)) outside = true;
      text += range.toString();
      for (const layer of content.querySelectorAll<HTMLElement>(".parapdf-text-layer")) {
        if (!range.intersectsNode(layer)) continue;
        const section = layer.closest<HTMLElement>("section[data-page]");
        const pageIndex = Number(section?.dataset.page) - 1;
        const size = layout.sizes[pageIndex];
        if (!section || !size) continue;
        const rects = rectsByPage.get(pageIndex) ?? [];
        rectsByPage.set(pageIndex, rects);
        selectedRects(range, layer, section, size, layout.rotation, rects);
      }
    }
    if (rectsByPage.size === 0) return null;
    return {
      // The selection's own text keeps its line breaks.
      text: outside ? text : selection.toString(),
      pages: [...rectsByPage]
        .sort(([a], [b]) => a - b)
        .map(([pageIndex, rects]) => ({ pageIndex, rects })),
    };
  }

  /** Fraction of the viewport covered by pages that show no pixels yet. */
  blankFraction(): number {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller || scroller.clientHeight === 0) return 0;
    const viewport = viewportOf(scroller);
    const { first, last } = visibleRange(layout, viewport);
    let blank = 0;
    for (let index = first; index <= last; index++) {
      const area = visibleArea(layout, index, viewport);
      if (!area || this.hasPixels(index)) continue;
      blank +=
        (area.maxX - area.minX) *
        (layout.widths[index] ?? 0) *
        (area.maxY - area.minY) *
        (layout.heights[index] ?? 0);
    }
    return blank / (scroller.clientHeight * scroller.clientWidth);
  }

  /**
   * How sharp the visible pages look: the resolution of their pixels as a
   * share of full device resolution, weighted by visible area. 1 means sharp
   * everywhere, 0 means blank.
   */
  sharpness(): number {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    const scheduler = this.#scheduler;
    if (!layout || !scroller || !scheduler || scroller.clientHeight === 0) return 0;
    const viewport = viewportOf(scroller);
    const needed = layout.scale * (window.devicePixelRatio || 1);
    const { first, last } = visibleRange(layout, viewport);
    let weighted = 0;
    let total = 0;
    for (let index = first; index <= last; index++) {
      const area = visibleArea(layout, index, viewport);
      if (!area) continue;
      const size =
        (area.maxX - area.minX) *
        (layout.widths[index] ?? 0) *
        (area.maxY - area.minY) *
        (layout.heights[index] ?? 0);
      weighted += size * scheduler.sharpness(index, area, needed);
      total += size;
    }
    return total > 0 ? weighted / total : 0;
  }

  /**
   * Show page `index` from its top: its row at the viewport's top, or, in
   * "horizontal" mode, the page at the viewport's left. "page" mode shows its
   * row instead of the one it showed.
   */
  goToPage(index: number): void {
    const current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller || current.tops.length === 0) return;
    const target = clamp(index, 0, current.tops.length - 1);
    const layout = this.#show(current, target);
    const { gap } = layout;
    const left = pageLeft(layout, target, scroller.clientWidth);
    const top = pageTop(layout, target, scroller.clientHeight);
    if (layout.scrollMode === "horizontal") {
      scroller.scrollLeft = left - gap;
      scroller.scrollTop = top - gap;
    } else {
      // The row's top: a page shorter than its row is centered in it.
      scroller.scrollTop = top - ((layout.tops[target] ?? 0) - (layout.rowTops[target] ?? 0)) - gap;
      // A page of a spread wider than the viewport may lie beside it.
      const right = left + (layout.widths[target] ?? 0);
      if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = left - gap;
      }
    }
    // At once, not at the scroll event: a flip may not scroll at all, and a
    // second flip in the same frame starts from the page this one shows.
    this.store.set({ currentPage: target });
    this.#update();
  }

  /** Go to the next page, or the next spread or row of pages; "page" mode flips to it. */
  nextPage(): void {
    this.#flip(1);
  }

  /** Go to the previous page, or the previous spread or row of pages. */
  previousPage(): void {
    this.#flip(-1);
  }

  /**
   * Go to the first page after the current page's row, or the last before
   * it: in "horizontal" mode, where all pages share one row, its spread.
   * Keys that flip pages pass the `axis` they scroll along: the page then
   * shows from the edge they crossed, at the same place along the other axis.
   */
  #flip(direction: 1 | -1, axis: "x" | "y" | null = null): boolean {
    const { layout, currentPage, spread } = this.store.get();
    const scroller = this.#scroller;
    if (!layout || !scroller) return false;
    const count = layout.tops.length;
    const row =
      layout.scrollMode === "horizontal"
        ? rowBounds(spread, currentPage, count)
        : { first: rowStart(layout, currentPage), last: rowEnd(layout, currentPage) };
    const target = direction > 0 ? row.last + 1 : row.first - 1;
    if (target < 0 || target >= count) return false;
    const { scrollLeft, scrollTop } = scroller;
    this.goToPage(target);
    // The browser clamps the far edge to the scrollable range.
    if (axis === "y") {
      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = direction > 0 ? 0 : scroller.scrollHeight;
    } else if (axis === "x") {
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = direction > 0 ? 0 : scroller.scrollWidth;
    }
    return true;
  }

  /**
   * In "page" mode, show the row of page `index`, resizing the content for
   * it; returns the layout that shows it, `layout` itself in the other modes.
   */
  #show(layout: Layout, index: number): Layout {
    const next = showPage(layout, index);
    if (next !== layout) {
      this.#sizeContent(next);
      this.store.set({ layout: next });
    }
    return next;
  }

  /**
   * Follow an internal link or outline entry. The position before the jump
   * is remembered for `back()`. Resolves to false when the target is invalid.
   */
  async goToDestination(dest: DestinationRef): Promise<boolean> {
    const doc = this.#doc;
    if (!doc) return false;
    const target = await doc.resolveDestination(dest).catch(() => null);
    const current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!target || !current || !scroller || this.#doc !== doc) return false;
    const { pageIndex } = target;
    if (pageIndex < 0 || pageIndex >= current.tops.length) return false;
    this.#remember();
    const layout = this.#show(current, pageIndex);
    // The engine reports the point on the unturned page; a quarter turn makes
    // its left coordinate the vertical one.
    const size = layout.sizes[pageIndex] ?? { width: 0, height: 0 };
    const point = turnBox(
      { x: target.x ?? 0, y: target.y ?? 0, width: 0, height: 0 },
      size,
      layout.rotation,
    );
    const quarter = layout.rotation % 180 !== 0;
    const hasTop = (quarter ? target.x : target.y) !== null;
    const hasLeft = (quarter ? target.y : target.x) !== null;
    const pageX = pageLeft(layout, pageIndex, scroller.clientWidth);
    const pageY = pageTop(layout, pageIndex, scroller.clientHeight);
    // An explicit top lands at the top edge of the viewport, as in other PDF
    // readers, and an explicit left, in "horizontal" mode, at its left edge.
    const top = hasTop ? pageY + point.y * layout.scale : pageY - layout.gap;
    const left = hasLeft ? pageX + point.x * layout.scale : pageX - layout.gap;
    scroller.scrollTop = top;
    if (
      layout.scrollMode === "horizontal" ||
      (hasLeft && (left < scroller.scrollLeft || left > scroller.scrollLeft + scroller.clientWidth))
    ) {
      scroller.scrollLeft = left;
    }
    this.store.set({ currentPage: pageIndex });
    this.#update();
    return true;
  }

  /** Return to the position before the most recent link or outline jump. */
  back(): void {
    const entry = this.#history.pop();
    this.store.set({ canGoBack: this.#history.length > 0 });
    const current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!entry || !current || !scroller) return;
    const { pageIndex } = entry;
    const layout = this.#show(current, pageIndex);
    scroller.scrollTop =
      pageTop(layout, pageIndex, scroller.clientHeight) +
      entry.y * (layout.heights[pageIndex] ?? 0);
    scroller.scrollLeft =
      pageLeft(layout, pageIndex, scroller.clientWidth) + entry.x * (layout.widths[pageIndex] ?? 0);
    this.store.set({ currentPage: entry.current });
    this.#update();
  }

  /**
   * Save the viewport's top-left corner as a page and a share of it, which
   * survive zoom changes, and the current page.
   */
  #remember(): void {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    const { scrollLeft: x, scrollTop: y, clientWidth, clientHeight } = scroller;
    const pageIndex = pageAtPoint(layout, x, y, clientWidth);
    this.#history.push({
      pageIndex,
      x: (x - pageLeft(layout, pageIndex, clientWidth)) / (layout.widths[pageIndex] || 1),
      y: (y - pageTop(layout, pageIndex, clientHeight)) / (layout.heights[pageIndex] || 1),
      current: this.store.get().currentPage,
    });
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    this.store.set({ canGoBack: true });
  }

  #namedAction(action: string): void {
    const { pageCount } = this.store.get();
    switch (action) {
      case "NextPage":
        this.nextPage();
        break;
      case "PrevPage":
        this.previousPage();
        break;
      case "FirstPage":
        this.#remember();
        this.goToPage(0);
        break;
      case "LastPage":
        this.#remember();
        this.goToPage(pageCount - 1);
        break;
      case "GoBack":
        this.back();
        break;
    }
  }

  zoomBy(factor: number): void {
    this.#finishZoom();
    this.setScale(this.store.get().scale * factor);
  }

  /** Turn every page by `degrees`, a multiple of 90: clockwise when positive. */
  rotate(degrees = 90): void {
    this.setRotation((this.store.get().rotation + degrees) as Rotation);
  }

  /** Show every page turned clockwise by `rotation` degrees. */
  setRotation(rotation: Rotation): void {
    const turned = ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as Rotation;
    if (turned === this.store.get().rotation) return;
    this.#finishZoom();
    const state = this.store.get();
    const layout = state.layout;
    const scroller = this.#scroller;
    this.store.set({ rotation: turned });
    if (!layout || !scroller) return;
    // Keep the point at the viewport's center at the same share of its page.
    const anchor = { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 };
    const point = { x: scroller.scrollLeft + anchor.x, y: scroller.scrollTop + anchor.y };
    const next = this.#applyLayout(layout.scale);
    const target = zoomTarget(layout, next, sizeOf(scroller), anchor, point);
    scroller.scrollTop = target.top;
    scroller.scrollLeft = target.left;
    this.#scheduler?.rotate(turned);
    this.#update();
    // A turned page has another width to fit.
    this.#fit();
  }

  /**
   * Show pages one per row ("none"), or side by side in pairs: "odd" pairs
   * pages 1–2, 3–4, and "even" shows page 1 alone and pairs 2–3, 4–5, like a
   * book. The current page stays in view, from its top.
   */
  setSpread(spread: SpreadMode): void {
    if (spread === this.store.get().spread) return;
    this.#finishZoom();
    const page = this.store.get().currentPage;
    this.store.set({ spread });
    // A pair is wider than a page, a page alone narrower than a pair.
    this.#arrange(page);
  }

  /**
   * Arrange pages in a column ("vertical"), in one row scrolled sideways
   * ("horizontal"), in rows filling the viewport's width ("wrapped"), or one
   * page or spread at a time ("page"), whose keys and `goToPage()` flip
   * pages, as in pdf.js. The current page stays in view, from its top.
   */
  setScrollMode(scrollMode: ScrollMode): void {
    if (scrollMode === this.store.get().scrollMode) return;
    this.#finishZoom();
    const page = this.store.get().currentPage;
    this.store.set({ scrollMode });
    this.#arrange(page);
  }

  /**
   * Lay the pages out again after their arrangement changed, fitted again in
   * "fit-width" and "fit-page" mode, and go to page `page`.
   */
  #arrange(page: number): void {
    const state = this.store.get();
    const layout = state.layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    let scale = layout.scale;
    if (state.zoomMode !== "custom" && scroller.clientWidth > 0) {
      const fitted = this.#fitScale(page, state.zoomMode);
      if (fitted !== null) {
        scale = fitted;
        this.#fittedWidth = scroller.clientWidth;
        this.#fittedHeight = scroller.clientHeight;
      }
    }
    this.#applyLayout(scale, page);
    this.store.set({ scale });
    this.goToPage(page);
  }

  /**
   * Change the zoom level, keeping the point under `anchor` (viewport
   * coordinates, default center) in place. "fit-width" fits the width of the
   * current page and keeps fitting it as the viewport resizes or the view
   * turns, like pdf.js's "page-width"; "fit-page" fits all of that page and
   * shows it from its top, like "page-fit"; a number stops that.
   */
  setScale(requested: number | "fit-width" | "fit-page", anchor?: { x: number; y: number }): void {
    this.#finishZoom();
    if (requested === "fit-width" || requested === "fit-page") {
      this.store.set({ zoomMode: requested });
      this.#fit();
      return;
    }
    this.store.set({ zoomMode: "custom" });
    this.#zoomTo(requested, anchor);
  }

  /** Back to the zoom the viewer started with (`initialScale`), as Ctrl or ⌘ with 0 does. */
  resetScale(): void {
    this.setScale(this.#initialScale);
  }

  /** What a mouse drag does from now on: select text, or scroll with the hand tool. */
  setTool(tool: PointerTool): void {
    this.store.set({ tool });
    this.#scroller?.classList.toggle("parapdf-hand", tool === "hand");
    if (tool !== "hand") {
      this.#grab = null;
      this.#scroller?.classList.remove("parapdf-grabbing");
    }
  }

  /**
   * Fit the current page to the viewport: its width in "fit-width" mode, all
   * of it in "fit-page" mode, which also scrolls it to the viewport's top.
   * Nothing in "custom" mode.
   */
  #fit(): void {
    const scroller = this.#scroller;
    const state = this.store.get();
    const mode = state.zoomMode;
    if (mode === "custom" || !scroller || scroller.clientWidth === 0) return;
    const page = state.currentPage;
    const scale = this.#fitScale(page, mode);
    if (scale === null) return;
    this.#fittedWidth = scroller.clientWidth;
    this.#fittedHeight = scroller.clientHeight;
    this.#zoomTo(scale);
    if (mode === "fit-page") this.goToPage(page);
  }

  /**
   * The scale that fits the row of page `index`, the page or its spread, to
   * the viewport in `mode`; null while the pages' sizes are unknown. In a
   * spread mode, a page alone in its row, such as a cover, counts twice, as
   * in pdf.js: the zoom then stays the same from row to row. In "horizontal"
   * mode, where all pages share one row, the page alone fits.
   */
  #fitScale(index: number, mode: "fit-width" | "fit-page"): number | null {
    const { rotation, scrollMode } = this.store.get();
    // Pages that share one row side by side fit one by one, as in pdf.js.
    const spread = scrollMode === "horizontal" ? "none" : this.store.get().spread;
    const { first, last } = rowBounds(spread, index, this.#sizes.length);
    let width = 0;
    let height = 0;
    for (let page = first; page <= last; page++) {
      const size = this.#sizes[page];
      if (!size) return null;
      const turned = turnedSize(size, rotation);
      width += turned.width;
      height = Math.max(height, turned.height);
    }
    const pages = spread === "none" ? 1 : 2;
    if (last === first) width *= pages;
    if (width === 0 || height === 0) return null;
    const scroller = this.#scroller;
    // The gaps around the row and between its pages stay the same at every zoom.
    const room = (scroller?.clientWidth ?? 0) - (1 + pages) * this.#gap;
    const roomHeight = (scroller?.clientHeight ?? 0) - 2 * this.#gap;
    const scale = room / width;
    return clamp(
      mode === "fit-page" && roomHeight > 0 ? Math.min(scale, roomHeight / height) : scale,
      this.#minScale,
      this.#maxScale,
    );
  }

  /**
   * Zoom keeping the content point `point`, by default the one under
   * `anchor`, under `anchor`, as a share of the same page: pages are centered
   * in the viewport, so a share of the content's width moved points on
   * narrower pages sideways.
   */
  #zoomTo(
    requested: number,
    anchor?: { x: number; y: number },
    point?: { x: number; y: number },
  ): void {
    const state = this.store.get();
    const scale = clamp(requested, this.#minScale, this.#maxScale);
    const layout = state.layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) {
      this.store.set({ scale });
      return;
    }
    if (Math.abs(scale - state.scale) < 1e-4) return;
    const x = anchor?.x ?? scroller.clientWidth / 2;
    const y = anchor?.y ?? scroller.clientHeight / 2;
    const docPoint = point ?? { x: scroller.scrollLeft + x, y: scroller.scrollTop + y };
    const next = this.#applyLayout(scale);
    const target = zoomTarget(layout, next, sizeOf(scroller), { x, y }, docPoint);
    // The content is resized imperatively, so the scroll position can be
    // restored before React re-renders the mounted pages.
    scroller.scrollTop = target.top;
    scroller.scrollLeft = target.left;
    this.store.set({ scale });
    this.#update();
  }

  /**
   * Search the whole document. Results arrive progressively; the first match
   * at or after the current page is selected and scrolled into view. By
   * default case and diacritics are ignored and matches may be parts of words.
   */
  search(query: string, options: SearchOptions = {}): void {
    const generation = ++this.#searchGeneration;
    this.#highlights.clear();
    const normalized = normalizeQuery(query, options);
    const doc = this.#doc;
    if (!normalized || !doc) {
      this.store.set({ search: { ...IDLE_SEARCH, query, options } });
      return;
    }
    this.store.set({
      search: { query, options, status: "searching", matches: [], current: -1, pagesSearched: 0 },
    });
    this.#runSearch(doc, query, normalized, options, generation).catch((error: unknown) => {
      if (generation !== this.#searchGeneration) return;
      console.error("search failed", error);
      this.store.set({ search: { ...this.store.get().search, status: "done" } });
    });
  }

  nextMatch(): void {
    const { matches, current } = this.store.get().search;
    if (matches.length > 0) this.#selectMatch((current + 1) % matches.length);
  }

  previousMatch(): void {
    const { matches, current } = this.store.get().search;
    if (matches.length > 0) this.#selectMatch((current - 1 + matches.length) % matches.length);
  }

  clearSearch(): void {
    this.#searchGeneration++;
    this.#highlights.clear();
    this.store.set({ search: IDLE_SEARCH });
  }

  async #runSearch(
    doc: PdfEngineDocument,
    query: string,
    normalized: string,
    options: SearchOptions,
    generation: number,
  ): Promise<void> {
    const matches: SearchMatch[] = [];
    const startPage = this.store.get().currentPage;
    let current = -1;
    let pagesSearched = 0;
    let publishedAt = performance.now();
    const publish = (status: SearchState["status"]) => {
      this.store.set({
        search: { query, options, status, matches: [...matches], current, pagesSearched },
      });
      this.#refreshHighlights();
    };
    for (let page = 0; page < doc.pageCount; page++) {
      const index = await this.#pageIndex(doc, page, options);
      if (generation !== this.#searchGeneration) return;
      const found = findMatches(index, normalized, page, undefined, options);
      const select = current === -1 && page >= startPage && found.length > 0;
      if (select) current = matches.length;
      matches.push(...found);
      pagesSearched = page + 1;
      const now = performance.now();
      if (select || now - publishedAt > SEARCH_PUBLISH_INTERVAL) {
        publish("searching");
        const match = matches[current];
        if (select && match) this.#background(this.#scrollToMatch(match), "scrolling to a match");
        publishedAt = now;
        await yieldToMain();
        if (generation !== this.#searchGeneration) return;
      }
    }
    if (current === -1 && matches.length > 0) {
      current = 0;
      const match = matches[0];
      if (match) this.#background(this.#scrollToMatch(match), "scrolling to a match");
    }
    publish("done");
  }

  #pageIndex(
    doc: PdfEngineDocument,
    pageIndex: number,
    options: SearchOptions,
  ): Promise<PageIndex> {
    const key = `${Boolean(options.caseSensitive)} ${Boolean(options.matchDiacritics)}`;
    let indexes = this.#indexes.get(key);
    if (!indexes) {
      indexes = new Map();
      this.#indexes.set(key, indexes);
    }
    let index = indexes.get(pageIndex);
    if (!index) {
      index = doc.getText(pageIndex).then((text) => buildPageIndex(text, options));
      indexes.set(pageIndex, index);
    }
    return index;
  }

  #selectMatch(index: number): void {
    const search = this.store.get().search;
    const match = search.matches[index];
    if (!match) return;
    this.store.set({ search: { ...search, current: index } });
    this.#refreshHighlights();
    this.#background(this.#scrollToMatch(match), "scrolling to a match");
  }

  /**
   * Scroll so a match sits in the upper third of the viewport, and, in
   * "horizontal" mode, in its left third. "page" mode shows its page.
   */
  async #scrollToMatch(match: SearchMatch): Promise<void> {
    const doc = this.#doc;
    if (!doc) return;
    const text = await doc.getText(match.pageIndex);
    const current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller || this.#doc !== doc) return;
    const layout = this.#show(current, match.pageIndex);
    const at = match.start.item * 4;
    const size = layout.sizes[match.pageIndex] ?? { width: 0, height: 0 };
    const box = turnBox(
      {
        x: text.boxes[at] ?? 0,
        y: text.boxes[at + 1] ?? 0,
        width: text.boxes[at + 2] ?? 0,
        height: text.boxes[at + 3] ?? 0,
      },
      size,
      layout.rotation,
    );
    const top = pageTop(layout, match.pageIndex, scroller.clientHeight) + box.y * layout.scale;
    const left = pageLeft(layout, match.pageIndex, scroller.clientWidth) + box.x * layout.scale;
    scroller.scrollTop = top - scroller.clientHeight / 3;
    if (
      layout.scrollMode === "horizontal" ||
      left < scroller.scrollLeft ||
      left > scroller.scrollLeft + scroller.clientWidth
    ) {
      scroller.scrollLeft = left - scroller.clientWidth / 3;
    }
    this.store.set({ currentPage: match.pageIndex });
    this.#update();
  }

  #refreshHighlights(): void {
    for (const pageIndex of this.#textPages.keys()) this.#highlightPage(pageIndex);
  }

  #highlightPage(pageIndex: number): void {
    const handle = this.#textPages.get(pageIndex);
    const { matches, current } = this.store.get().search;
    if (!handle || matches.length === 0) {
      this.#highlights.clearPage(pageIndex);
      return;
    }
    const pageMatches = matches.filter((match) => match.pageIndex === pageIndex);
    this.#highlights.setPage(pageIndex, handle.elements, pageMatches, matches[current] ?? null);
  }

  #initialZoomMode(): ZoomMode {
    return typeof this.#initialScale === "number" ? "custom" : this.#initialScale;
  }

  #resolveInitialScale(): number {
    if (typeof this.#initialScale === "number") return this.#initialScale;
    const scroller = this.#scroller;
    if (!scroller || scroller.clientWidth === 0) return 1;
    const scale = this.#fitScale(
      clamp(this.#initialPage, 0, this.#sizes.length - 1),
      this.#initialScale,
    );
    if (scale === null) return 1;
    this.#fittedWidth = scroller.clientWidth;
    this.#fittedHeight = scroller.clientHeight;
    return scale;
  }

  /** Lay the pages out at `scale`; in "page" mode, showing the row of page `page`. */
  #applyLayout(scale: number, page?: number): Layout {
    const layout = computeLayout(this.#sizes, scale, this.#layoutOptions(page));
    this.#sizeContent(layout);
    this.store.set({ layout });
    return layout;
  }

  /**
   * How pages are laid out now: "wrapped" rows fill the scroller's width, and
   * "page" mode shows the row of page `page`, by default the row it shows.
   */
  #layoutOptions(page?: number): LayoutOptions {
    const { rotation, spread, scrollMode, layout, currentPage } = this.store.get();
    return {
      gap: this.#gap,
      rotation,
      spread,
      scrollMode,
      viewportWidth: this.#scroller?.clientWidth ?? 0,
      page: page ?? layout?.shown?.first ?? currentPage,
    };
  }

  #sizeContent(layout: Layout): void {
    if (!this.#content) return;
    // A row centered in the viewport's height needs content at least as tall.
    const centered = layout.scrollMode === "horizontal" || layout.scrollMode === "page";
    this.#content.style.height = centered
      ? `max(100cqh, ${layout.totalHeight}px)`
      : `${layout.totalHeight}px`;
    this.#content.style.width = `max(100%, ${layout.totalWidth}px)`;
    // The hidden rows of "page" mode, wider or taller than the row shown,
    // would otherwise widen the scrollable range.
    this.#content.style.overflow = layout.shown ? "clip" : "";
  }

  /**
   * Background work may outlive its document: it then fails quietly. While the
   * document that started it is still open, a failure is logged.
   */
  #background(work: Promise<unknown>, what: string, generation = this.#generation): void {
    work.catch((error: unknown) => {
      if (this.#generation === generation) console.error(`${what} failed`, error);
    });
  }

  /** Learn the real size of every page in the background, then relayout once. */
  async #refineSizes(doc: PdfEngineDocument, generation: number): Promise<void> {
    const sizes = [...this.#sizes];
    let changed = false;
    for (let index = 1; index < doc.pageCount; index += 64) {
      const batch = Array.from({ length: Math.min(64, doc.pageCount - index) }, (_, offset) =>
        doc.pageSize(index + offset),
      );
      const results = await Promise.all(batch);
      if (this.#generation !== generation) return;
      results.forEach((size, offset) => {
        const current = sizes[index + offset];
        if (!current || current.width !== size.width || current.height !== size.height) {
          sizes[index + offset] = size;
          changed = true;
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!changed || this.#generation !== generation) return;
    this.#finishZoom();
    const scroller = this.#scroller;
    const layout = this.store.get().layout;
    this.#sizes = sizes;
    const next = this.#applyLayout(this.store.get().scale);
    if (scroller && layout) {
      // Keep the point at the viewport's top-left corner where it is.
      const point = { x: scroller.scrollLeft, y: scroller.scrollTop };
      const target = zoomTarget(layout, next, sizeOf(scroller), { x: 0, y: 0 }, point);
      scroller.scrollTop = target.top;
      scroller.scrollLeft = target.left;
    }
    this.#update();
    // The page at the center may turn out wider or narrower than the first.
    this.#fit();
  }

  #onResize = (): void => {
    const scroller = this.#scroller;
    const mode = this.store.get().zoomMode;
    if (
      scroller &&
      ((mode === "fit-width" && scroller.clientWidth !== this.#fittedWidth) ||
        (mode === "fit-page" &&
          (scroller.clientWidth !== this.#fittedWidth ||
            scroller.clientHeight !== this.#fittedHeight)))
    ) {
      this.#finishZoom();
      this.#fit();
    }
    this.#rewrap();
    this.#requestUpdate();
  };

  /**
   * In "wrapped" mode, fill the rows again to the viewport's new width once
   * that moves a page to another row, keeping the point at the viewport's
   * center at the same share of its page. Rows are centered in CSS, so a
   * resize that keeps them needs no new layout.
   */
  #rewrap(): void {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller || layout.scrollMode !== "wrapped") return;
    if (sameRows(layout, computeLayout(this.#sizes, layout.scale, this.#layoutOptions()))) return;
    this.#finishZoom();
    const current = this.store.get().layout ?? layout;
    const anchor = { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 };
    const point = { x: scroller.scrollLeft + anchor.x, y: scroller.scrollTop + anchor.y };
    const next = this.#applyLayout(current.scale);
    const target = zoomTarget(current, next, sizeOf(scroller), anchor, point);
    scroller.scrollTop = target.top;
    scroller.scrollLeft = target.left;
    this.#update();
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey) return;
    if (event.ctrlKey || event.metaKey) this.#zoomKey(event);
    else if (this.store.get().scrollMode === "page") this.#pageKey(event);
  };

  /**
   * In "page" mode, keys that would scroll past an edge of the page shown
   * flip to the next or previous one and show it from the edge they crossed:
   * PageDown, Space, and ↓ at its bottom, → at its right edge, and PageUp,
   * Shift+Space, ↑, and ← back the other way. Home and End go to the first
   * and last page. Keys meant for a form field or a button stay theirs.
   */
  #pageKey(event: KeyboardEvent): void {
    const scroller = this.#scroller;
    const target = event.target instanceof Element ? event.target : null;
    if (!scroller || target?.closest("input, select, textarea, button, [contenteditable]")) return;
    // Within a pixel: zooming leaves fractional scroll positions.
    const atTop = scroller.scrollTop <= 1;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const atLeft = scroller.scrollLeft <= 1;
    const atRight = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    let flipped = false;
    switch (event.key) {
      case "PageDown":
      case "ArrowDown":
        flipped = atBottom && this.#flip(1, "y");
        break;
      case "PageUp":
      case "ArrowUp":
        flipped = atTop && this.#flip(-1, "y");
        break;
      case " ":
        flipped = event.shiftKey ? atTop && this.#flip(-1, "y") : atBottom && this.#flip(1, "y");
        break;
      case "ArrowRight":
        flipped = atRight && this.#flip(1, "x");
        break;
      case "ArrowLeft":
        flipped = atLeft && this.#flip(-1, "x");
        break;
      case "Home":
        this.goToPage(0);
        flipped = true;
        break;
      case "End":
        this.goToPage(this.store.get().pageCount - 1);
        flipped = true;
        break;
    }
    if (flipped) event.preventDefault();
  }

  /**
   * Ctrl or ⌘ with +, -, or 0 zooms the document instead of the page while
   * focus is in the viewport, as in pdf.js's viewer.
   */
  #zoomKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "+":
      case "=":
        this.zoomBy(ZOOM_STEP);
        break;
      case "-":
      case "_":
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case "0":
        this.resetScale();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * The hand tool scrolls with a mouse or pen drag. Links, form fields, and
   * other controls keep their own behavior; touches pan natively.
   */
  #onGrabStart = (event: PointerEvent): void => {
    if (this.store.get().tool !== "hand" || event.pointerType === "touch" || event.button !== 0) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest("a, button, input, select, textarea, [contenteditable]")) return;
    // Keeps the drag from selecting text or dragging images, and the press
    // from focusing the viewport, which keys then would not scroll.
    event.preventDefault();
    const scroller = this.#scroller;
    if (!scroller) return;
    scroller.focus({ preventScroll: true });
    this.#grab = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add("parapdf-grabbing");
  };

  #onGrabMove = (event: PointerEvent): void => {
    const grab = this.#grab;
    const scroller = this.#scroller;
    if (!grab || !scroller || grab.pointerId !== event.pointerId) return;
    scroller.scrollLeft -= event.clientX - grab.x;
    scroller.scrollTop -= event.clientY - grab.y;
    grab.x = event.clientX;
    grab.y = event.clientY;
  };

  #onGrabEnd = (event: PointerEvent): void => {
    if (this.#grab?.pointerId !== event.pointerId) return;
    this.#grab = null;
    this.#scroller?.classList.remove("parapdf-grabbing");
  };

  #onScroll = (): void => {
    const scroller = this.#scroller;
    if (!scroller) return;
    move(
      this.#scrolling,
      positionOf(this.store.get().scrollMode, viewportOf(scroller)),
      performance.now(),
    );
    this.#requestUpdate();
  };

  #onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const zoom =
      this.#zoom?.source === "wheel"
        ? this.#zoom
        : this.#startZoom("wheel", event.clientX, event.clientY);
    if (!zoom) return;
    zoom.factor = this.#zoomFactor(zoom.factor * Math.exp(-event.deltaY * 0.01));
    this.#previewZoom(zoom);
    clearTimeout(zoom.timer);
    zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
  };

  /**
   * Touches pinch through pointer events. The viewport's `touch-action:
   * pan-x pan-y` keeps the browser from zooming the page instead; Chromium
   * then does not scroll with two fingers either, so it does not cancel
   * their pointers, and a two-finger drag pans through the pinch.
   */
  #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    this.#touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.#touchListeners) {
      // On the window, so that a finger is followed after it leaves the
      // viewport or the element it went down on is removed.
      this.#touchListeners = new AbortController();
      const options = { capture: true, passive: true, signal: this.#touchListeners.signal };
      window.addEventListener("pointermove", this.#onTouchMove, options);
      window.addEventListener("pointerup", this.#onTouchEnd, options);
      window.addEventListener("pointercancel", this.#onTouchEnd, options);
    }
    if (!this.#pinch && this.#touches.size >= 2) this.#startPinch();
  };

  #onTouchMove = (event: PointerEvent): void => {
    const touch = this.#touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
    const pinch = this.#pinch;
    if (!pinch?.ids.includes(event.pointerId)) return;
    if (this.#zoom !== pinch.zoom) {
      // Something else committed the preview, a resize for one: pinch on from here.
      this.#startPinch();
      return;
    }
    const a = this.#touches.get(pinch.ids[0]);
    const b = this.#touches.get(pinch.ids[1]);
    if (!a || !b) return;
    const zoom = pinch.zoom;
    zoom.panX = (a.x + b.x) / 2 - pinch.startX;
    zoom.panY = (a.y + b.y) / 2 - pinch.startY;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (
      pinch.baseDistance === 0 &&
      distance > 0 &&
      Math.abs(distance - pinch.startDistance) >= PINCH_SLOP
    ) {
      pinch.baseDistance = distance;
    }
    if (pinch.baseDistance > 0) zoom.factor = this.#zoomFactor(distance / pinch.baseDistance);
    this.#previewZoom(zoom);
  };

  #onTouchEnd = (event: PointerEvent): void => {
    if (!this.#touches.delete(event.pointerId)) return;
    if (this.#touches.size === 0) {
      this.#touchListeners?.abort();
      this.#touchListeners = null;
    }
    const pinch = this.#pinch;
    if (!pinch?.ids.includes(event.pointerId)) return;
    this.#pinch = null;
    const zoom = pinch.zoom;
    if (this.#zoom === zoom) {
      if (event.type === "pointercancel" && this.#gestureScale !== null) {
        // Safari took the touches over, for a pan of its own perhaps, and
        // still reports the pinch through gesture events: they finish it.
        zoom.source = "gesture";
        this.#gestureBase = this.#gestureScale / zoom.factor;
        zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
      } else {
        this.#commitZoom();
      }
    }
    // Two fingers still down go on pinching.
    if (this.#touches.size >= 2) this.#startPinch();
  };

  /** Start pinching with the first two touches down on the viewport. */
  #startPinch(): void {
    this.#pinch = null;
    const [first, second] = this.#touches;
    if (!first || !second) return;
    const [[firstId, a], [secondId, b]] = [first, second];
    const startX = (a.x + b.x) / 2;
    const startY = (a.y + b.y) / 2;
    const zoom = this.#startZoom("touch", startX, startY);
    if (!zoom) return;
    this.#pinch = {
      ids: [firstId, secondId],
      zoom,
      startX,
      startY,
      startDistance: Math.hypot(b.x - a.x, b.y - a.y),
      baseDistance: 0,
    };
  }

  /**
   * Safari's gesture events: trackpad pinches on macOS, where they are the
   * only report of the pinch, and touch pinches on iPadOS, which pointer
   * events report too. Preventing them is what stops Safari's page zoom.
   */
  #onGesture = (event: Event): void => {
    event.preventDefault();
    const { type, scale, clientX, clientY } = event as SafariGestureEvent;
    if (type === "gestureend") this.#gestureScale = null;
    else if (scale > 0) this.#gestureScale = scale;
    if (this.#pinch || !(scale > 0)) return;
    let zoom = this.#zoom;
    if (zoom?.source !== "gesture") {
      const scroller = this.#scroller;
      if (type === "gestureend" || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      zoom = this.#startZoom(
        "gesture",
        clientX ?? rect.left + rect.width / 2,
        clientY ?? rect.top + rect.height / 2,
      );
      if (!zoom) return;
      this.#gestureBase = scale;
    }
    zoom.factor = this.#zoomFactor(scale / this.#gestureBase);
    this.#previewZoom(zoom);
    clearTimeout(zoom.timer);
    if (type === "gestureend") this.#commitZoom();
    else zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
  };

  /**
   * Start previewing a zoom gesture around a point in client coordinates.
   * Another gesture still in progress commits first.
   */
  #startZoom(source: ZoomGesture["source"], clientX: number, clientY: number): ZoomGesture | null {
    if (this.#zoom) this.#commitZoom();
    const scroller = this.#scroller;
    if (!scroller || !this.#content || !this.store.get().layout) return null;
    const rect = scroller.getBoundingClientRect();
    this.#zoom = {
      source,
      factor: 1,
      originX: scroller.scrollLeft + clientX - rect.left - scroller.clientLeft,
      originY: scroller.scrollTop + clientY - rect.top - scroller.clientTop,
      panX: 0,
      panY: 0,
      shiftX: 0,
      shiftY: 0,
      motion: {
        position: positionOf(this.store.get().scrollMode, viewportOf(scroller)),
        at: performance.now(),
        velocity: 0,
      },
      timer: 0,
    };
    return this.#zoom;
  }

  /** A gesture's zoom factor, kept within the scale limits. */
  #zoomFactor(factor: number): number {
    const scale = this.store.get().scale;
    return clamp(factor, this.#minScale / scale, this.#maxScale / scale);
  }

  /**
   * Preview a gesture on the compositor; layout waits for the commit, but the
   * pages the preview brings into view mount and draw at the committed zoom
   * before it (see #shownViewport). The preview shows the content where the
   * commit will put it: the gesture's point stays under it unless that would
   * scroll past the start or end of the document, or a page the zoom narrows
   * below the viewport's width is centered again. Previewing the
   * unconstrained place made the content jump when the gesture committed, by
   * 334 CSS pixels on an iPad pinching in near the document's start.
   */
  #previewZoom(zoom: ZoomGesture): void {
    const content = this.#content;
    const scroller = this.#scroller;
    const layout = this.store.get().layout;
    if (!content || !scroller || !layout) return;
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    // The scroll position the commit asks for, and the one it gets.
    let next = layout;
    let target = { left: left - zoom.panX, top: top - zoom.panY };
    const scale = layout.scale * zoom.factor;
    if (Math.abs(scale - layout.scale) >= 1e-4) {
      next = computeLayout(this.#sizes, scale, this.#layoutOptions());
      target = zoomTarget(
        layout,
        next,
        sizeOf(scroller),
        { x: zoom.originX + zoom.panX - left, y: zoom.originY + zoom.panY - top },
        { x: zoom.originX, y: zoom.originY },
      );
    }
    const maxLeft = Math.max(0, next.totalWidth - scroller.clientWidth);
    const maxTop = Math.max(0, next.totalHeight - scroller.clientHeight);
    zoom.shiftX = target.left - clamp(target.left, 0, maxLeft);
    zoom.shiftY = target.top - clamp(target.top, 0, maxTop);
    content.style.transformOrigin = `${zoom.originX}px ${zoom.originY}px`;
    content.style.transform = `translate(${zoom.panX + zoom.shiftX}px, ${zoom.panY + zoom.shiftY}px) scale(${zoom.factor})`;
    this.#requestUpdate();
  }

  /** Whether a gesture in progress previews another zoom, not just a pan. */
  #zooming(): boolean {
    const zoom = this.#zoom;
    const scale = this.store.get().scale;
    return zoom !== null && Math.abs(scale * zoom.factor - scale) >= 1e-4;
  }

  /**
   * The part of the content the viewport shows, in the content's CSS pixels.
   * A gesture's preview shows another part than the scroll position: its
   * transform draws the content point p at origin + (p - origin) * factor +
   * pan + shift, so the viewport maps back through the inverse. The mounted
   * window and the scheduler follow it, so the pages a long two-finger drag
   * or a zoom out brings into view mount and draw before the gesture commits.
   */
  #shownViewport(scroller: HTMLElement): Viewport {
    const viewport = viewportOf(scroller);
    const zoom = this.#zoom;
    if (!zoom) return viewport;
    const { originX, originY, factor } = zoom;
    return {
      left: originX + (viewport.left - zoom.panX - zoom.shiftX - originX) / factor,
      top: originY + (viewport.top - zoom.panY - zoom.shiftY - originY) / factor,
      width: viewport.width / factor,
      height: viewport.height / factor,
      scrollerWidth: viewport.scrollerWidth,
      scrollerHeight: viewport.scrollerHeight,
    };
  }

  #commitZoom = (): void => {
    const zoom = this.#zoom;
    this.#zoom = null;
    if (!zoom) return;
    clearTimeout(zoom.timer);
    const scroller = this.#scroller;
    const content = this.#content;
    if (!scroller || !content) return;
    // Where the gesture's point shows, read while the preview still scales
    // the content: the viewport may have scrolled past the unscaled end.
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    content.style.transform = "";
    const scale = this.store.get().scale;
    if (Math.abs(scale * zoom.factor - scale) < 1e-4) {
      // A two-finger drag that never pinched only scrolls.
      scroller.scrollLeft = left - zoom.panX;
      scroller.scrollTop = top - zoom.panY;
      return;
    }
    this.store.set({ zoomMode: "custom" });
    this.#zoomTo(
      scale * zoom.factor,
      { x: zoom.originX + zoom.panX - left, y: zoom.originY + zoom.panY - top },
      { x: zoom.originX, y: zoom.originY },
    );
  };

  /** Commit a gesture in progress before something else changes the layout under its preview. */
  #finishZoom(): void {
    if (this.#zoom) this.#commitZoom();
  }

  /** Forget a gesture without committing it: its viewport goes away. */
  #dropZoom(): void {
    if (this.#zoom) clearTimeout(this.#zoom.timer);
    this.#zoom = null;
    this.#pinch = null;
    this.#touches.clear();
    this.#touchListeners?.abort();
    this.#touchListeners = null;
    this.#gestureScale = null;
    if (this.#content) this.#content.style.transform = "";
  }

  #requestUpdate(): void {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#update);
  }

  #update = (): void => {
    this.#frame = 0;
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    const viewport = this.#shownViewport(scroller);
    const zoom = this.#zoom;
    // A preview's drag moves the shown content without scrolling. It is
    // measured once a frame, as scrolling is: the moves of a drag's two
    // fingers come microseconds apart, and measuring each would make a slow
    // drag look like a fling.
    const position = positionOf(layout.scrollMode, viewport);
    if (zoom && position !== zoom.motion.position) {
      move(zoom.motion, position, performance.now());
    }
    const { first, last } = visibleRange(layout, viewport);
    const lastIndex = layout.tops.length - 1;
    // Overscan pages beyond each edge, rounded out to whole rows where rows
    // stack or flip: "page" mode mounts the rows beside the one it shows,
    // hidden, so that they draw before a flip shows them.
    let mountedFirst = Math.max(0, first - this.#overscan);
    let mountedLast = Math.min(lastIndex, last + this.#overscan);
    if (layout.scrollMode !== "horizontal" && mountedLast >= mountedFirst) {
      mountedFirst = rowStart(layout, mountedFirst);
      mountedLast = rowEnd(layout, mountedLast);
    }
    const focus = pageAtPoint(
      layout,
      viewport.left + viewport.width / 2,
      viewport.top + viewport.height / 2,
      viewport.scrollerWidth,
    );
    // The current page stays current while all of it is in view: at the start
    // of a row of pages narrower than half the viewport, the page at the
    // center is the second or third.
    const { currentPage } = this.store.get();
    const kept =
      currentPage >= first &&
      currentPage <= last &&
      whole(visibleArea(layout, currentPage, viewport));
    // Publishing is cheap when nothing changed: the store ignores equal values.
    this.store.set({
      first: mountedFirst,
      last: mountedLast,
      currentPage: kept ? currentPage : focus,
    });
    const motion = zoom?.motion ?? this.#scrolling;
    const quiet = performance.now() - motion.at > SETTLE_DELAY;
    // A zoom preview's commit draws the pages again at its zoom: until then
    // the preview counts as fast scrolling.
    const settled = (quiet || Math.abs(motion.velocity) < SETTLE_VELOCITY) && !this.#zooming();
    this.#scheduler?.update({
      layout,
      first,
      last,
      focus,
      viewport,
      devicePixelRatio: window.devicePixelRatio || 1,
      settled,
    });
    if (!quiet && !this.#settleTimer) {
      this.#settleTimer = window.setTimeout(() => {
        this.#settleTimer = 0;
        this.#requestUpdate();
      }, SETTLE_DELAY);
    }
  };
}
