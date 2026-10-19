import type {
  DestinationRef,
  LinkHandlers,
  OutlineNode,
  PageSize,
  PdfEngine,
  PdfEngineDocument,
  PdfSource,
  Rotation,
  TextLayerHandle,
} from "../engine/types.ts";
import { acquireDocument } from "./documents.ts";
import { SearchHighlights } from "./highlights.ts";
import {
  computeLayout,
  type Layout,
  pageAt,
  pageLeft,
  turnBox,
  turnedSize,
  type Viewport,
  visibleArea,
  visibleRange,
} from "./layout.ts";
import { RenderScheduler, type SchedulerStats } from "./scheduler.ts";
import { TextSelectionTracker } from "./selection.ts";
import { Store } from "./store.ts";
import {
  buildPageIndex,
  findMatches,
  normalizeQuery,
  type PageIndex,
  type SearchMatch,
} from "./text-search.ts";

export interface SearchState {
  query: string;
  status: "idle" | "searching" | "done";
  /** Matches in page order. */
  matches: readonly SearchMatch[];
  /** Index into `matches` of the selected result, -1 when none. */
  current: number;
  pagesSearched: number;
}

export interface ViewerState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  pageCount: number;
  layout: Layout | null;
  /** Mounted page window: visible pages plus overscan. */
  first: number;
  last: number;
  /** Page nearest the viewport center. */
  currentPage: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /**
   * "fit-width" keeps fitting the width of the page at the viewport's center
   * as the viewport resizes or the view turns; "custom" keeps `scale`.
   */
  zoomMode: ZoomMode;
  /** Clockwise view rotation of every page. */
  rotation: Rotation;
  /** The open document, for engine features ParaPDF does not wrap; null until it loads. */
  document: PdfEngineDocument | null;
  search: SearchState;
  /** Document outline; null until loaded, empty when the PDF has none. */
  outline: readonly OutlineNode[] | null;
  /** Whether `back()` can return to a position before a link or outline jump. */
  canGoBack: boolean;
}

export type ZoomMode = "fit-width" | "custom";

export interface ViewerOptions {
  /** Space between pages in CSS pixels. */
  gap?: number;
  /** Pages mounted beyond each edge of the viewport. */
  overscan?: number;
  maxConcurrentRenders?: number;
  /** A scale in CSS pixels per point, or "fit-width" (the default) to keep fitting the page width. */
  initialScale?: number | "fit-width";
  minScale?: number;
  maxScale?: number;
  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
  /** Build focusable link layers (default true). */
  annotationLayer?: boolean;
  /**
   * What links to other documents do: open in a new tab (the default), or
   * nothing, for apps that must not lead away from the document. Internal
   * links and the outline keep working.
   */
  externalLinks?: "new-tab" | "disabled";
  /**
   * The most pixels one page's detail canvas holds (default 16 777 216, the
   * canvas area limit of iOS). A page larger at full resolution gets detail
   * only for its visible area plus a margin, still at full resolution.
   */
  maxDetailPixels?: number;
  /** The most pixels one page's base canvas holds (default 2 097 152). */
  maxBasePixels?: number;
  /**
   * The most pixels all of this viewer's canvases hold together (default
   * unlimited), for memory-capped browsers such as iOS Safari. Pages outside
   * the viewport render only within it and give their pixels back first,
   * detail before base; visible pages always keep theirs.
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
/** Search publishes partial results at most this often. */
const SEARCH_PUBLISH_INTERVAL = 100;

const IDLE_SEARCH: SearchState = {
  query: "",
  status: "idle",
  matches: [],
  current: -1,
  pagesSearched: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const viewportOf = (scroller: HTMLElement): Viewport => ({
  left: scroller.scrollLeft,
  top: scroller.scrollTop,
  width: scroller.clientWidth,
  height: scroller.clientHeight,
});

const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

type PageElements = [HTMLCanvasElement, HTMLCanvasElement, HTMLElement | null, HTMLElement | null];

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
  /**
   * The translation the preview shows: the pan, less what the commit cannot
   * keep because the new scroll range ends or a narrower page centers.
   */
  translateX: number;
  translateY: number;
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
  /** The pointer's position on macOS, the touches' midpoint on iPadOS. */
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
    pageCount: 0,
    layout: null,
    first: 0,
    last: -1,
    currentPage: 0,
    scale: 1,
    zoomMode: "custom",
    search: IDLE_SEARCH,
    outline: null,
    canGoBack: false,
    rotation: 0,
    document: null,
  });
  readonly #engine: PdfEngine;
  readonly #gap: number;
  readonly #overscan: number;
  readonly #maxConcurrentRenders: number;
  readonly #initialScale: number | "fit-width";
  readonly #minScale: number;
  readonly #maxScale: number;
  readonly #textLayer: boolean;
  readonly #annotationLayer: boolean;
  readonly #canvasLimits: Pick<
    ViewerOptions,
    "maxDetailPixels" | "maxBasePixels" | "maxCanvasPixels"
  >;
  readonly #links: LinkHandlers;
  /** Positions before link and outline jumps, as a page plus a fraction of it. */
  #history: { pageIndex: number; offset: number }[] = [];
  readonly #highlights = new SearchHighlights();
  readonly #selection = new TextSelectionTracker();
  #generation = 0;
  #doc: PdfEngineDocument | null = null;
  #scheduler: RenderScheduler | null = null;
  #sizes: PageSize[] = [];
  #pendingPages = new Map<number, PageElements>();
  #textPages = new Map<number, TextLayerHandle>();
  #indexes = new Map<number, Promise<PageIndex>>();
  #searchGeneration = 0;
  #scroller: HTMLElement | null = null;
  #content: HTMLElement | null = null;
  #frame = 0;
  #settleTimer = 0;
  #lastTop = 0;
  #lastScrollAt = 0;
  #velocity = 0;
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
  /** Viewport width the "fit-width" scale was last computed for. */
  #fittedWidth = 0;

  constructor(engine: PdfEngine, options: ViewerOptions = {}) {
    this.#engine = engine;
    this.#gap = options.gap ?? 12;
    this.#overscan = options.overscan ?? 2;
    this.#maxConcurrentRenders = options.maxConcurrentRenders ?? 2;
    this.#initialScale = options.initialScale ?? "fit-width";
    this.#minScale = options.minScale ?? 0.25;
    this.#maxScale = options.maxScale ?? 10;
    this.#textLayer = options.textLayer ?? true;
    this.#annotationLayer = options.annotationLayer ?? true;
    this.#links = {
      navigate: (dest) => void this.goToDestination(dest),
      namedAction: (action) => this.#namedAction(action),
      externalLinks: options.externalLinks ?? "new-tab",
    };
    this.#canvasLimits = {
      maxDetailPixels: options.maxDetailPixels,
      maxBasePixels: options.maxBasePixels,
      maxCanvasPixels: options.maxCanvasPixels,
    };
    this.store.set({ zoomMode: this.#initialZoomMode() });
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
    const lease = acquireDocument(this.#engine, source);
    let closed = false;
    this.#firstPaintAt = null;
    this.#history = [];
    this.store.set({
      status: "loading",
      error: null,
      search: IDLE_SEARCH,
      outline: null,
      canGoBack: false,
      rotation: 0,
      zoomMode: this.#initialZoomMode(),
      document: null,
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
        for (const [index, [base, detail, text, annotations]] of this.#pendingPages) {
          this.#scheduler.attach(index, base, detail, text, annotations);
        }
        this.#pendingPages.clear();
        const scale = this.#resolveInitialScale(firstSize);
        this.#applyLayout(this.#layoutAt(scale));
        this.store.set({ status: "ready", pageCount: doc.pageCount, scale, document: doc });
        this.#update();
        this.#background(this.#refineSizes(doc, generation), "measuring page sizes", generation);
        // The outline parses in the worker; publish it whenever it is ready.
        void doc.getOutline().then(
          (outline) => {
            if (this.#generation === generation) this.store.set({ outline });
          },
          () => {
            if (this.#generation === generation) this.store.set({ outline: [] });
          },
        );
      } catch (error) {
        if (!closed) this.store.set({ status: "error", error: String(error) });
      }
    })();

    return () => {
      closed = true;
      if (this.#generation === generation) {
        // Work still running for this document now sees a stale generation.
        this.#generation++;
        this.#scheduler?.dispose();
        this.#searchGeneration++;
        this.#highlights.clear();
        this.#selection.clear();
        this.#textPages.clear();
        this.#indexes.clear();
        this.#history = [];
        this.#doc = null;
        this.#scheduler = null;
        this.store.set({
          status: "idle",
          pageCount: 0,
          layout: null,
          first: 0,
          last: -1,
          search: IDLE_SEARCH,
          outline: null,
          canGoBack: false,
          document: null,
        });
      }
      // Destroyed once no viewer uses it, even if it is still loading.
      lease.release();
    };
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
    // Not passive: Safari zooms the whole page unless they are prevented.
    for (const type of GESTURE_EVENTS) {
      scroller.addEventListener(type, this.#onGesture, { passive: false });
    }
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    this.#requestUpdate();
    return () => {
      scroller.removeEventListener("scroll", this.#onScroll);
      scroller.removeEventListener("wheel", this.#onWheel);
      scroller.removeEventListener("pointerdown", this.#onPointerDown);
      for (const type of GESTURE_EVENTS) scroller.removeEventListener(type, this.#onGesture);
      resize.disconnect();
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
  ): () => void {
    const textLayer = this.#textLayer ? text : null;
    const annotationLayer = this.#annotationLayer ? annotations : null;
    const scheduler = this.#scheduler;
    if (scheduler) scheduler.attach(index, base, detail, textLayer, annotationLayer);
    else this.#pendingPages.set(index, [base, detail, textLayer, annotationLayer]);
    return () => {
      this.#pendingPages.delete(index);
      if (this.#scheduler === scheduler) scheduler?.detach(index);
    };
  }

  hasPixels(index: number): boolean {
    return this.#scheduler?.hasPixels(index) ?? false;
  }

  /** Fraction of the viewport covered by pages that show no pixels yet. */
  blankFraction(): number {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller || scroller.clientHeight === 0) return 0;
    const top = scroller.scrollTop;
    const bottom = top + scroller.clientHeight;
    const { first, last } = visibleRange(layout, top, scroller.clientHeight);
    let blank = 0;
    for (let index = first; index <= last; index++) {
      if (this.hasPixels(index)) continue;
      const pageTop = layout.tops[index] ?? 0;
      const pageBottom = pageTop + (layout.heights[index] ?? 0);
      const visibleHeight = Math.max(0, Math.min(bottom, pageBottom) - Math.max(top, pageTop));
      const visibleWidth = Math.min(layout.widths[index] ?? 0, scroller.clientWidth);
      blank += visibleHeight * visibleWidth;
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
    const { first, last } = visibleRange(layout, viewport.top, viewport.height);
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

  goToPage(index: number): void {
    const layout = this.store.get().layout;
    if (!layout || !this.#scroller) return;
    const target = clamp(index, 0, layout.tops.length - 1);
    this.#scroller.scrollTop = (layout.tops[target] ?? 0) - layout.gap;
  }

  /**
   * Follow an internal link or outline entry. The position before the jump
   * is remembered for `back()`. Resolves to false when the target is invalid.
   */
  async goToDestination(dest: DestinationRef): Promise<boolean> {
    const doc = this.#doc;
    if (!doc) return false;
    const target = await doc.resolveDestination(dest).catch(() => null);
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!target || !layout || !scroller || this.#doc !== doc) return false;
    if (target.pageIndex < 0 || target.pageIndex >= layout.tops.length) return false;
    this.#remember();
    const pageTop = layout.tops[target.pageIndex] ?? 0;
    // The engine reports the point on the unturned page; a quarter turn makes
    // its left coordinate the vertical one.
    const size = layout.sizes[target.pageIndex] ?? { width: 0, height: 0 };
    const point = turnBox(
      { x: target.x ?? 0, y: target.y ?? 0, width: 0, height: 0 },
      size,
      layout.rotation,
    );
    const quarter = layout.rotation % 180 !== 0;
    const hasTop = (quarter ? target.x : target.y) !== null;
    const hasLeft = (quarter ? target.y : target.x) !== null;
    // An explicit top lands at the top edge of the viewport, as in other PDF readers.
    scroller.scrollTop = hasTop ? pageTop + point.y * layout.scale : pageTop - layout.gap;
    if (hasLeft) {
      const left =
        pageLeft(layout, target.pageIndex, scroller.clientWidth) + point.x * layout.scale;
      if (left < scroller.scrollLeft || left > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = left;
      }
    }
    return true;
  }

  /** Return to the position before the most recent link or outline jump. */
  back(): void {
    const entry = this.#history.pop();
    this.store.set({ canGoBack: this.#history.length > 0 });
    const layout = this.store.get().layout;
    if (!entry || !layout || !this.#scroller) return;
    const top = layout.tops[entry.pageIndex] ?? 0;
    this.#scroller.scrollTop = top + entry.offset * (layout.heights[entry.pageIndex] ?? 0);
  }

  /** Save the viewport's top as a page and fraction, which survive zoom changes. */
  #remember(): void {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    const pageIndex = pageAt(layout, scroller.scrollTop);
    const offset =
      (scroller.scrollTop - (layout.tops[pageIndex] ?? 0)) / (layout.heights[pageIndex] || 1);
    this.#history.push({ pageIndex, offset });
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    this.store.set({ canGoBack: true });
  }

  #namedAction(action: string): void {
    const { currentPage, pageCount } = this.store.get();
    switch (action) {
      case "NextPage":
        this.goToPage(currentPage + 1);
        break;
      case "PrevPage":
        this.goToPage(currentPage - 1);
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
    // Keep the page at the viewport's center at the same share of its height.
    const y = scroller.clientHeight / 2;
    const docY = scroller.scrollTop + y;
    const page = pageAt(layout, docY);
    const withinPage = (docY - (layout.tops[page] ?? 0)) / (layout.heights[page] || 1);
    const next = this.#applyLayout(this.#layoutAt(layout.scale));
    scroller.scrollTop = (next.tops[page] ?? 0) + withinPage * (next.heights[page] ?? 0) - y;
    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    this.#scheduler?.rotate(turned);
    this.#update();
    // A turned page has another width to fit.
    this.#fitWidth();
  }

  /**
   * Change the zoom level, keeping the point under `anchor` (viewport
   * coordinates, default center) in place. "fit-width" fits the width of the
   * page at the viewport's center and keeps fitting it as the viewport
   * resizes or the view turns, like pdf.js's "page-width"; a number stops
   * that.
   */
  setScale(requested: number | "fit-width", anchor?: { x: number; y: number }): void {
    this.#finishZoom();
    if (requested === "fit-width") {
      this.store.set({ zoomMode: "fit-width" });
      this.#fitWidth();
      return;
    }
    this.store.set({ zoomMode: "custom" });
    this.#zoomTo(requested, anchor);
  }

  /** Fit the page at the viewport's center to the viewport's width, in "fit-width" mode only. */
  #fitWidth(): void {
    const scroller = this.#scroller;
    const state = this.store.get();
    if (state.zoomMode !== "fit-width" || !scroller || scroller.clientWidth === 0) return;
    const size = this.#sizes[state.currentPage] ?? this.#sizes[0];
    const width = size ? turnedSize(size, state.rotation).width : 0;
    if (width === 0) return;
    this.#fittedWidth = scroller.clientWidth;
    this.#zoomTo((scroller.clientWidth - 2 * this.#gap) / width);
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
    const at = {
      x: anchor?.x ?? scroller.clientWidth / 2,
      y: anchor?.y ?? scroller.clientHeight / 2,
    };
    const target = this.#placeZoom(
      scroller,
      layout,
      scale,
      at,
      point ?? { x: scroller.scrollLeft + at.x, y: scroller.scrollTop + at.y },
    );
    this.#applyLayout(target.layout);
    // The content is resized imperatively, so the scroll position can be
    // restored before React re-renders the mounted pages.
    scroller.scrollTop = target.top;
    scroller.scrollLeft = target.left;
    this.store.set({ scale });
    this.#update();
  }

  /**
   * Where zooming `layout` to `scale` scrolls so that the content point
   * `point` lands under the viewport point `anchor`, keeping its share of the
   * same page. The browser clamps that position to the new scroll range;
   * `maxLeft` and `maxTop` say where it ends.
   */
  #placeZoom(
    scroller: HTMLElement,
    layout: Layout,
    scale: number,
    anchor: { x: number; y: number },
    point: { x: number; y: number },
  ): { layout: Layout; left: number; top: number; maxLeft: number; maxTop: number } {
    const page = pageAt(layout, point.y);
    const viewportWidth = scroller.clientWidth;
    const withinX = (point.x - pageLeft(layout, page, viewportWidth)) / (layout.widths[page] || 1);
    const withinY = (point.y - (layout.tops[page] ?? 0)) / (layout.heights[page] || 1);
    const next = Math.abs(scale - layout.scale) < 1e-4 ? layout : this.#layoutAt(scale);
    return {
      layout: next,
      left: pageLeft(next, page, viewportWidth) + withinX * (next.widths[page] ?? 0) - anchor.x,
      top: (next.tops[page] ?? 0) + withinY * (next.heights[page] ?? 0) - anchor.y,
      // The content is at least as wide as the viewport (`max(100%, …)`).
      maxLeft: Math.max(0, next.totalWidth - viewportWidth),
      maxTop: Math.max(0, next.totalHeight - scroller.clientHeight),
    };
  }

  /**
   * Search the whole document. Results arrive progressively; the first match
   * at or after the current page is selected and scrolled into view.
   */
  search(query: string): void {
    const generation = ++this.#searchGeneration;
    this.#highlights.clear();
    const normalized = normalizeQuery(query);
    const doc = this.#doc;
    if (!normalized || !doc) {
      this.store.set({ search: { ...IDLE_SEARCH, query } });
      return;
    }
    this.store.set({
      search: { query, status: "searching", matches: [], current: -1, pagesSearched: 0 },
    });
    this.#runSearch(doc, query, normalized, generation).catch((error: unknown) => {
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
    generation: number,
  ): Promise<void> {
    const matches: SearchMatch[] = [];
    const startPage = this.store.get().currentPage;
    let current = -1;
    let pagesSearched = 0;
    let publishedAt = performance.now();
    const publish = (status: SearchState["status"]) => {
      this.store.set({
        search: { query, status, matches: [...matches], current, pagesSearched },
      });
      this.#refreshHighlights();
    };
    for (let page = 0; page < doc.pageCount; page++) {
      const index = await this.#pageIndex(doc, page);
      if (generation !== this.#searchGeneration) return;
      const found = findMatches(index, normalized, page);
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

  #pageIndex(doc: PdfEngineDocument, pageIndex: number): Promise<PageIndex> {
    let index = this.#indexes.get(pageIndex);
    if (!index) {
      index = doc.getText(pageIndex).then(buildPageIndex);
      this.#indexes.set(pageIndex, index);
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

  /** Scroll so a match sits in the upper third of the viewport. */
  async #scrollToMatch(match: SearchMatch): Promise<void> {
    const doc = this.#doc;
    if (!doc) return;
    const text = await doc.getText(match.pageIndex);
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller || this.#doc !== doc) return;
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
    const x = box.x * layout.scale;
    const y = box.y * layout.scale;
    scroller.scrollTop = (layout.tops[match.pageIndex] ?? 0) + y - scroller.clientHeight / 3;
    const left = pageLeft(layout, match.pageIndex, scroller.clientWidth) + x;
    if (left < scroller.scrollLeft || left > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = left - scroller.clientWidth / 3;
    }
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
    return this.#initialScale === "fit-width" ? "fit-width" : "custom";
  }

  #resolveInitialScale(firstPage: PageSize): number {
    if (typeof this.#initialScale === "number") return this.#initialScale;
    const width = this.#scroller?.clientWidth ?? 0;
    if (width === 0 || firstPage.width === 0) return 1;
    this.#fittedWidth = width;
    return clamp((width - 2 * this.#gap) / firstPage.width, this.#minScale, this.#maxScale);
  }

  #layoutAt(scale: number): Layout {
    return computeLayout(this.#sizes, scale, this.#gap, this.store.get().rotation);
  }

  #applyLayout(layout: Layout): Layout {
    this.#sizeContent(layout);
    this.store.set({ layout });
    return layout;
  }

  #sizeContent(layout: Layout): void {
    if (!this.#content) return;
    this.#content.style.height = `${layout.totalHeight}px`;
    this.#content.style.width = `max(100%, ${layout.totalWidth}px)`;
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
    const anchorPage = layout && scroller ? pageAt(layout, scroller.scrollTop) : 0;
    const offset = layout && scroller ? scroller.scrollTop - (layout.tops[anchorPage] ?? 0) : 0;
    this.#sizes = sizes;
    const next = this.#applyLayout(this.#layoutAt(this.store.get().scale));
    if (scroller) scroller.scrollTop = (next.tops[anchorPage] ?? 0) + offset;
    this.#update();
    // The page at the center may turn out wider or narrower than the first.
    this.#fitWidth();
  }

  #onResize = (): void => {
    const scroller = this.#scroller;
    if (
      scroller &&
      scroller.clientWidth !== this.#fittedWidth &&
      this.store.get().zoomMode === "fit-width"
    ) {
      this.#finishZoom();
      this.#fitWidth();
    }
    this.#requestUpdate();
  };

  #onScroll = (): void => {
    const scroller = this.#scroller;
    if (!scroller) return;
    const now = performance.now();
    const elapsed = now - this.#lastScrollAt;
    if (elapsed > 0) {
      const instant = (scroller.scrollTop - this.#lastTop) / elapsed;
      this.#velocity = elapsed > SETTLE_DELAY ? instant : this.#velocity * 0.6 + instant * 0.4;
    }
    this.#lastTop = scroller.scrollTop;
    this.#lastScrollAt = now;
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
      translateX: 0,
      translateY: 0,
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
   * Preview a gesture on the compositor; layout and rendering wait for the
   * commit. The preview shows the gesture's point where the commit will put
   * it: where the new scroll range ends, or a page narrower than the viewport
   * centers, the point cannot stay under the fingers, and showing it there
   * anyway made it jump when they lifted.
   */
  #previewZoom(zoom: ZoomGesture): void {
    const scroller = this.#scroller;
    const content = this.#content;
    const layout = this.store.get().layout;
    if (!scroller || !content || !layout) return;
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    const target = this.#placeZoom(
      scroller,
      layout,
      clamp(layout.scale * zoom.factor, this.#minScale, this.#maxScale),
      { x: zoom.originX + zoom.panX - left, y: zoom.originY + zoom.panY - top },
      { x: zoom.originX, y: zoom.originY },
    );
    zoom.translateX = zoom.panX + target.left - clamp(target.left, 0, target.maxLeft);
    zoom.translateY = zoom.panY + target.top - clamp(target.top, 0, target.maxTop);
    content.style.transformOrigin = `${zoom.originX}px ${zoom.originY}px`;
    content.style.transform = `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.factor})`;
    // Mount and draw the pages the preview brings into view.
    this.#requestUpdate();
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
      // Settled again, also when the drag ends where it started.
      this.#requestUpdate();
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
    let top = scroller.scrollTop;
    let height = scroller.clientHeight;
    const zoom = this.#zoom;
    if (zoom) {
      // A preview shows another band of the content: the viewport mapped back
      // through its transform. Pages a two-finger drag or a zoom out brings
      // into view mount and render before the commit, not after it.
      const shownY = zoom.originY - top + zoom.translateY;
      top = zoom.originY - shownY / zoom.factor;
      height /= zoom.factor;
    }
    const { first, last } = visibleRange(layout, top, height);
    const lastIndex = layout.tops.length - 1;
    const focus = pageAt(layout, top + height / 2);
    // Publishing is cheap when nothing changed: the store ignores equal values.
    this.store.set({
      first: Math.max(0, first - this.#overscan),
      last: Math.min(lastIndex, last + this.#overscan),
      currentPage: focus,
    });
    const quiet = performance.now() - this.#lastScrollAt > SETTLE_DELAY;
    // Full resolution for the scale a preview leaves would be redrawn at the commit.
    const settled =
      (quiet || Math.abs(this.#velocity) < SETTLE_VELOCITY) && (zoom?.factor ?? 1) === 1;
    this.#scheduler?.update({
      layout,
      first,
      last,
      focus,
      viewport: viewportOf(scroller),
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
