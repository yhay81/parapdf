import type {
  AnnotationEditingState,
  AnnotationEditor,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
  DestinationRef,
  FormChange,
  FormField,
  FormValue,
  LayerState,
  LinkHandlers,
  OutlineNode,
  PageColors,
  PageSize,
  PageText,
  PasswordReason,
  PdfAttachment,
  PdfEngine,
  PdfEngineDocument,
  PdfInitialView,
  PdfLayer,
  PdfMetadata,
  PdfPageLayout,
  PdfPermissions,
  PdfSource,
  ResolvedDestination,
  Rotation,
  SavedAnnotation,
  SignatureInput,
  TextLayerHandle,
} from "../engine/types.ts";
import {
  type DocumentText,
  PAGE_SEPARATOR,
  type PageTextContent,
  pageText,
  type TextOptions,
  type TextPoint,
} from "./document-text.ts";
import { acquireDocument, type DocumentLease } from "./documents.ts";
import { downloadBytes, filenameFromUrl } from "./files.ts";
import { CONTROLS, ViewerGestures } from "./gestures.ts";
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
  visibleArea,
  visibleRange,
  zoomTarget,
} from "./layout.ts";
import { type PrintOptions, printDocument } from "./print.ts";
import { RenderScheduler, type SchedulerStats } from "./scheduler.ts";
import {
  type Edges,
  type Motion,
  move,
  positionOf,
  SETTLE_DELAY,
  SETTLE_VELOCITY,
  scrollEdges,
  sizeOf,
  viewportOf,
} from "./scrolling.ts";
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
  /** Whether `forward()` can return to a position `back()` left. */
  canGoForward: boolean;
  /**
   * What the document permits, everything when it is not encrypted; null
   * until it loads. With `enforcePermissions`, the viewer follows it.
   */
  permissions: PdfPermissions | null;
  /**
   * How the document asks to be shown when it opens: where, how its pages
   * are arranged, and which panel shows beside them (`pageMode`), which the
   * application may open; null until it loads.
   */
  documentView: PdfInitialView | null;
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
  /** What a pointer does on the pages when `annotationEditing` is on; see `setAnnotationTool()`. */
  annotationTool: AnnotationTool;
  /** Undo, redo, and the selection of the annotations edited; null while editing is off. */
  annotationState: AnnotationEditingState | null;
  /** The style of each tool; null while editing is off. */
  annotationStyles: AnnotationStyles | null;
}

export type ZoomMode = "fit-width" | "fit-page" | "custom";

/**
 * Where and how a viewer shows its document, to keep and show again: a
 * plain, JSON-compatible object (see `getViewState()`).
 */
export interface ViewState {
  /** The zero-based page at the viewport's top-left corner. */
  page: number;
  /**
   * The point of that page at the viewport's top-left corner, in PDF points
   * from the page's top-left corner, unturned by the view: negative in the
   * space before the page.
   */
  x: number;
  y: number;
  /** CSS pixels per PDF point, or the fit that keeps the zoom. */
  scale: number | "fit-width" | "fit-page";
  rotation: Rotation;
  spread: SpreadMode;
  scrollMode: ScrollMode;
}

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
  /**
   * Where the selection starts and ends in the document's text, for
   * `getText()`: null for an end outside the pages' text layers.
   */
  start: TextPoint | null;
  end: TextPoint | null;
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
  /**
   * The view to open with, kept from `getViewState()`, such as the reader's
   * last position or one shared in a URL. Its fields win over `initialPage`,
   * `initialScale`, `spread`, `scrollMode`, and `initialView`; those it
   * leaves out still apply.
   */
  initialViewState?: Partial<ViewState>;
  /**
   * "document" opens the document as it asks to be opened: at its
   * /OpenAction destination, with its zoom, and with its pages arranged
   * as its /PageLayout says, in spreads or one page at a time. Options the
   * application sets (`initialPage`, `initialScale`, `spread`,
   * `scrollMode`) win. The default, "options", follows the options alone.
   */
  initialView?: "options" | "document";
  /**
   * Whether links and the outline take the zoom their destination asks for
   * (default true), as in pdf.js: a factor, the page's width or height, the
   * whole page, or a rectangle that fills the viewport. With false, they
   * keep the zoom and only scroll.
   */
  destinationZoom?: boolean;
  /**
   * Follow what the document permits (default false, as in pdf.js): without
   * permission to copy, its text cannot be selected or copied, though it
   * stays readable by assistive technology and `getText()`; without
   * permission to print, `print()` fails; without permission to annotate,
   * annotations cannot be created, and form fields can be filled in only
   * with permission to fill forms. `permissions` tells the application.
   */
  enforcePermissions?: boolean;
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
   * `onFormChange()` hears what the reader enters.
   */
  forms?: boolean;
  /**
   * Whether an encrypted document waits for `submitPassword()` (status
   * "password", the default) or fails at once (status "error") when its
   * source has no password or a wrong one, for applications that show no
   * password prompt.
   */
  passwordPrompt?: boolean;
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
  /**
   * The most pixels kept of the canvases of pages that leave the mounted
   * window, so that a page the reader comes back to, by a link's back, by
   * scrolling back, or by flipping back, shows at once instead of being
   * drawn again (default six viewports' worth of device pixels; 0 keeps
   * none). Within `maxCanvasPixels`, they count as canvases and go first.
   */
  maxKeptPixels?: number;
  /**
   * Let the reader create highlights, text, drawings, images, and
   * signatures on the pages (default false); see `setAnnotationTool()`.
   * `save()` writes them into the document, and `exportAnnotations()`
   * gives them to the application to keep. The viewer then opens its own
   * copy of the document instead of sharing one.
   */
  annotationEditing?: boolean;
  /** The accessible names of the editor's controls, by default in English. */
  annotationLabels?: Partial<AnnotationLabels>;
}

/** The editor's controls and annotations as pdf.js's English strings name them. */
const ANNOTATION_LABELS: AnnotationLabels = {
  highlight: "Highlight editor",
  freeText: "Text Editor",
  freeTextPlaceholder: "Start typing…",
  ink: "Drawing editor",
  stamp: "Image editor",
  signature: "Signature editor",
  removeHighlight: "Remove highlight",
  removeFreeText: "Remove text",
  removeInk: "Remove drawing",
  removeStamp: "Remove image",
  removeSignature: "Remove signature",
  color: "Change color",
  colors: "Color choices",
  textColor: "Change text color",
  inkColor: "Change drawing color",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  red: "Red",
  resizeTopLeft: "Top left corner — resize",
  resizeTopMiddle: "Top middle — resize",
  resizeTopRight: "Top right corner — resize",
  resizeMiddleRight: "Middle right — resize",
  resizeBottomRight: "Bottom right corner — resize",
  resizeBottomMiddle: "Bottom middle — resize",
  resizeBottomLeft: "Bottom left corner — resize",
  resizeMiddleLeft: "Middle left — resize",
};

/** Jumps kept for `back()`. */
const HISTORY_LIMIT = 50;

/**
 * A position kept for `back()` and `forward()`: the page at the viewport's
 * top-left corner, where that corner is as a share of the page, the current
 * page, and the zoom, which a destination may change.
 */
interface Position {
  pageIndex: number;
  x: number;
  y: number;
  current: number;
  scale: number;
  zoomMode: ZoomMode;
}

const SPREADS = new Set<string>(["none", "odd", "even"]);
const SCROLL_MODES = new Set<string>(["vertical", "horizontal", "wrapped", "page"]);

/** How pdf.js's viewer arranges pages for each /PageLayout. */
const PAGE_LAYOUTS: Record<PdfPageLayout, { spread: SpreadMode; scrollMode: ScrollMode }> = {
  SinglePage: { spread: "none", scrollMode: "page" },
  OneColumn: { spread: "none", scrollMode: "vertical" },
  TwoColumnLeft: { spread: "odd", scrollMode: "vertical" },
  TwoColumnRight: { spread: "even", scrollMode: "vertical" },
  TwoPageLeft: { spread: "odd", scrollMode: "page" },
  TwoPageRight: { spread: "even", scrollMode: "page" },
};

/** What Ctrl or ⌘ with + and - zooms by. */
const ZOOM_STEP = 1.25;
/** Pages `getText()` asks the engine for ahead of the one it reads. */
const TEXT_READ_AHEAD = 4;
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
 * The place in the document's text of a range boundary (`node`, `offset`)
 * in a text layer whose runs are `elements`, one per item of the page's text;
 * null outside the runs. A boundary between runs is the start of the next
 * one, or the end of the last.
 */
function textPointOf(
  pageIndex: number,
  elements: readonly HTMLElement[],
  node: Node,
  offset: number,
): TextPoint | null {
  const items = new Map<Node, number>(elements.map((element, item) => [element, item]));
  for (let at: Node | null = node; at; at = at.parentNode) {
    const item = items.get(at);
    if (item === undefined) continue;
    // Inside a run: count the text before the boundary.
    const range = document.createRange();
    range.selectNodeContents(at);
    range.setEnd(node, offset);
    return { pageIndex, item, offset: range.toString().length };
  }
  // Between runs, in the layer or a marked-content span that holds them.
  const point = document.createRange();
  point.setStart(node, offset);
  for (const [item, element] of elements.entries()) {
    const run = document.createRange();
    run.selectNode(element);
    if (point.compareBoundaryPoints(Range.START_TO_START, run) <= 0) {
      return { pageIndex, item, offset: 0 };
    }
  }
  const last = elements.length - 1;
  if (last < 0) return null;
  return { pageIndex, item: last, offset: elements[last]?.textContent?.length ?? 0 };
}

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
  HTMLCanvasElement | null,
  HTMLElement | null,
];

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
    canGoForward: false,
    permissions: null,
    documentView: null,
    rotation: 0,
    spread: "none",
    scrollMode: "vertical",
    document: null,
    pageLabels: null,
    metadata: null,
    attachments: null,
    layers: null,
    annotationTool: "none",
    annotationState: null,
    annotationStyles: null,
  });
  readonly #engine: PdfEngine;
  readonly #gap: number;
  readonly #overscan: number;
  readonly #maxConcurrentRenders: number;
  readonly #initialScale: number | "fit-width" | "fit-page";
  readonly #initialPage: number;
  /** The options the application set, which the document's initial view does not override. */
  readonly #explicit: Pick<ViewerOptions, "initialPage" | "initialScale" | "spread" | "scrollMode">;
  readonly #documentView: boolean;
  readonly #initialViewState: Partial<ViewState> | null;
  readonly #destinationZoom: boolean;
  readonly #enforcePermissions: boolean;
  /** What the open document permits, once known. */
  #permissions: PdfPermissions | null = null;
  readonly #formListeners = new Set<(change: FormChange) => void>();
  readonly #minScale: number;
  readonly #maxScale: number;
  readonly #textLayer: boolean;
  readonly #annotationLayer: boolean;
  readonly #forms: boolean;
  readonly #passwordPrompt: boolean;
  readonly #pageColors: PageColors | undefined;
  readonly #canvasLimits: Pick<
    ViewerOptions,
    "maxDetailPixels" | "maxDetailViewports" | "maxBasePixels" | "maxCanvasPixels" | "maxKeptPixels"
  >;
  readonly #links: LinkHandlers;
  readonly #annotationEditing: boolean;
  readonly #annotationLabels: AnnotationLabels;
  /** Edits the open document's annotations once the document and the viewport are there. */
  #editor: AnnotationEditor | null = null;
  /** The editor while its code loads. */
  #editorStarting: Promise<AnnotationEditor> | null = null;
  /** The page the editor was last told is current. */
  #editorPage = -1;
  /** Annotations kept while no viewport is attached, which the next one shows again. */
  #keptAnnotations: SavedAnnotation[] | null = null;
  /**
   * Positions before link and outline jumps: the page at the viewport's
   * top-left corner and where that corner is, as a share of the page.
   */
  #history: Position[] = [];
  /** Positions `back()` left, latest last, for `forward()`. */
  #future: Position[] = [];
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
  readonly #gestures = new ViewerGestures({
    scroller: () => this.#scroller,
    content: () => this.#content,
    state: () => this.store.get(),
    minScale: () => this.#minScale,
    maxScale: () => this.#maxScale,
    layoutAt: (scale) => computeLayout(this.#sizes, scale, this.#layoutOptions()),
    zoomTo: (scale, anchor, point) => {
      this.store.set({ zoomMode: "custom" });
      this.#zoomTo(scale, anchor, point);
    },
    flip: (direction, axis) => this.#flip(direction, axis),
    requestUpdate: () => this.#requestUpdate(),
  });
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
    this.#explicit = {
      initialPage: options.initialPage,
      initialScale: options.initialScale,
      spread: options.spread,
      scrollMode: options.scrollMode,
    };
    this.#documentView = options.initialView === "document";
    this.#initialViewState = options.initialViewState ?? null;
    this.#destinationZoom = options.destinationZoom ?? true;
    this.#enforcePermissions = options.enforcePermissions ?? false;
    this.#minScale = options.minScale ?? 0.25;
    this.#maxScale = options.maxScale ?? 10;
    this.#textLayer = options.textLayer ?? true;
    this.#annotationLayer = options.annotationLayer ?? true;
    this.#forms = options.forms ?? false;
    this.#passwordPrompt = options.passwordPrompt ?? true;
    this.#pageColors = options.pageColors;
    this.#links = {
      navigate: (dest) => void this.goToDestination(dest),
      namedAction: (action) => this.#namedAction(action),
      externalLinks: options.externalLinks ?? "new-tab",
      openAttachment:
        options.openAttachment ?? (({ filename, content }) => downloadBytes(content, filename)),
      setLayers: (action) => this.#changeLayers((layers) => layers.apply(action)),
    };
    this.#annotationEditing = options.annotationEditing ?? false;
    this.#annotationLabels = { ...ANNOTATION_LABELS, ...options.annotationLabels };
    // The editor follows the zoom, turns, and the current page as they are published.
    this.store.subscribe(this.#followView);
    this.#canvasLimits = {
      maxDetailPixels: options.maxDetailPixels,
      maxDetailViewports: options.maxDetailViewports,
      maxBasePixels: options.maxBasePixels,
      maxCanvasPixels: options.maxCanvasPixels,
      maxKeptPixels: options.maxKeptPixels,
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

  /** Whether the reader may create annotations (`ViewerOptions.annotationEditing`). */
  get annotationEditing(): boolean {
    return this.#annotationEditing;
  }

  get scroller(): HTMLElement | null {
    return this.#scroller;
  }

  /** Render counters for the current document. */
  get stats(): SchedulerStats | null {
    return this.#scheduler?.stats ?? null;
  }

  /** Pixels of the canvases kept from pages that left the mounted window (`maxKeptPixels`). */
  get keptPixels(): number {
    return this.#scheduler?.keptPixels ?? 0;
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
    this.#sourceName = "url" in source ? filenameFromUrl(source.url) : null;
    this.#firstPaintAt = null;
    this.#history = [];
    this.#future = [];
    this.#permissions = null;
    this.store.set({
      status: "loading",
      error: null,
      passwordReason: null,
      progress: null,
      search: IDLE_SEARCH,
      outline: null,
      canGoBack: false,
      canGoForward: false,
      permissions: null,
      documentView: null,
      currentPage: 0,
      rotation: 0,
      zoomMode: this.#initialZoomMode(),
      document: null,
      pageLabels: null,
      metadata: null,
      attachments: null,
      layers: null,
    });
    // Acquisition replays a shared document's pending password request
    // synchronously; initialize first so that request remains visible.
    const lease = acquireDocument(
      this.#engine,
      source,
      {
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
          if (closed) return;
          if (this.#passwordPrompt) {
            this.store.set({ status: "password", passwordReason: reason });
            return;
          }
          // Fails this viewer only, with pdf.js's own messages: other viewers
          // of the same document may still answer.
          const error =
            reason === "incorrect"
              ? "PasswordException: Incorrect Password"
              : "PasswordException: No password given";
          this.store.set({ status: "error", error, passwordReason: null });
        },
      },
      this.#annotationEditing ? this : undefined,
    );
    this.#lease = lease;

    void (async () => {
      try {
        const doc = await lease.document;
        if (closed) return;
        // Fetched beside the first page's size: the scheduler follows the
        // permissions, and the first layout the document's initial view.
        const [firstSize, permissions, documentView] = await Promise.all([
          doc.pageSize(0),
          doc.getPermissions().catch((error: unknown) => {
            console.error("reading permissions failed", error);
            return null;
          }),
          this.#documentView
            ? doc.getInitialView().catch((error: unknown) => {
                console.error("reading the initial view failed", error);
                return null;
              })
            : null,
        ]);
        if (closed) return;
        this.#doc = doc;
        this.#permissions = permissions;
        this.#applyPermissions();
        // Assume every page matches the first until the background pass knows better.
        this.#sizes = Array.from({ length: doc.pageCount }, () => firstSize);
        this.#scheduler = new RenderScheduler(doc, {
          maxConcurrent: this.#maxConcurrentRenders,
          ...this.#canvasLimits,
          links: this.#links,
          forms: this.#forms && this.#permits("fillForms"),
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
        // Pages unmounting while no viewport shows them keep nothing.
        if (!this.#scroller) this.#scheduler.setKeeping(false);
        for (const [index, elements] of this.#pendingPages) {
          this.#scheduler.attach(index, ...elements);
        }
        this.#pendingPages.clear();
        this.#thumbnails.refresh();
        const destination = this.#arrangeAsDocument(documentView);
        const scale = this.#resolveInitialScale();
        this.#applyLayout(scale);
        this.store.set({
          status: "ready",
          passwordReason: null,
          pageCount: doc.pageCount,
          scale,
          document: doc,
          permissions,
          documentView: this.#documentView ? documentView : null,
        });
        if (this.#initialViewState) this.#showView(this.#initialViewState, destination);
        else if (this.#initialPage > 0) this.goToPage(this.#initialPage);
        else if (destination) this.#jump(destination, this.#destinationZoom);
        if (!this.#documentView) {
          this.#publishLater(generation, doc.getInitialView(), "documentView", null);
        }
        this.#update();
        this.#startEditor();
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
        // Its annotations go with it: an application keeps them through
        // exportAnnotations() or save() first.
        this.#stopEditor(false);
        this.#scheduler?.dispose();
        this.#thumbnails.reset();
        this.#searchGeneration++;
        this.#highlights.clear();
        this.#selection.clear();
        this.#textPages.clear();
        this.#indexes.clear();
        this.#history = [];
        this.#future = [];
        this.#permissions = null;
        this.#applyPermissions();
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
          canGoForward: false,
          permissions: null,
          documentView: null,
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
   * The document's bytes, with what was typed into its form fields and the
   * annotations the reader created saved in them; null while no document
   * is open.
   */
  async save(): Promise<Uint8Array | null> {
    // The text being typed counts, as it would once the reader clicks away.
    this.#editor?.commit();
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
   * those pages print. Resolves once the browser returns from printing,
   * and fails with `enforcePermissions` when the document does not permit
   * printing.
   */
  async print(options?: PrintOptions): Promise<void> {
    const doc = this.#doc;
    if (doc && !this.#permits("print")) {
      throw new Error("The document does not permit printing");
    }
    this.#editor?.commit();
    if (doc) await printDocument(doc, { ...options, layers: this.#layers });
  }

  /**
   * Whether the open document permits `what`, or the viewer does not
   * follow permissions. Form fields can also be filled in with permission
   * to annotate (PDF 32000-1, Table 22).
   */
  #permits(what: "print" | "copy" | "annotate" | "fillForms"): boolean {
    const permissions = this.#permissions;
    if (!this.#enforcePermissions || !permissions) return true;
    return what === "fillForms" ? permissions.fillForms || permissions.annotate : permissions[what];
  }

  /** Keep the text from being selected and copied when the document does not permit copying. */
  #applyPermissions(): void {
    this.#content?.classList.toggle("parapdf-no-copy", !this.#permits("copy"));
  }

  #onCopy = (event: ClipboardEvent): void => {
    if (!this.#permits("copy")) event.preventDefault();
  };

  /**
   * The document's form fields with their values, those the reader entered
   * and those `setFormValues()` set included; empty when it has none or
   * no document is open.
   */
  async getFormFields(): Promise<readonly FormField[]> {
    return (await this.#doc?.getFormFields()) ?? [];
  }

  /**
   * Set form fields by name: text for text fields, the export value of the
   * box or radio button to check ("Off" for none, or true for the first
   * box and false for none), and an option's export value, or several for a
   * list box that takes several. Returns the names it set; other names are
   * ignored. Form fields shown (`forms`) show the values, and `save()` and
   * `print()` include them.
   */
  async setFormValues(values: Readonly<Record<string, FormValue | boolean>>): Promise<string[]> {
    const doc = this.#doc;
    if (!doc) return [];
    const set = await doc.setFormValues(values);
    // Form layers read the values as they are built.
    if (set.length > 0 && this.#doc === doc) this.#scheduler?.invalidateContent();
    return set;
  }

  /**
   * Call `listener` with each value the reader enters into a form field
   * (`forms`), as they type; returns the function that stops it.
   * `setFormValues()` does not call it.
   */
  onFormChange(listener: (change: FormChange) => void): () => void {
    this.#formListeners.add(listener);
    return () => {
      this.#formListeners.delete(listener);
    };
  }

  /**
   * Form elements in annotation layers change the document's storage, then
   * bubble here: text fields and lists at each input, boxes and radio
   * buttons at their change, which comes after an input that changed nothing yet.
   */
  #onFormInput = (event: Event): void => {
    const doc = this.#doc;
    const target = event.target;
    if (!doc || this.#formListeners.size === 0 || !(target instanceof Element)) return;
    const toggle =
      target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio");
    if (toggle !== (event.type === "change")) return;
    const id = target
      .closest(".parapdf-annotation-layer [data-element-id]")
      ?.getAttribute("data-element-id");
    if (!id) return;
    const generation = this.#generation;
    doc.formChange(id).then(
      (change) => {
        if (!change || this.#generation !== generation) return;
        for (const listener of this.#formListeners) listener(change);
      },
      (error: unknown) => console.error("reading a form change failed", error),
    );
  };

  /**
   * Start editing annotations if `ViewerOptions.annotationEditing` is on,
   * once the document is open and a viewport attached, with the annotations
   * a viewport that detached left. The editor's code loads first.
   */
  #startEditor(): void {
    const doc = this.#doc;
    const scheduler = this.#scheduler;
    const scroller = this.#scroller;
    const content = this.#content;
    if (!this.#annotationEditing || this.#editor || this.#editorStarting) return;
    if (!doc || !scheduler || !scroller || !content || !this.#permits("annotate")) return;
    const { layout, rotation, scale } = this.store.get();
    let editor: AnnotationEditor | null = null;
    const starting = doc.createAnnotationEditor({
      container: scroller,
      pages: content,
      labels: this.#annotationLabels,
      ...(this.#pageColors ? { pageColors: this.#pageColors } : {}),
      scale: layout?.scale ?? scale,
      rotation,
      onStateChange: (annotationState) => {
        if (editor && this.#editor === editor) this.store.set({ annotationState });
      },
      onStylesChange: (annotationStyles) => {
        if (editor && this.#editor === editor) this.store.set({ annotationStyles });
      },
      onToolChange: (annotationTool) => {
        if (!editor || this.#editor !== editor) return;
        this.store.set({ annotationTool });
        content.classList.toggle("parapdf-annotating", annotationTool !== "none");
      },
    });
    this.#editorStarting = starting;
    starting.then(
      (started) => {
        const current =
          this.#editorStarting === starting &&
          this.#doc === doc &&
          this.#scheduler === scheduler &&
          this.#scroller === scroller;
        if (this.#editorStarting === starting) this.#editorStarting = null;
        if (!current) {
          started.destroy();
          return;
        }
        editor = started;
        this.#editor = started;
        const { currentPage, layout: shown, rotation: turn } = this.store.get();
        // The view may have changed while the editor's code loaded.
        if (shown) started.setView(shown.scale, turn);
        this.#editorPage = currentPage;
        started.setCurrentPage(currentPage);
        scheduler.setAnnotationEditor(started);
        this.store.set({
          annotationTool: "none",
          annotationState: started.state,
          annotationStyles: started.styles,
        });
        const kept = this.#keptAnnotations;
        this.#keptAnnotations = null;
        if (kept?.length) this.#background(started.import(kept), "restoring annotations");
      },
      (error: unknown) => {
        if (this.#editorStarting === starting) this.#editorStarting = null;
        console.error("starting the annotation editor failed", error);
      },
    );
  }

  /**
   * Stop editing annotations; with `keep`, the next editor shows them
   * again, as it does annotations kept while this one was starting.
   */
  #stopEditor(keep: boolean): void {
    const editor = this.#editor;
    this.#editorStarting = null;
    if (!keep) this.#keptAnnotations = null;
    if (!editor) return;
    if (keep) {
      editor.commit();
      this.#keptAnnotations = editor.export();
    }
    this.#editor = null;
    this.#scheduler?.setAnnotationEditor(null);
    editor.destroy();
    this.#content?.classList.remove("parapdf-annotating");
    this.store.set({ annotationTool: "none", annotationState: null, annotationStyles: null });
  }

  #followView = (): void => {
    const editor = this.#editor;
    if (!editor) return;
    const { layout, currentPage } = this.store.get();
    if (layout) editor.setView(layout.scale, layout.rotation);
    if (currentPage !== this.#editorPage) {
      this.#editorPage = currentPage;
      editor.setCurrentPage(currentPage);
    }
  };

  /**
   * Choose what a pointer does on the pages: "highlight" highlights the
   * text the reader selects, or, dragged outside text, draws a highlight
   * freehand; "freetext" adds text where the reader clicks; "ink" draws;
   * "stamp" and "signature" select and move images and signatures, which
   * `addImage()` and `addSignature()` add. With any of them, the reader can
   * select, move, resize, and delete the annotations created, and keys undo
   * and redo. "none" leaves them shown but out of reach. Needs
   * `annotationEditing`.
   */
  async setAnnotationTool(tool: AnnotationTool): Promise<void> {
    const editor = this.#editor;
    if (!editor) return;
    this.store.set({ annotationTool: tool });
    // Links and comments are out of reach while a tool is chosen, as in pdf.js's viewer.
    this.#content?.classList.toggle("parapdf-annotating", tool !== "none");
    await editor.setTool(tool);
  }

  /**
   * Restyle the selected annotations, or, with none selected, the next
   * ones `tool` creates, as pdf.js's toolbar of that tool does.
   * `annotationStyles` shows the result.
   */
  setAnnotationStyle<T extends keyof AnnotationStyles>(
    tool: T,
    style: Partial<AnnotationStyles[T]>,
  ): void {
    this.#editor?.setStyle(tool, style);
  }

  undoAnnotation(): void {
    this.#editor?.undo();
  }

  redoAnnotation(): void {
    this.#editor?.redo();
  }

  deleteSelectedAnnotations(): void {
    this.#editor?.deleteSelected();
  }

  selectAllAnnotations(): void {
    this.#editor?.selectAll();
  }

  /**
   * Add an image, from a Blob or a URL the page may fetch, to page
   * `pageIndex` (default: the current page), in the middle of its visible
   * part, selected so that the reader can move and resize it. `altText`
   * describes it to assistive technology, in the PDF too. Switches to the
   * "stamp" tool. Resolves false when the image cannot be added or a newer
   * annotation tool choice cancels it while its image loads.
   */
  async addImage(
    image: Blob | string,
    options: { pageIndex?: number; altText?: string } = {},
  ): Promise<boolean> {
    const pageIndex = await this.#editablePage(options.pageIndex);
    const editor = this.#editor;
    if (pageIndex === null || !editor) return false;
    this.store.set({ annotationTool: "stamp" });
    this.#content?.classList.add("parapdf-annotating");
    return editor.addImage(pageIndex, image, options.altText);
  }

  /**
   * Add a signature to page `pageIndex` (default: the current page) as
   * `addImage()` adds an image: typed text, an image, or drawn strokes, as
   * outlines. `description` names it for assistive technology. Switches to
   * the "signature" tool. Resolves false for empty or untraceable signatures,
   * or when a newer annotation tool choice cancels it while it loads.
   */
  async addSignature(
    signature: SignatureInput,
    options: { pageIndex?: number; description?: string } = {},
  ): Promise<boolean> {
    const pageIndex = await this.#editablePage(options.pageIndex);
    const editor = this.#editor;
    if (pageIndex === null || !editor) return false;
    this.store.set({ annotationTool: "signature" });
    this.#content?.classList.add("parapdf-annotating");
    return editor.addSignature(pageIndex, signature, options.description);
  }

  /** Page `requested`, or the current one, once its annotations can be edited; null if never. */
  async #editablePage(requested: number | undefined): Promise<number | null> {
    const scheduler = this.#scheduler;
    const { pageCount, currentPage, first, last } = this.store.get();
    const pageIndex = requested ?? currentPage;
    if (!scheduler || !this.#editor || pageIndex < 0 || pageIndex >= pageCount) return null;
    if (pageIndex < first || pageIndex > last) this.goToPage(pageIndex);
    return (await scheduler.whenEditable(pageIndex)) && this.#scheduler === scheduler
      ? pageIndex
      : null;
  }

  /**
   * Every annotation the reader created, on any page, mounted or not, as
   * JSON-compatible data to keep and give back to `importAnnotations()`. The
   * text being typed counts once the reader commits it. Empty while
   * editing is off.
   */
  exportAnnotations(): SavedAnnotation[] {
    return this.#editor?.export() ?? [];
  }

  /**
   * Add annotations `exportAnnotations()` gave, where they were, without an
   * undo step: say, after the same document opens again. Resolves with how
   * many were added; 0 while editing is off.
   */
  async importAnnotations(annotations: readonly SavedAnnotation[]): Promise<number> {
    return (await this.#editor?.import(annotations)) ?? 0;
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
    this.#scheduler?.setKeeping(true);
    const layout = this.store.get().layout;
    if (layout) this.#sizeContent(layout);
    scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    const detachGestures = this.#gestures.attach(scroller);
    scroller.addEventListener("pointerdown", this.#onGrabStart);
    scroller.addEventListener("pointermove", this.#onGrabMove, { passive: true });
    scroller.addEventListener("pointerup", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("pointercancel", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("keydown", this.#onKeyDown);
    scroller.classList.toggle("parapdf-hand", this.store.get().tool === "hand");
    content.addEventListener("copy", this.#onCopy);
    content.addEventListener("cut", this.#onCopy);
    content.addEventListener("input", this.#onFormInput);
    content.addEventListener("change", this.#onFormInput);
    this.#applyPermissions();
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    const detachSelection = this.#selection.attachPages(content);
    this.#requestUpdate();
    this.#startEditor();
    return () => {
      // The annotations stay for the next viewport.
      if (this.#scroller === scroller) this.#stopEditor(true);
      scroller.removeEventListener("scroll", this.#onScroll);
      detachGestures();
      scroller.removeEventListener("pointerdown", this.#onGrabStart);
      scroller.removeEventListener("pointermove", this.#onGrabMove);
      scroller.removeEventListener("pointerup", this.#onGrabEnd);
      scroller.removeEventListener("pointercancel", this.#onGrabEnd);
      scroller.removeEventListener("keydown", this.#onKeyDown);
      scroller.classList.remove("parapdf-hand", "parapdf-grabbing");
      this.#grab = null;
      resize.disconnect();
      detachSelection();
      content.removeEventListener("copy", this.#onCopy);
      content.removeEventListener("cut", this.#onCopy);
      content.removeEventListener("input", this.#onFormInput);
      content.removeEventListener("change", this.#onFormInput);
      content.classList.remove("parapdf-no-copy");
      if (this.#frame) cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (this.#scroller === scroller) {
        this.#gestures.drop();
        // Kept canvases would hold memory for pages no viewport can show.
        this.#scheduler?.setKeeping(false);
        this.#scroller = null;
        this.#content = null;
      }
    };
  }

  /**
   * Register a mounted page's layers; returns the function that releases
   * them. With `spare`, a second detail canvas stacked over the base like
   * `detail`, a new detail is drawn there while the page shows the old one.
   * `editor` receives the annotations the reader creates on the page, and
   * the drawings of highlights and lines go into `base`'s parent.
   */
  attachPage(
    index: number,
    base: HTMLCanvasElement,
    detail: HTMLCanvasElement,
    text: HTMLElement | null,
    annotations: HTMLElement | null = null,
    structure: HTMLElement | null = null,
    spare: HTMLCanvasElement | null = null,
    editor: HTMLElement | null = null,
  ): () => void {
    const textLayer = this.#textLayer ? text : null;
    const annotationLayer = this.#annotationLayer ? annotations : null;
    // The structure takes the text layer's runs in, so it comes with them.
    const structureLayer = textLayer ? structure : null;
    const editorLayer = this.#annotationEditing ? editor : null;
    const elements: PageElements = [
      base,
      detail,
      textLayer,
      annotationLayer,
      structureLayer,
      spare,
      editorLayer,
    ];
    const scheduler = this.#scheduler;
    if (scheduler) scheduler.attach(index, ...elements);
    else this.#pendingPages.set(index, elements);
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
    const first = selection.getRangeAt(0);
    const last = selection.getRangeAt(selection.rangeCount - 1);
    return {
      // The selection's own text keeps its line breaks.
      text: outside ? text : selection.toString(),
      pages: [...rectsByPage]
        .sort(([a], [b]) => a - b)
        .map(([pageIndex, rects]) => ({ pageIndex, rects })),
      start: this.#textPointAt(first.startContainer, first.startOffset),
      end: this.#textPointAt(last.endContainer, last.endOffset),
    };
  }

  /** Where a range boundary in a mounted page's text layer lies in the document's text. */
  #textPointAt(node: Node, offset: number): TextPoint | null {
    const element = node instanceof Element ? node : node.parentElement;
    const layer = element?.closest<HTMLElement>(".parapdf-text-layer");
    const section = layer?.closest<HTMLElement>("section[data-page]");
    if (!layer || !section || !this.#content?.contains(section)) return null;
    const pageIndex = Number(section.dataset.page) - 1;
    const handle = this.#textPages.get(pageIndex);
    return handle ? textPointOf(pageIndex, handle.elements, node, offset) : null;
  }

  /**
   * The document's text, read from the engine's text content of every page
   * between `from` and `to`, mounted or not: items in content order, as
   * search and the text layers read them, with "\n" where lines end or, with
   * `lineBreaks: "join"`, lines joined as search joins them. Pages are
   * parsed in the engine's worker, a few at a time; the texts are kept, so a
   * second read, or a search, parses nothing again. Rejects while no
   * document is open, and once it closes.
   */
  async getText(options: TextOptions = {}): Promise<DocumentText> {
    const doc = this.#doc;
    if (!doc) throw new Error("No document is open");
    const { from, to, lineBreaks = "keep", signal } = options;
    signal?.throwIfAborted();
    const lastPage = doc.pageCount - 1;
    const start = typeof from === "number" ? { pageIndex: from } : from;
    const end = typeof to === "number" ? { pageIndex: to } : to;
    const first = clamp(start?.pageIndex ?? 0, 0, lastPage);
    const last = clamp(end?.pageIndex ?? lastPage, 0, lastPage);
    // Pages are asked for ahead of the one being read: the worker parses
    // them one after another while the main thread joins the text.
    const requested = new Map<number, Promise<PageText>>();
    const request = (pageIndex: number) => {
      if (pageIndex > last || requested.has(pageIndex)) return;
      const text = doc.getText(pageIndex);
      // Abandoned when the read stops early; the read itself awaits it.
      text.catch(() => {});
      requested.set(pageIndex, text);
    };
    const pages: PageTextContent[] = [];
    let text = "";
    for (let pageIndex = first; pageIndex <= last; pageIndex++) {
      for (let ahead = pageIndex; ahead < pageIndex + TEXT_READ_AHEAD; ahead++) request(ahead);
      const content = await requested.get(pageIndex);
      requested.delete(pageIndex);
      signal?.throwIfAborted();
      if (this.#doc !== doc || !content) throw new Error("The document was closed");
      const startsHere = start && "item" in start && start.pageIndex === pageIndex;
      const endsHere = end && "item" in end && end.pageIndex === pageIndex;
      const read = pageText(content, lineBreaks, startsHere ? start : null, endsHere ? end : null);
      if (pages.length > 0) text += PAGE_SEPARATOR;
      pages.push({ pageIndex, text: read, offset: text.length });
      text += read;
    }
    return { text, pages };
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
    // In "page" mode, from the row shown: the current page follows it a
    // frame later, so a key pressed before then flipped to the same row.
    const row =
      layout.shown ??
      (layout.scrollMode === "horizontal"
        ? rowBounds(spread, currentPage, count)
        : { first: rowStart(layout, currentPage), last: rowEnd(layout, currentPage) });
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
   * Follow an internal link or outline entry, with the zoom its destination
   * asks for unless `destinationZoom` is false. The position before the
   * jump is remembered for `back()`. Resolves to false when the target is
   * invalid.
   */
  async goToDestination(dest: DestinationRef): Promise<boolean> {
    const doc = this.#doc;
    if (!doc) return false;
    const target = await doc.resolveDestination(dest).catch(() => null);
    const current = this.store.get().layout;
    if (!target || !current || !this.#scroller || this.#doc !== doc) return false;
    if (target.pageIndex < 0 || target.pageIndex >= current.tops.length) return false;
    this.#remember();
    this.#jump(target, this.#destinationZoom);
    return true;
  }

  /**
   * Show a destination's point at the viewport's top-left corner, with the
   * zoom it asks for when `zoom` is true. An explicit left scrolls sideways
   * only when it is out of view, unless `exact`.
   */
  #jump(target: ResolvedDestination, zoom: boolean, exact = false): void {
    this.#gestures.finish();
    let current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller) return;
    const { pageIndex } = target;
    const fitted = zoom ? this.#destinationScale(target) : null;
    if (fitted) {
      this.store.set({ zoomMode: fitted.mode, currentPage: pageIndex });
      if (fitted.mode !== "custom") {
        this.#fittedWidth = scroller.clientWidth;
        this.#fittedHeight = scroller.clientHeight;
      }
      if (Math.abs(fitted.scale - current.scale) > 1e-4) {
        current = this.#applyLayout(fitted.scale, pageIndex);
        this.store.set({ scale: fitted.scale });
      }
    }
    const layout = this.#show(current, pageIndex);
    const rect = target.view?.fit === "rect" ? target.view : null;
    // The engine reports the point on the unturned page; a quarter turn makes
    // its left coordinate the vertical one.
    const size = layout.sizes[pageIndex] ?? { width: 0, height: 0 };
    const point = turnBox(
      { x: target.x ?? 0, y: target.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 },
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
      // A rectangle fills the viewport from its left edge, and a view
      // state shows the same part of the page again.
      ((rect || exact) && hasLeft) ||
      (hasLeft && (left < scroller.scrollLeft || left > scroller.scrollLeft + scroller.clientWidth))
    ) {
      scroller.scrollLeft = left;
    }
    this.store.set({ currentPage: pageIndex });
    this.#update();
  }

  /**
   * The zoom a destination asks for on page `target.pageIndex`, and the
   * zoom mode that keeps it; null to keep the zoom.
   */
  #destinationScale(target: ResolvedDestination): { scale: number; mode: ZoomMode } | null {
    const view = target.view;
    const scroller = this.#scroller;
    const size = this.#sizes[target.pageIndex];
    if (!view || !scroller || !size) return null;
    const scaled = (scale: number) =>
      Number.isFinite(scale) && scale > 0
        ? { scale: clamp(scale, this.#minScale, this.#maxScale), mode: "custom" as const }
        : null;
    const quarter = this.store.get().rotation % 180 !== 0;
    switch (view.fit) {
      case "zoom":
        // A zoom of 1 shows the page at its printed size, 96 CSS pixels an inch.
        return view.zoom === null ? null : scaled((view.zoom * 96) / 72);
      case "page":
      case "width": {
        const mode = view.fit === "page" ? "fit-page" : "fit-width";
        const scale = this.#fitScale(target.pageIndex, mode);
        return scale === null ? null : { scale, mode };
      }
      case "height":
        return scaled(
          (scroller.clientHeight - 2 * this.#gap) / (quarter ? size.width : size.height),
        );
      case "rect":
        return scaled(
          Math.min(
            scroller.clientWidth / (quarter ? view.height : view.width),
            scroller.clientHeight / (quarter ? view.width : view.height),
          ),
        );
    }
  }

  /**
   * With `initialView: "document"`, arrange the pages as the document's
   * /PageLayout asks, unless the application chose the arrangement, and
   * return where to open: the /OpenAction destination, unless the
   * application chose the page.
   */
  #arrangeAsDocument(view: PdfInitialView | null): ResolvedDestination | null {
    if (!this.#documentView || !view) return null;
    // A document that asks for no layout gets the default one, not the
    // layout of the document this viewer showed before.
    const arrangement =
      (view.pageLayout ? PAGE_LAYOUTS[view.pageLayout] : null) ?? PAGE_LAYOUTS.OneColumn;
    if (this.#explicit.spread === undefined) this.store.set({ spread: arrangement.spread });
    if (this.#explicit.scrollMode === undefined) {
      this.store.set({ scrollMode: arrangement.scrollMode });
    }
    const destination = view.destination;
    if (this.#explicit.initialPage !== undefined || !destination) return null;
    if (destination.pageIndex < 0 || destination.pageIndex >= this.#sizes.length) return null;
    // The application's zoom wins over the destination's.
    if (this.#explicit.initialScale !== undefined) {
      const { view: _, ...point } = destination;
      return point;
    }
    return destination;
  }

  /**
   * Where and how the viewer shows its document now, to show again with
   * `setViewState()` or `initialViewState`, in this viewer or another, such
   * as when the reader opens the document again or follows a shared link.
   * Null until the document is ready.
   */
  getViewState(): ViewState | null {
    const state = this.store.get();
    const layout = state.layout;
    const scroller = this.#scroller;
    if (state.status !== "ready" || !layout || !scroller) return null;
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = scroller;
    // The gap above a row belongs to it: a page shown from its top, as
    // `goToPage()` shows it, is the page of the view, not the one above.
    const page = pageAtPoint(layout, scrollLeft, scrollTop + layout.gap, clientWidth);
    const size = layout.sizes[page] ?? { width: 0, height: 0 };
    // The point on the page as it shows, turned back by the view's rotation.
    const point = turnBox(
      {
        x: (scrollLeft - pageLeft(layout, page, clientWidth)) / layout.scale,
        y: (scrollTop - pageTop(layout, page, clientHeight)) / layout.scale,
        width: 0,
        height: 0,
      },
      turnedSize(size, layout.rotation),
      ((360 - layout.rotation) % 360) as Rotation,
    );
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      page,
      x: round(point.x),
      y: round(point.y),
      scale: state.zoomMode === "custom" ? layout.scale : state.zoomMode,
      rotation: layout.rotation,
      spread: state.spread,
      scrollMode: state.scrollMode,
    };
  }

  /**
   * Show a view kept from `getViewState()`: its arrangement, rotation, and
   * zoom, and the same point of the same page at the viewport's top-left
   * corner. Fields left out keep the view's; without `x` and `y`, the page
   * shows from its top. Values out of range are clamped or ignored, so a
   * view read from a URL needs no checking.
   */
  setViewState(view: Partial<ViewState>): void {
    this.#showView(view, null);
  }

  /** Show `view`; without a page of its own, at `fallback`, the document's destination. */
  #showView(view: Partial<ViewState>, fallback: ResolvedDestination | null): void {
    this.#gestures.finish();
    const before = this.store.get();
    const scroller = this.#scroller;
    if (!before.layout || !scroller || before.layout.tops.length === 0) return;
    const count = before.layout.tops.length;
    const number = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value);
    const rotation = number(view.rotation)
      ? (((((Math.round(view.rotation / 90) * 90) % 360) + 360) % 360) as Rotation)
      : before.rotation;
    const spread = SPREADS.has(view.spread as string) ? (view.spread as SpreadMode) : before.spread;
    const scrollMode = SCROLL_MODES.has(view.scrollMode as string)
      ? (view.scrollMode as ScrollMode)
      : before.scrollMode;
    const target: ResolvedDestination = number(view.page)
      ? {
          pageIndex: clamp(Math.trunc(view.page), 0, count - 1),
          x: number(view.x) ? view.x : null,
          y: number(view.y) ? view.y : null,
        }
      : (fallback ?? { pageIndex: before.currentPage, x: null, y: null });
    const page = target.pageIndex;
    this.store.set({ rotation, spread, scrollMode, currentPage: page });
    const requested = view.scale;
    let mode: ZoomMode = before.zoomMode;
    let scale = before.scale;
    if (requested === "fit-width" || requested === "fit-page") mode = requested;
    else if (number(requested) && requested > 0) {
      mode = "custom";
      scale = clamp(requested, this.#minScale, this.#maxScale);
    }
    if (mode !== "custom") {
      scale = this.#fitScale(page, mode) ?? scale;
      this.#fittedWidth = scroller.clientWidth;
      this.#fittedHeight = scroller.clientHeight;
    }
    this.store.set({ zoomMode: mode, scale });
    this.#applyLayout(scale, page);
    if (rotation !== before.rotation) this.#scheduler?.rotate(rotation);
    // The destination's zoom applies only when the view leaves the zoom unsaid.
    if (target.x === null && target.y === null && !target.view) this.goToPage(page);
    else this.#jump(target, requested === undefined && this.#destinationZoom, true);
  }

  /** Return to the position, and the zoom, before the most recent link or outline jump. */
  back(): void {
    const entry = this.#history.pop();
    const position = entry ? this.#position() : null;
    if (position) this.#future.push(position);
    this.store.set({
      canGoBack: this.#history.length > 0,
      canGoForward: this.#future.length > 0,
    });
    if (entry) this.#restore(entry);
  }

  /** Return to the position the most recent `back()` left. */
  forward(): void {
    const entry = this.#future.pop();
    const position = entry ? this.#position() : null;
    if (position) this.#history.push(position);
    this.store.set({
      canGoBack: this.#history.length > 0,
      canGoForward: this.#future.length > 0,
    });
    if (entry) this.#restore(entry);
  }

  #restore(entry: Position): void {
    this.#gestures.finish();
    let current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller) return;
    const { pageIndex, zoomMode } = entry;
    // A fitted zoom fits the viewport as it is now.
    const scale =
      zoomMode === "custom"
        ? entry.scale
        : (this.#fitScale(entry.current, zoomMode) ?? entry.scale);
    this.store.set({ zoomMode, currentPage: entry.current });
    if (Math.abs(scale - current.scale) > 1e-4) {
      if (zoomMode !== "custom") {
        this.#fittedWidth = scroller.clientWidth;
        this.#fittedHeight = scroller.clientHeight;
      }
      current = this.#applyLayout(scale, pageIndex);
      this.store.set({ scale });
    }
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
   * The viewport's top-left corner as a page and a share of it, which
   * survive zoom changes, and the current page.
   */
  #position(): Position | null {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return null;
    const { scrollLeft: x, scrollTop: y, clientWidth, clientHeight } = scroller;
    const pageIndex = pageAtPoint(layout, x, y, clientWidth);
    return {
      pageIndex,
      x: (x - pageLeft(layout, pageIndex, clientWidth)) / (layout.widths[pageIndex] || 1),
      y: (y - pageTop(layout, pageIndex, clientHeight)) / (layout.heights[pageIndex] || 1),
      current: this.store.get().currentPage,
      scale: layout.scale,
      zoomMode: this.store.get().zoomMode,
    };
  }

  /** Save the position before a jump for `back()`; a new jump forgets what `forward()` had. */
  #remember(): void {
    const position = this.#position();
    if (!position) return;
    this.#history.push(position);
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    this.#future = [];
    this.store.set({ canGoBack: true, canGoForward: false });
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
      case "GoForward":
        this.forward();
        break;
    }
  }

  zoomBy(factor: number): void {
    this.#gestures.finish();
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
    this.#gestures.finish();
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
    this.#gestures.finish();
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
    this.#gestures.finish();
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
    this.#gestures.finish();
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
    this.#gestures.finish();
    const scroller = this.#scroller;
    const layout = this.store.get().layout;
    // Shrinking the content can clamp its scroll position immediately.
    const point = scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : null;
    this.#sizes = sizes;
    const next = this.#applyLayout(this.store.get().scale);
    if (scroller && layout && point) {
      // Keep the point at the viewport's top-left corner where it is.
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
      this.#gestures.finish();
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
    this.#gestures.finish();
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
    const target = event.target instanceof Element ? event.target : null;
    // Arrow keys move a selected annotation.
    const edges = target?.closest(CONTROLS) ? null : this.#edges();
    if (!edges) return;
    const { atTop, atBottom, atLeft, atRight } = edges;
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

  /** Which edges of its scroll range the scroller is at; null without a scroller. */
  #edges(): Edges | null {
    return this.#scroller ? scrollEdges(this.#scroller) : null;
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
    const { tool, annotationTool } = this.store.get();
    // An annotation tool takes the pointer over the hand tool.
    if (tool !== "hand" || annotationTool !== "none") return;
    if (event.pointerType === "touch" || event.button !== 0) return;
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

  #requestUpdate(): void {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#onFrame);
  }

  /**
   * Once a frame: the touches' moves since the last one, then the update.
   * #frame is still set while the touches are read, so the preview they
   * change requests no frame of its own. Direct calls of #update, from a
   * relayout, read no touches: a pinch that starts again there would
   * preview against the layout the relayout replaces.
   */
  #onFrame = (): void => {
    this.#gestures.readTouches();
    this.#update();
  };

  #update = (): void => {
    this.#frame = 0;
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    const viewport = this.#gestures.shownViewport(scroller);
    const zoomMotion = this.#gestures.motion;
    // A preview's drag moves the shown content without scrolling. It is
    // measured once a frame, as scrolling is: the moves of a drag's two
    // fingers come microseconds apart, and measuring each would make a slow
    // drag look like a fling.
    const position = positionOf(layout.scrollMode, viewport);
    if (zoomMotion && position !== zoomMotion.position) {
      move(zoomMotion, position, performance.now());
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
    const motion = zoomMotion ?? this.#scrolling;
    const quiet = performance.now() - motion.at > SETTLE_DELAY;
    // A zoom preview's commit draws the pages again at its zoom: until then
    // the preview counts as fast scrolling.
    const settled =
      (quiet || Math.abs(motion.velocity) < SETTLE_VELOCITY) && !this.#gestures.zooming();
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
