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
/** A ctrl/pinch wheel gesture commits this long after its last event. */
const ZOOM_COMMIT_DELAY = 150;
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
  readonly #links: LinkHandlers = {
    navigate: (dest) => void this.goToDestination(dest),
    namedAction: (action) => this.#namedAction(action),
  };
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
  #zoom: { factor: number; x: number; y: number; timer: number } | null = null;
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
        this.#applyLayout(scale);
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
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    this.#requestUpdate();
    return () => {
      scroller.removeEventListener("scroll", this.#onScroll);
      scroller.removeEventListener("wheel", this.#onWheel);
      resize.disconnect();
      if (this.#frame) cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (this.#scroller === scroller) {
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
    this.setScale(this.store.get().scale * factor);
  }

  /** Turn every page by `degrees`, a multiple of 90: clockwise when positive. */
  rotate(degrees = 90): void {
    this.setRotation((this.store.get().rotation + degrees) as Rotation);
  }

  /** Show every page turned clockwise by `rotation` degrees. */
  setRotation(rotation: Rotation): void {
    const turned = ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as Rotation;
    const state = this.store.get();
    if (turned === state.rotation) return;
    const layout = state.layout;
    const scroller = this.#scroller;
    this.store.set({ rotation: turned });
    if (!layout || !scroller) return;
    // Keep the page at the viewport's center at the same share of its height.
    const y = scroller.clientHeight / 2;
    const docY = scroller.scrollTop + y;
    const page = pageAt(layout, docY);
    const withinPage = (docY - (layout.tops[page] ?? 0)) / (layout.heights[page] || 1);
    const next = this.#applyLayout(layout.scale);
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

  #zoomTo(requested: number, anchor?: { x: number; y: number }): void {
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
    const docY = scroller.scrollTop + y;
    const page = pageAt(layout, docY);
    const withinPage = (docY - (layout.tops[page] ?? 0)) / (layout.heights[page] || 1);
    const ratioX = (scroller.scrollLeft + x) / Math.max(1, scroller.scrollWidth);
    const next = this.#applyLayout(scale);
    // The content is resized imperatively, so the scroll position can be
    // restored before React re-renders the mounted pages.
    scroller.scrollTop = (next.tops[page] ?? 0) + withinPage * (next.heights[page] ?? 0) - y;
    scroller.scrollLeft = ratioX * scroller.scrollWidth - x;
    this.store.set({ scale });
    this.#update();
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

  #applyLayout(scale: number): Layout {
    const layout = computeLayout(this.#sizes, scale, this.#gap, this.store.get().rotation);
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
    const scroller = this.#scroller;
    const layout = this.store.get().layout;
    const anchorPage = layout && scroller ? pageAt(layout, scroller.scrollTop) : 0;
    const offset = layout && scroller ? scroller.scrollTop - (layout.tops[anchorPage] ?? 0) : 0;
    this.#sizes = sizes;
    const next = this.#applyLayout(this.store.get().scale);
    if (scroller) scroller.scrollTop = (next.tops[anchorPage] ?? 0) + offset;
    this.#update();
    // The page at the center may turn out wider or narrower than the first.
    this.#fitWidth();
  }

  #onResize = (): void => {
    const scroller = this.#scroller;
    if (scroller && scroller.clientWidth !== this.#fittedWidth) this.#fitWidth();
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
    const scroller = this.#scroller;
    const content = this.#content;
    if (!scroller || !content) return;
    event.preventDefault();
    const rect = scroller.getBoundingClientRect();
    const scale = this.store.get().scale;
    const zoom = this.#zoom ?? {
      factor: 1,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      timer: 0,
    };
    this.#zoom = zoom;
    zoom.factor = clamp(
      zoom.factor * Math.exp(-event.deltaY * 0.01),
      this.#minScale / scale,
      this.#maxScale / scale,
    );
    // Preview the gesture on the compositor; layout and rendering wait for the commit.
    content.style.transformOrigin = `${scroller.scrollLeft + zoom.x}px ${scroller.scrollTop + zoom.y}px`;
    content.style.transform = `scale(${zoom.factor})`;
    clearTimeout(zoom.timer);
    zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
  };

  #commitZoom = (): void => {
    const zoom = this.#zoom;
    this.#zoom = null;
    if (!zoom) return;
    if (this.#content) this.#content.style.transform = "";
    this.setScale(this.store.get().scale * zoom.factor, { x: zoom.x, y: zoom.y });
  };

  #requestUpdate(): void {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#update);
  }

  #update = (): void => {
    this.#frame = 0;
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return;
    const top = scroller.scrollTop;
    const height = scroller.clientHeight;
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
    const settled = quiet || Math.abs(this.#velocity) < SETTLE_VELOCITY;
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
