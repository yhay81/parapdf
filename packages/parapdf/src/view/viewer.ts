"use client";

import { documentOf, type PdfSession } from "../document/pdf-session.ts";
import type { DocumentSession, PageSize, PdfPermissions } from "../document/session.ts";
import type { LinkHandlers } from "../pdfjs/annotation-layer.ts";
import type { Destination, ResolvedDestination } from "../pdfjs/destinations.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import type { AnnotationEditor } from "../pdfjs/editor.ts";
import type { LayerState } from "../pdfjs/layers.ts";
import type { TextLayerHandle } from "../pdfjs/text.ts";
import { Renderer, type RenderStats } from "../render/renderer.ts";
import { TextSelectionTracker } from "../render/selection.ts";
import { downloadBytes, filenameFromUrl } from "./files.ts";
import { CONTROLS, ViewerGestures } from "./gestures.ts";
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
import { rendererChanged, rendererOptions, type ShownView, type ViewerOptions } from "./options.ts";
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
import { linked } from "./signals.ts";
import { type PointerTool, ViewerStore, type ZoomMode } from "./state.ts";

/**
 * Where a viewer shows its document, to come back to: the page at the
 * viewport's top-left corner, where that corner is as a share of the page,
 * the current page, and the zoom.
 */
export interface ViewerPosition {
  pageIndex: number;
  x: number;
  y: number;
  current: number;
  scale: number;
  zoomMode: ZoomMode;
}

/**
 * What a feature hears from a viewer, registered with `extend()`. Every hook
 * is optional; the viewer knows no feature by name.
 */
export interface ViewerExtension {
  /**
   * The document is open, its permissions published, and its pages are
   * about to be laid out and drawn: a feature that changes how they are
   * drawn says so here. Called at once by `extend()` once the document is ready.
   */
  prepare?(session: DocumentSession, signal: AbortSignal): void;
  /**
   * The document is ready in this viewer, again after a viewport
   * reattaches; `signal` aborts when the document closes or the viewport
   * detaches. Called at once by `extend()` once the document is ready.
   */
  ready?(session: DocumentSession, signal: AbortSignal): void;
  /**
   * A viewport attached; `signal` aborts when it detaches. Called at once by
   * `extend()` while one is attached.
   */
  viewport?(scroller: HTMLElement, content: HTMLElement, signal: AbortSignal): void;
  /** The viewport is about to detach, its pages still in place. */
  detaching?(): void;
  /**
   * The document is closing, its pages still in place: what was kept for it
   * goes. The `ready` signal aborts right after.
   */
  closed?(): void;
  /** A page's text layer was built, or, with null, removed. */
  textLayer?(pageIndex: number, handle: TextLayerHandle | null): void;
  /** A link, outline entry, or named action is about to jump. */
  jumping?(): void;
  /** A link's named action the viewer does not carry out itself, such as "GoBack". */
  namedAction?(action: string): void;
  /** A viewer of the document showed or hid layers: drawings are stale. */
  layersChanged?(): void;
}

/** What Ctrl or ⌘ with + and - zooms by. */
const ZOOM_STEP = 1.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether a visible area is all of its page. */
const whole = (area: PageArea | null): boolean =>
  area !== null && area.minX === 0 && area.minY === 0 && area.maxX === 1 && area.maxY === 1;

/** Opens a session in a viewer; the React bindings' to call (`openViewer()`). */
let open: (viewer: Viewer, session: PdfSession) => void;
/** Closes what a viewer shows; see `closeViewer()`. */
let close: (viewer: Viewer) => void;
/** Sets a viewer's options; see `setViewerOptions()`. */
let configure: (viewer: Viewer, options: ViewerOptions) => void;
/** Binds a viewport; see `attachViewport()`. */
let bindViewport: (viewer: Viewer, scroller: HTMLElement, content: HTMLElement) => () => void;
/** Registers a page's host; see `attachPage()`. */
let bindPage: (viewer: Viewer, index: number, host: HTMLElement) => () => void;

/**
 * One viewport onto a shared document session: layout, gestures,
 * navigation, and the viewport's lifetime. Features (search, history,
 * forms, annotation editing, and the rest) attach through `extend()`.
 */
export class Viewer {
  static {
    open = (viewer, session) => viewer.#open(session);
    close = (viewer) => viewer.#close?.();
    configure = (viewer, options) => viewer.#configure(options);
    bindViewport = (viewer, scroller, content) => viewer.#attachViewport(scroller, content);
    bindPage = (viewer, index, host) => viewer.#attachPage(index, host);
  }

  readonly store = new ViewerStore({
    layout: null,
    first: 0,
    last: -1,
    currentPage: 0,
    scale: 1,
    zoomMode: "fit-width",
    tool: "select",
    rotation: 0,
    spread: "none",
    scrollMode: "vertical",
  });
  /** The options as set, which the renderer and the next opening read. */
  #options: ViewerOptions = {};
  #gap = 12;
  #overscan = 2;
  #destinationZoom = true;
  #minScale = 0.25;
  #maxScale = 10;
  readonly #links: LinkHandlers = {
    navigate: (dest) => void this.goToDestination(dest),
    namedAction: (action) => this.#namedAction(action),
    externalLinks: "new-tab",
    openAttachment: (file) => this.openFile(file),
    setLayers: (action) => this.#layers?.apply(action),
  };
  /** What the features attached hear. */
  readonly #extensions = new Set<ViewerExtension>();
  /** Features still loading, which the first layout of a document waits for. */
  readonly #deferred = new Set<Promise<unknown>>();
  /** Whether annotation layers show form fields (`setFormLayers()`). */
  #formLayers = false;
  /** The annotation editor a feature gave, whose layers pages get. */
  #annotationEditor: AnnotationEditor | null = null;
  /** A feature took the pointer, which the hand tool then leaves alone. */
  #pointerClaimed = false;
  readonly #selection = new TextSelectionTracker();
  /** Which of the open document's layers show, in every viewer of it. */
  #layers: LayerState | null = null;
  /**
   * The session this viewer shows, from `openViewer()` until it closes:
   * its signal stops what this viewer started for the document.
   */
  #pdf: PdfSession | null = null;
  /** The viewport's lifetime, independent of the document and other viewers. */
  #viewportControl = new AbortController();
  /** Work for this viewport and its document; either ending aborts it. */
  #work: AbortController | null = null;
  /** Where a viewport that detached showed the document, for the next one. */
  #savedPosition: ViewerPosition | null = null;
  /** The work of the load whose `ready` hooks ran, which `extend()` replays. */
  #ready: AbortSignal | null = null;

  /** Aborted while no viewport is attached. */
  get signal(): AbortSignal {
    return this.#viewportControl.signal;
  }
  /** Closes the open document. */
  #close: (() => void) | null = null;
  /** The open document, once it has loaded. */
  #session: DocumentSession | null = null;
  /** What the open document permits, once it has loaded. */
  #permissions: PdfPermissions | null = null;
  /** The file name the open document's URL gives, for download(). */
  #sourceName: string | null = null;
  #renderer: Renderer | null = null;
  #sizes: PageSize[] = [];
  /** The hosts of the mounted pages, by page. */
  #pageHosts = new Map<number, HTMLElement>();
  #textPages = new Map<number, TextLayerHandle>();
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
    pointerClaimed: () => this.#pointerClaimed,
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

  constructor(options: ViewerOptions = {}) {
    this.#configure(options);
    this.#resetView();
  }

  /**
   * Take `options` from now on. Options the renderer is built with build it
   * again, as a viewport that detaches and attaches again would, keeping
   * the position and the edits; the initial ones and the opening apply as
   * the next document opens; the others apply at once.
   */
  #configure(options: ViewerOptions): void {
    const previous = this.#options;
    this.#options = options;
    this.#links.externalLinks = options.externalLinks ?? "new-tab";
    this.#destinationZoom = options.destinationZoom ?? true;
    this.#minScale = options.minScale ?? 0.25;
    this.#maxScale = options.maxScale ?? 10;
    const gap = options.gap ?? 12;
    const overscan = options.overscan ?? 2;
    const arranged = gap !== this.#gap || overscan !== this.#overscan;
    this.#gap = gap;
    this.#overscan = overscan;
    const layout = this.store.get().layout;
    if (!layout) return;
    if (rendererChanged(previous, options)) {
      this.#rebuild();
      return;
    }
    if (arranged) {
      this.#gestures.finish();
      this.#arrange(this.store.get().currentPage);
    }
    const { scale } = this.store.get();
    if (scale < this.#minScale || scale > this.#maxScale) this.setScale(scale);
  }

  /** The view a document opens with, before its opening applies. */
  #resetView(): void {
    const options = this.#options;
    this.store.set({
      currentPage: 0,
      zoomMode: this.#initialZoomMode(),
      tool: options.initialTool ?? "select",
      rotation: options.initialRotation ?? 0,
      spread: options.initialSpread ?? "none",
      scrollMode: options.initialScrollMode ?? "vertical",
    });
  }

  get textLayer(): boolean {
    return this.#options.textLayer ?? true;
  }

  get annotationLayer(): boolean {
    return this.#options.annotationLayer ?? true;
  }

  get #initialScale(): number | "fit-width" | "fit-page" {
    return this.#options.initialScale ?? "fit-width";
  }

  get #initialPage(): number {
    return this.#options.initialPage ?? 0;
  }

  get scroller(): HTMLElement | null {
    return this.#scroller;
  }

  /** The element that holds the pages, while a viewport is attached. */
  get content(): HTMLElement | null {
    return this.#content;
  }

  /** The open document's session, once it has loaded. */
  get session(): DocumentSession | null {
    return this.#session;
  }

  /**
   * What the open document permits, everything when it is not encrypted;
   * null until it has loaded. Read before its first layout, for features
   * that follow it.
   */
  get permissions(): PdfPermissions | null {
    return this.#permissions;
  }

  /**
   * What this viewer does for its open document stops with it: it aborts
   * when the document closes or the viewport detaches. Null while no
   * document is open.
   */
  get workSignal(): AbortSignal | null {
    return this.#work?.signal ?? null;
  }

  /** The renderer of the open document's pages, once it has loaded. */
  get renderer(): Renderer | null {
    return this.#renderer;
  }

  /** Which of the open document's layers show, once known. */
  get layers(): LayerState | null {
    return this.#layers;
  }

  /** The text layers of the mounted pages that have one, by page. */
  get textLayers(): ReadonlyMap<number, TextLayerHandle> {
    return this.#textPages;
  }

  /** The colors pages are drawn in instead of their own (`pageColors`). */
  get pageColors(): PageColors | undefined {
    return this.#options.pageColors;
  }

  /** The file name the open document's URL gives; null for bytes. */
  get sourceName(): string | null {
    return this.#sourceName;
  }

  /** Render counters for the current document. */
  get stats(): RenderStats | null {
    return this.#renderer?.stats ?? null;
  }

  /** Pixels of the canvases kept from pages that left the mounted window (`maxKeptPixels`). */
  get keptPixels(): number {
    return this.#renderer?.keptPixels ?? 0;
  }

  /** `performance.now()` when the first page first showed pixels. */
  get firstPaintAt(): number | null {
    return this.#firstPaintAt;
  }

  /**
   * Register what a feature hears from this viewer; returns the function
   * that removes it. Hooks for what already happened are called at once:
   * `prepare` and `ready` for a ready document, `viewport` for an attached
   * viewport.
   */
  extend(extension: ViewerExtension): () => void {
    this.#extensions.add(extension);
    const session = this.#session;
    const ready = this.#ready;
    if (session && ready && !ready.aborted) {
      extension.prepare?.(session, ready);
      extension.ready?.(session, ready);
    }
    if (this.#scroller && this.#content) {
      extension.viewport?.(this.#scroller, this.#content, this.#viewportControl.signal);
    }
    return () => {
      this.#extensions.delete(extension);
    };
  }

  /**
   * Make the next document's first layout wait for `loading`, a feature
   * loading for this viewer that changes how pages are drawn.
   */
  defer(loading: Promise<unknown>): void {
    const waiting = loading
      .catch((error: unknown) => console.error("loading a feature failed", error))
      .finally(() => this.#deferred.delete(waiting));
    this.#deferred.add(waiting);
  }

  /**
   * Show form fields as HTML the reader fills in, in the annotation layers,
   * instead of drawing them: pages already drawn are drawn again.
   */
  setFormLayers(enabled: boolean): void {
    this.#formLayers = enabled;
    this.#renderer?.setForms(enabled);
  }

  /**
   * Build the layers of the annotations `editor` edits on the mounted pages
   * that have an editor container, or, with null, take them down.
   */
  setAnnotationEditor(editor: AnnotationEditor | null): void {
    this.#annotationEditor = editor;
    this.#renderer?.setAnnotationEditor(editor);
  }

  /** While claimed, a mouse drag is a feature's, such as an annotation tool's, not the hand tool's. */
  claimPointer(claimed: boolean): void {
    this.#pointerClaimed = claimed;
  }

  /** What the pages show changed, such as form values: every page is drawn again. */
  invalidateContent(): void {
    this.#renderer?.invalidateContent();
  }

  /** Open an embedded file as activating its annotation does: by default, download it. */
  openFile(file: { filename: string; content: Uint8Array }): void {
    const { openAttachment } = this.#options;
    if (openAttachment) openAttachment(file);
    else downloadBytes(file.content, file.filename);
  }

  /**
   * Show `pdf` until it closes, it is closed here (`closeViewer()`), or
   * another session opens; a viewer shows one document at a time, and
   * opening the one it shows changes nothing. Closing aborts the work this
   * viewer started for the document: drawing, searches, and background work
   * stop with it.
   */
  #open(pdf: PdfSession): void {
    if (this.#pdf === pdf && !pdf.signal.aborted) return;
    this.#close?.();
    const { source } = pdf;
    this.#pdf = pdf;
    this.#sourceName = "url" in source ? filenameFromUrl(source.url) : null;
    this.#firstPaintAt = null;
    this.#resetView();

    let closed = false;
    const ended = new AbortController();
    const close = () => {
      if (closed) return;
      closed = true;
      ended.abort();
      // Features let go of the document while its pages are still there,
      // then stop what they started for it with this signal.
      for (const extension of this.#extensions) extension.closed?.();
      this.#work?.abort();
      this.#ready = null;
      this.#work = null;
      this.#savedPosition = null;
      this.#pdf = null;
      this.#close = null;
      this.#selection.clear();
      this.#textPages.clear();
      this.#session = null;
      this.#permissions = null;
      this.#layers = null;
      this.#renderer = null;
      this.store.set({ layout: null, first: 0, last: -1 });
    };
    // The session closes when its provider lets it go: so does what shows it,
    // its features hearing it before the work stops.
    pdf.signal.addEventListener("abort", close, { once: true, signal: ended.signal });
    this.#close = close;
    this.#start(pdf);
  }

  /** Start showing the open session in the attached viewport, or wait for one. */
  #start(pdf: PdfSession): void {
    this.#work = linked(pdf.signal, this.#viewportControl.signal);
    const { signal } = this.#work;
    this.#load(pdf, signal).catch((error: unknown) => {
      // A document that fails to open says so in its session's state.
      if (!signal.aborted && pdf.state.get().status === "ready") {
        console.error("showing the document failed", error);
      }
    });
  }

  /**
   * Show the document `pdf` opens once it loads, and load the rest in the
   * background: as it opens (`opening`), or, in a viewport that reattached
   * after it showed, where the last one showed it.
   */
  async #load(pdf: PdfSession, signal: AbortSignal): Promise<void> {
    const session = await documentOf(pdf);
    signal.throwIfAborted();
    const opening = this.#savedPosition ? undefined : this.#options.opening;
    // Fetched beside the first page's size: features read the permissions
    // before the pages are drawn, and the first layout follows the opening.
    const [sizes, permissions, view] = await Promise.all([
      session.pageSizes(),
      session.permissions().catch(() => null),
      opening
        ? opening(session).catch((error: unknown) => {
            console.error("reading the initial view failed", error);
            return null;
          })
        : null,
      Promise.all([...this.#deferred]),
    ]);
    signal.throwIfAborted();
    this.#session = session;
    this.#permissions = permissions;
    // Every page has the first one's size until the background pass knows better.
    this.#sizes = [...sizes];
    for (const extension of this.#extensions) extension.prepare?.(session, signal);
    signal.throwIfAborted();
    const renderer = new Renderer(session, {
      ...rendererOptions(this.#options),
      links: this.#links,
      forms: this.#formLayers,
      ...(this.#annotationEditor ? { annotationEditor: this.#annotationEditor } : {}),
      selection: this.#selection,
      onPainted: (pageIndex) => {
        if (pageIndex === 0 && this.#firstPaintAt === null) {
          this.#firstPaintAt = performance.now();
        }
      },
      onTextReady: (pageIndex, handle) => {
        this.#textPages.set(pageIndex, handle);
        for (const extension of this.#extensions) extension.textLayer?.(pageIndex, handle);
      },
      onTextRemoved: (pageIndex) => {
        this.#textPages.delete(pageIndex);
        for (const extension of this.#extensions) extension.textLayer?.(pageIndex, null);
      },
      signal,
    });
    this.#renderer = renderer;
    // Pages unmounting while no viewport shows them keep nothing.
    if (!this.#scroller) renderer.setKeeping(false);
    for (const [index, host] of this.#pageHosts) renderer.attach(index, host);
    if (view?.spread) this.store.set({ spread: view.spread });
    if (view?.scrollMode) this.store.set({ scrollMode: view.scrollMode });
    // Where a viewport showed the document, it shows it again at once.
    const saved = this.#savedPosition;
    this.#savedPosition = null;
    const scale = saved
      ? saved.zoomMode === "custom"
        ? saved.scale
        : (this.#fitScale(saved.current, saved.zoomMode) ?? saved.scale)
      : this.#resolveInitialScale();
    this.#applyLayout(scale);
    this.store.set({ scale });
    if (saved) this.restorePosition(saved);
    else if (view?.view) this.show(view.view);
    else if (this.#initialPage > 0) this.goToPage(this.#initialPage);
    else if (view?.destination) this.#jump(view.destination, this.#destinationZoom);
    this.#update();
    this.#ready = signal;
    for (const extension of this.#extensions) extension.ready?.(session, signal);
    this.#background(this.#measurePages(session, signal), "measuring page sizes", signal);
    // Until the session's layers arrive, the viewer draws the document's
    // default ones, which they start with: nothing is drawn again, unless
    // another viewer of the session changed them already. Changes any viewer
    // of the session makes are drawn in every one.
    this.#background(
      session.layers().then((layers) => {
        if (signal.aborted) return;
        this.#layers = layers;
        renderer.setLayers(layers);
        layers.subscribe(this.#onLayersChange, signal);
        if (layers.changed) this.#onLayersChange();
      }),
      "loading layers",
      signal,
    );
  }

  /** A viewer of the document showed or hid layers: pages are drawn again. */
  #onLayersChange = (): void => {
    if (!this.#layers) return;
    this.#renderer?.invalidateContent();
    for (const extension of this.#extensions) extension.layersChanged?.();
  };

  /**
   * Build the renderer again with the options it takes, as a viewport that
   * detaches and attaches again: features hear `detaching`, the position is
   * kept, and the pages are laid out and drawn again.
   */
  #rebuild(): void {
    const pdf = this.#pdf;
    if (!pdf || !this.#scroller || !this.store.get().layout) return;
    this.#savedPosition = this.position();
    for (const extension of this.#extensions) extension.detaching?.();
    this.#work?.abort();
    this.#ready = null;
    this.#renderer = null;
    this.#start(pdf);
  }

  /** Bind the scroll container and its sized content element. */
  #attachViewport(scroller: HTMLElement, content: HTMLElement): () => void {
    if (this.#scroller)
      throw new Error("A Viewer owns one viewport; create another Viewer for a second viewport");
    const resuming = this.#viewportControl.signal.aborted;
    if (resuming) this.#viewportControl = new AbortController();
    const control = this.#viewportControl;
    this.#scroller = scroller;
    this.#content = content;
    const pdf = this.#pdf;
    if (resuming && pdf) this.#start(pdf);
    this.#renderer?.setKeeping(true);
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
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    const detachSelection = this.#selection.attachPages(content);
    this.#requestUpdate();
    for (const extension of this.#extensions) {
      extension.viewport?.(scroller, content, control.signal);
    }
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      // A provider may keep the session while its viewport is hidden (Activity).
      // Only viewport work ends; its view and edits return on the next attach.
      this.#savedPosition = this.store.get().layout ? this.position() : null;
      for (const extension of this.#extensions) extension.detaching?.();
      control.abort();
      this.#renderer = null;
      this.#pageHosts.clear();
      clearTimeout(this.#settleTimer);
      this.#settleTimer = 0;
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
      if (this.#frame) cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (this.#scroller === scroller) {
        this.#gestures.drop();
        // Kept canvases would hold memory for pages no viewport can show.
        this.#scroller = null;
        this.#content = null;
      }
    };
  }

  /**
   * Register a mounted page's host, the element React places for page
   * `index`; returns the function that releases it. The renderer builds the
   * page's canvases and layers at the start of the host, before what React
   * renders there.
   */
  #attachPage(index: number, host: HTMLElement): () => void {
    this.#renderer?.attach(index, host);
    this.#pageHosts.set(index, host);
    return () => {
      if (this.#pageHosts.get(index) !== host) return;
      this.#pageHosts.delete(index);
      this.#renderer?.detach(index);
    };
  }

  hasPixels(index: number): boolean {
    return this.#renderer?.hasPixels(index) ?? false;
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
    const renderer = this.#renderer;
    if (!layout || !scroller || !renderer || scroller.clientHeight === 0) return 0;
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
      weighted += size * renderer.sharpness(index, area, needed);
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
   * asks for unless `destinationZoom` is false. The history feature keeps
   * the position before the jump for `back()`. Resolves to false when the target is
   * invalid or null, as an outline entry's without one is.
   */
  async goToDestination(dest: Destination | null): Promise<boolean> {
    const session = this.#session;
    const signal = this.#work?.signal;
    if (!session || !signal || dest === null) return false;
    const target = await session.resolveDestination(dest).catch(() => null);
    const current = this.store.get().layout;
    if (!target || !current || !this.#scroller || signal.aborted) return false;
    if (target.pageIndex < 0 || target.pageIndex >= current.tops.length) return false;
    this.#jumping();
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
    // The point is on the unturned page; a quarter turn makes
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
   * Show `view`: its arrangement, rotation, and zoom, and its target's point
   * at the viewport's top-left corner, scrolled sideways to it even when in
   * view. Fields left out keep the viewer's; a page out of range and a
   * scale beyond `minScale` and `maxScale` are clamped.
   */
  show(view: ShownView): void {
    this.#gestures.finish();
    const before = this.store.get();
    const scroller = this.#scroller;
    if (!before.layout || !scroller || before.layout.tops.length === 0) return;
    const count = before.layout.tops.length;
    const rotation = view.rotation ?? before.rotation;
    const spread = view.spread ?? before.spread;
    const scrollMode = view.scrollMode ?? before.scrollMode;
    const target: ResolvedDestination = view.target
      ? { ...view.target, pageIndex: clamp(Math.trunc(view.target.pageIndex), 0, count - 1) }
      : { pageIndex: before.currentPage, x: null, y: null };
    const page = target.pageIndex;
    this.store.set({ rotation, spread, scrollMode, currentPage: page });
    const requested = view.scale;
    let mode: ZoomMode = before.zoomMode;
    let scale = before.scale;
    if (requested === "fit-width" || requested === "fit-page") mode = requested;
    else if (requested !== undefined && Number.isFinite(requested) && requested > 0) {
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
    if (rotation !== before.rotation) this.#renderer?.rotate(rotation);
    // The destination's zoom applies only when the view leaves the zoom unsaid.
    if (target.x === null && target.y === null && !target.view) this.goToPage(page);
    else this.#jump(target, requested === undefined && this.#destinationZoom, true);
  }

  /**
   * Scroll so that `rect` of page `pageIndex`, in PDF points from its
   * unturned top-left corner, sits in the upper third of the viewport, and,
   * in "horizontal" mode or when it is out of view sideways, in its left
   * third. "page" mode shows its page. The page becomes current.
   */
  revealRect(
    pageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    const current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller || pageIndex < 0 || pageIndex >= current.tops.length) return;
    const layout = this.#show(current, pageIndex);
    const size = layout.sizes[pageIndex] ?? { width: 0, height: 0 };
    const box = turnBox(rect, size, layout.rotation);
    const top = pageTop(layout, pageIndex, scroller.clientHeight) + box.y * layout.scale;
    const left = pageLeft(layout, pageIndex, scroller.clientWidth) + box.x * layout.scale;
    scroller.scrollTop = top - scroller.clientHeight / 3;
    if (
      layout.scrollMode === "horizontal" ||
      left < scroller.scrollLeft ||
      left > scroller.scrollLeft + scroller.clientWidth
    ) {
      scroller.scrollLeft = left - scroller.clientWidth / 3;
    }
    this.store.set({ currentPage: pageIndex });
    this.#update();
  }

  /**
   * Where the viewer shows its document now, as a page and a share of it,
   * which survive zoom changes, and the current page and zoom; null without
   * a layout or a viewport.
   */
  position(): ViewerPosition | null {
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

  /** Show a `position()` again, with its zoom; a fitted zoom fits the viewport as it is now. */
  restorePosition(entry: ViewerPosition): void {
    this.#gestures.finish();
    let current = this.store.get().layout;
    const scroller = this.#scroller;
    if (!current || !scroller) return;
    const { pageIndex, zoomMode } = entry;
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

  /** A link, outline entry, or named action is about to jump: history keeps the position. */
  #jumping(): void {
    for (const extension of this.#extensions) extension.jumping?.();
  }

  #namedAction(action: string): void {
    const pageCount = this.#sizes.length;
    switch (action) {
      case "NextPage":
        this.nextPage();
        break;
      case "PrevPage":
        this.previousPage();
        break;
      case "FirstPage":
        this.#jumping();
        this.goToPage(0);
        break;
      case "LastPage":
        this.#jumping();
        this.goToPage(pageCount - 1);
        break;
      default:
        for (const extension of this.#extensions) extension.namedAction?.(action);
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
    this.#renderer?.rotate(turned);
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

  /** Back to the zoom the viewer opened with (`initialScale`), as Ctrl or ⌘ with 0 does. */
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
   * Background work may outlive its document: it then fails quietly. Until
   * `signal`, by default the open document's lease's, aborts, a failure is
   * logged.
   */
  #background(
    work: Promise<unknown>,
    what: string,
    signal: AbortSignal | undefined = this.#work?.signal,
  ): void {
    work.catch((error: unknown) => {
      if (signal && !signal.aborted) console.error(`${what} failed`, error);
    });
  }

  /**
   * Once the session has learned the real size of every page in the
   * background, relayout once if any differs from the first page's.
   */
  async #measurePages(session: DocumentSession, signal: AbortSignal): Promise<void> {
    const sizes = await session.measurePages();
    if (signal.aborted) return;
    const changed = sizes.some((size, index) => {
      const current = this.#sizes[index];
      return !current || current.width !== size.width || current.height !== size.height;
    });
    if (!changed) return;
    this.#gestures.finish();
    const scroller = this.#scroller;
    const layout = this.store.get().layout;
    // Shrinking the content can clamp its scroll position immediately.
    const point = scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : null;
    this.#sizes = [...sizes];
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
        this.goToPage(this.#sizes.length - 1);
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
    // An annotation tool takes the pointer over the hand tool.
    if (this.store.get().tool !== "hand" || this.#pointerClaimed) return;
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
    this.#renderer?.update({
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

/**
 * Show `session` in `viewer` until it closes or `closeViewer()`: what
 * `<PdfViewer>` does with the session of its `<PdfDocument>`.
 */
export function openViewer(viewer: Viewer, session: PdfSession): void {
  open(viewer, session);
}

/** Stop showing the open document, as when its viewer's owner goes. */
export function closeViewer(viewer: Viewer): void {
  close(viewer);
}

/** Take `options` from now on: `<PdfViewer>`'s props. */
export function setViewerOptions(viewer: Viewer, options: ViewerOptions): void {
  configure(viewer, options);
}

/**
 * Bind `viewer` to its scroll container and the sized element that holds
 * its pages; returns the function that detaches them: what `<PdfViewer>`
 * does with the elements it renders.
 */
export function attachViewport(
  viewer: Viewer,
  scroller: HTMLElement,
  content: HTMLElement,
): () => void {
  return bindViewport(viewer, scroller, content);
}

/**
 * Register the host React places for page `index` of `viewer`; returns the
 * function that releases it. The renderer builds the page's canvases and
 * layers at the start of the host.
 */
export function attachPage(viewer: Viewer, index: number, host: HTMLElement): () => void {
  return bindPage(viewer, index, host);
}
