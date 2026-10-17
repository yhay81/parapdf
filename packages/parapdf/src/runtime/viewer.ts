import type {
  PageSize,
  PdfEngine,
  PdfEngineDocument,
  PdfSource,
  TextLayerHandle,
} from "../engine/types.ts";
import { SearchHighlights } from "./highlights.ts";
import { computeLayout, type Layout, pageAt, visibleRange } from "./layout.ts";
import { RenderScheduler, type SchedulerStats } from "./scheduler.ts";
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
  search: SearchState;
}

export interface ViewerOptions {
  /** Space between pages in CSS pixels. */
  gap?: number;
  /** Pages mounted beyond each edge of the viewport. */
  overscan?: number;
  maxConcurrentRenders?: number;
  initialScale?: number | "fit-width";
  minScale?: number;
  maxScale?: number;
  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
}

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

const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

type PageElements = [HTMLCanvasElement, HTMLCanvasElement, HTMLElement | null];

/**
 * The imperative core behind the React components. It owns scrolling, layout,
 * zoom, search, and the render scheduler; React only re-renders when the
 * published store fields change.
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
    search: IDLE_SEARCH,
  });
  readonly #engine: PdfEngine;
  readonly #gap: number;
  readonly #overscan: number;
  readonly #maxConcurrentRenders: number;
  readonly #initialScale: number | "fit-width";
  readonly #minScale: number;
  readonly #maxScale: number;
  readonly #textLayer: boolean;
  readonly #highlights = new SearchHighlights();
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

  constructor(engine: PdfEngine, options: ViewerOptions = {}) {
    this.#engine = engine;
    this.#gap = options.gap ?? 12;
    this.#overscan = options.overscan ?? 2;
    this.#maxConcurrentRenders = options.maxConcurrentRenders ?? 2;
    this.#initialScale = options.initialScale ?? "fit-width";
    this.#minScale = options.minScale ?? 0.25;
    this.#maxScale = options.maxScale ?? 6;
    this.#textLayer = options.textLayer ?? true;
  }

  get engineName(): string {
    return this.#engine.name;
  }

  get textLayer(): boolean {
    return this.#textLayer;
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

  /** Open a document and return the function that closes it. */
  open(source: PdfSource): () => void {
    const generation = ++this.#generation;
    let doc: PdfEngineDocument | null = null;
    let closed = false;
    this.#firstPaintAt = null;
    this.store.set({ status: "loading", error: null, search: IDLE_SEARCH });

    void (async () => {
      try {
        const opened = await this.#engine.open(source);
        if (closed) {
          // Closed while loading: nobody else will release this document.
          void opened.destroy();
          return;
        }
        doc = opened;
        const firstSize = await doc.pageSize(0);
        if (closed) return;
        this.#doc = doc;
        // Assume every page matches the first until the background pass knows better.
        this.#sizes = Array.from({ length: doc.pageCount }, () => firstSize);
        this.#scheduler = new RenderScheduler(doc, {
          maxConcurrent: this.#maxConcurrentRenders,
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
        for (const [index, [base, detail, text]] of this.#pendingPages) {
          this.#scheduler.attach(index, base, detail, text);
        }
        this.#pendingPages.clear();
        const scale = this.#resolveInitialScale(firstSize);
        this.#applyLayout(scale);
        this.store.set({ status: "ready", pageCount: doc.pageCount, scale });
        this.#update();
        void this.#refineSizes(doc, generation);
      } catch (error) {
        if (!closed) this.store.set({ status: "error", error: String(error) });
      }
    })();

    return () => {
      closed = true;
      if (this.#generation === generation) {
        this.#searchGeneration++;
        this.#highlights.clear();
        this.#textPages.clear();
        this.#indexes.clear();
        this.#doc = null;
        this.#scheduler = null;
        this.store.set({
          status: "idle",
          pageCount: 0,
          layout: null,
          first: 0,
          last: -1,
          search: IDLE_SEARCH,
        });
      }
      // A document still loading is destroyed by the loader once it resolves.
      void doc?.destroy();
    };
  }

  /** Bind the scroll container and its sized content element. */
  attachViewport(scroller: HTMLElement, content: HTMLElement): () => void {
    this.#scroller = scroller;
    this.#content = content;
    const layout = this.store.get().layout;
    if (layout) this.#sizeContent(layout);
    // While a pointer drags inside a text layer, pdf.js's CSS stretches the
    // layer's end element over the page so the selection does not jump.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      target?.closest(".parapdf-text-layer")?.classList.add("selecting");
    };
    const onPointerUp = () => {
      for (const layer of scroller.querySelectorAll(".parapdf-text-layer.selecting")) {
        layer.classList.remove("selecting");
      }
    };
    scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    scroller.addEventListener("wheel", this.#onWheel, { passive: false });
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    const resize = new ResizeObserver(() => this.#requestUpdate());
    resize.observe(scroller);
    this.#requestUpdate();
    return () => {
      scroller.removeEventListener("scroll", this.#onScroll);
      scroller.removeEventListener("wheel", this.#onWheel);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
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
  ): () => void {
    const layer = this.#textLayer ? text : null;
    const scheduler = this.#scheduler;
    if (scheduler) scheduler.attach(index, base, detail, layer);
    else this.#pendingPages.set(index, [base, detail, layer]);
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

  goToPage(index: number): void {
    const layout = this.store.get().layout;
    if (!layout || !this.#scroller) return;
    const target = clamp(index, 0, layout.tops.length - 1);
    this.#scroller.scrollTop = (layout.tops[target] ?? 0) - layout.gap;
  }

  zoomBy(factor: number): void {
    this.setScale(this.store.get().scale * factor);
  }

  /**
   * Change the zoom level, keeping the point under `anchor` (viewport
   * coordinates, default center) in place.
   */
  setScale(requested: number, anchor?: { x: number; y: number }): void {
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
    void this.#runSearch(doc, query, normalized, generation);
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
        if (select && match) void this.#scrollToMatch(match);
        publishedAt = now;
        await yieldToMain();
        if (generation !== this.#searchGeneration) return;
      }
    }
    if (current === -1 && matches.length > 0) {
      current = 0;
      const match = matches[0];
      if (match) void this.#scrollToMatch(match);
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
    void this.#scrollToMatch(match);
  }

  /** Scroll so a match sits in the upper third of the viewport. */
  async #scrollToMatch(match: SearchMatch): Promise<void> {
    const doc = this.#doc;
    if (!doc) return;
    const text = await doc.getText(match.pageIndex);
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller || this.#doc !== doc) return;
    const box = match.start.item * 4;
    const x = (text.boxes[box] ?? 0) * layout.scale;
    const y = (text.boxes[box + 1] ?? 0) * layout.scale;
    scroller.scrollTop = (layout.tops[match.pageIndex] ?? 0) + y - scroller.clientHeight / 3;
    const contentWidth = Math.max(scroller.clientWidth, layout.totalWidth);
    const left = (contentWidth - (layout.widths[match.pageIndex] ?? 0)) / 2 + x;
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

  #resolveInitialScale(firstPage: PageSize): number {
    if (typeof this.#initialScale === "number") return this.#initialScale;
    const width = this.#scroller?.clientWidth ?? 0;
    if (width === 0 || firstPage.width === 0) return 1;
    return clamp((width - 2 * this.#gap) / firstPage.width, this.#minScale, this.#maxScale);
  }

  #applyLayout(scale: number): Layout {
    const layout = computeLayout(this.#sizes, scale, this.#gap);
    this.#sizeContent(layout);
    this.store.set({ layout });
    return layout;
  }

  #sizeContent(layout: Layout): void {
    if (!this.#content) return;
    this.#content.style.height = `${layout.totalHeight}px`;
    this.#content.style.width = `max(100%, ${layout.totalWidth}px)`;
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
  }

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
