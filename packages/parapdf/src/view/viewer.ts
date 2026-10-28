"use client";

import { documentOf, type PdfSession } from "../document/pdf-session.ts";
import type { DocumentSession, PageSize, PdfPermissions } from "../document/session.ts";
import type { AnnotationLayerScripting, LinkHandlers } from "../pdfjs/annotation-layer.ts";
import type { Destination, ResolvedDestination } from "../pdfjs/destinations.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import type { AnnotationEditor } from "../pdfjs/editor.ts";
import type { LayerState } from "../pdfjs/layers.ts";
import type { TextLayerHandle } from "../pdfjs/text.ts";
import { Renderer, type RenderStats } from "../render/renderer.ts";
import { TextSelectionTracker } from "../render/selection.ts";
import { ExtensionSet, type ViewerExtension } from "./extensions.ts";
import { downloadBytes, filenameFromUrl } from "./files.ts";
import { ViewerGestures } from "./gestures.ts";
import { ViewerInput } from "./input.ts";
import {
  computeLayout,
  type Direction,
  type Layout,
  type LayoutOptions,
  type PageArea,
  pageAtPoint,
  rowBounds,
  rowEnd,
  rowStart,
  type ScrollMode,
  type SpreadMode,
  sameRows,
  showPage,
  visibleArea,
  visibleRange,
  zoomTarget,
} from "./layout.ts";
import { blankFraction, sharpness } from "./metrics.ts";
import {
  destinationTarget,
  pageTarget,
  positionAt,
  positionTarget,
  rectTarget,
  type ScrollTarget,
  type ViewerPosition,
} from "./navigation.ts";
import { rendererChanged, rendererOptions, type ShownView, type ViewerOptions } from "./options.ts";
import {
  type Motion,
  move,
  positionOf,
  SETTLE_DELAY,
  SETTLE_VELOCITY,
  sizeOf,
  viewportOf,
} from "./scrolling.ts";
import { linked } from "./signals.ts";
import { type PointerTool, ViewerStore, type ZoomMode } from "./state.ts";
import { destinationScale, fitScale, refits } from "./zoom.ts";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether a visible area is all of its page. */
const whole = (area: PageArea | null): boolean =>
  area !== null && area.minX === 0 && area.minY === 0 && area.maxX === 1 && area.maxY === 1;

/**
 * What a viewer holds of the document it shows, from `openViewer()` until
 * it closes: closing drops it whole.
 */
interface Showing {
  /** The session, whose signal stops what the viewer started for the document. */
  readonly pdf: PdfSession;
  readonly close: () => void;
  /** The file name the document's URL gives, for download(). */
  readonly sourceName: string | null;
  /** Work for the viewport and the document; either ending aborts it. */
  work: AbortController | null;
  /** Where a viewport that detached showed the document, for the next one. */
  savedPosition: ViewerPosition | null;
  /** The document, once it has loaded. */
  session: DocumentSession | null;
  /** What the document permits, once it has loaded. */
  permissions: PdfPermissions | null;
  /** Which of the document's layers show, in every viewer of it. */
  layers: LayerState | null;
  /** The renderer of its pages, while the viewport shows them. */
  renderer: Renderer | null;
  /** The page order the document asks for, once it has loaded. */
  direction: Direction | null;
}

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
    close = (viewer) => viewer.#shown?.close();
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
    direction: "ltr",
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
    setLayers: (action) => this.#shown?.layers?.apply(action),
  };
  /** What the features attached hear. */
  readonly #extensions = new ExtensionSet();
  /** Whether annotation layers show form fields (`setFormLayers()`). */
  #formLayers = false;
  /** The document's scripts, which those fields run (`setFormScripting()`). */
  #formScripting: AnnotationLayerScripting | null = null;
  /** The annotation editor a feature gave, whose layers pages get. */
  #annotationEditor: AnnotationEditor | null = null;
  /** A feature took the pointer, which the hand tool then leaves alone. */
  #pointerClaimed = false;
  readonly #selection = new TextSelectionTracker();
  /** The document this viewer shows, from `openViewer()` until it closes. */
  #shown: Showing | null = null;
  /** The viewport's lifetime, independent of the document and other viewers. */
  #viewportControl = new AbortController();

  /** Aborted while no viewport is attached. */
  get signal(): AbortSignal {
    return this.#viewportControl.signal;
  }
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
  /**
   * How far the viewport's right edge was from the content's at the last
   * scroll, which pages read from the right keep as the scroller resizes.
   */
  #fromRight = 0;
  readonly #input = new ViewerInput({
    scroller: () => this.#scroller,
    state: () => this.store.get(),
    pointerClaimed: () => this.#pointerClaimed,
    pageCount: () => this.#sizes.length,
    flip: (direction, axis) => this.#flip(direction, axis),
    goToPage: (index) => this.goToPage(index),
    zoomBy: (factor) => this.zoomBy(factor),
    resetScale: () => this.resetScale(),
  });

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
    let arranged = gap !== this.#gap || overscan !== this.#overscan;
    this.#gap = gap;
    this.#overscan = overscan;
    const layout = this.store.get().layout;
    if (!layout) return;
    if (rendererChanged(previous, options)) {
      this.#rebuild();
      return;
    }
    const direction = this.#direction();
    if (direction !== this.store.get().direction) {
      this.store.set({ direction });
      arranged = true;
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
      direction: this.#direction(),
    });
  }

  /** The page order: the option's, or the document's, or "ltr". */
  #direction(): Direction {
    return this.#options.direction ?? this.#shown?.direction ?? "ltr";
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
    return this.#shown?.session ?? null;
  }

  /**
   * What the open document permits, everything when it is not encrypted;
   * null until it has loaded. Read before its first layout, for features
   * that follow it.
   */
  get permissions(): PdfPermissions | null {
    return this.#shown?.permissions ?? null;
  }

  /**
   * What this viewer does for its open document stops with it: it aborts
   * when the document closes or the viewport detaches. Null while no
   * document is open.
   */
  get workSignal(): AbortSignal | null {
    return this.#shown?.work?.signal ?? null;
  }

  /** The renderer of the open document's pages, once it has loaded. */
  get renderer(): Renderer | null {
    return this.#shown?.renderer ?? null;
  }

  /** Which of the open document's layers show, once known. */
  get layers(): LayerState | null {
    return this.#shown?.layers ?? null;
  }

  /** The text layers of the mounted pages that have one, by page. */
  get textLayers(): ReadonlyMap<number, TextLayerHandle> {
    return this.#textPages;
  }

  /** The colors pages are drawn in instead of their own (`pageColors`). */
  get pageColors(): PageColors | undefined {
    return this.#options.pageColors;
  }

  /** The file name the open document's URL gives; null for bytes and with no document open. */
  get sourceName(): string | null {
    return this.#shown?.sourceName ?? null;
  }

  /** Render counters for the current document. */
  get stats(): RenderStats | null {
    return this.#shown?.renderer?.stats ?? null;
  }

  /** Pixels of the canvases kept from pages that left the mounted window (`maxKeptPixels`). */
  get keptPixels(): number {
    return this.#shown?.renderer?.keptPixels ?? 0;
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
    const scroller = this.#scroller;
    const content = this.#content;
    return this.#extensions.add(
      extension,
      scroller && content ? { scroller, content, signal: this.#viewportControl.signal } : null,
    );
  }

  /**
   * Make the next document's first layout wait for `loading`, a feature
   * loading for this viewer that changes how pages are drawn.
   */
  defer(loading: Promise<unknown>): void {
    this.#extensions.defer(loading);
  }

  /**
   * Show form fields as HTML the reader fills in, in the annotation layers,
   * instead of drawing them: pages already drawn are drawn again.
   */
  setFormLayers(enabled: boolean): void {
    this.#formLayers = enabled;
    this.#shown?.renderer?.setForms(enabled);
  }

  /**
   * Have the form fields of annotation layers run `scripting`, the
   * document's scripts, or, with null, none: those built are built again.
   */
  setFormScripting(scripting: AnnotationLayerScripting | null): void {
    this.#formScripting = scripting;
    this.#shown?.renderer?.setFormScripting(scripting);
  }

  /**
   * Build the layers of the annotations `editor` edits on the mounted pages
   * that have an editor container, or, with null, take them down.
   */
  setAnnotationEditor(editor: AnnotationEditor | null): void {
    this.#annotationEditor = editor;
    this.#shown?.renderer?.setAnnotationEditor(editor);
  }

  /** While claimed, a mouse drag is a feature's, such as an annotation tool's, not the hand tool's. */
  claimPointer(claimed: boolean): void {
    this.#pointerClaimed = claimed;
  }

  /** What the pages show changed, such as form values: every page is drawn again. */
  invalidateContent(): void {
    this.#shown?.renderer?.invalidateContent();
  }

  /** What the drawings show changed, but not the layers: every page is drawn again. */
  invalidateDrawings(): void {
    this.#shown?.renderer?.invalidateDrawings();
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
    if (this.#shown?.pdf === pdf && !pdf.signal.aborted) return;
    this.#shown?.close();
    const ended = new AbortController();
    const close = () => {
      if (ended.signal.aborted) return;
      ended.abort();
      // Features let go of the document while its pages are still there,
      // then stop what they started for it with this signal.
      this.#extensions.closed();
      shown.work?.abort();
      this.#shown = null;
      this.#selection.clear();
      this.#textPages.clear();
      this.store.set({ layout: null, first: 0, last: -1 });
    };
    const { source } = pdf;
    const shown: Showing = {
      pdf,
      close,
      sourceName: "url" in source ? filenameFromUrl(source.url) : null,
      work: null,
      savedPosition: null,
      session: null,
      permissions: null,
      layers: null,
      renderer: null,
      direction: null,
    };
    this.#shown = shown;
    this.#firstPaintAt = null;
    this.#resetView();
    // The session closes when its provider lets it go: so does what shows it,
    // its features hearing it before the work stops.
    pdf.signal.addEventListener("abort", close, { once: true, signal: ended.signal });
    this.#start(shown);
  }

  /** Start showing the open session in the attached viewport, or wait for one. */
  #start(shown: Showing): void {
    const { pdf } = shown;
    shown.work = linked(pdf.signal, this.#viewportControl.signal);
    const { signal } = shown.work;
    this.#load(shown, signal).catch((error: unknown) => {
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
  async #load(shown: Showing, signal: AbortSignal): Promise<void> {
    const session = await documentOf(shown.pdf);
    signal.throwIfAborted();
    const opening = shown.savedPosition ? undefined : this.#options.opening;
    // Fetched beside the first page's size: features read the permissions
    // before the pages are drawn, and the first layout follows the opening.
    const [sizes, permissions, direction, view] = await Promise.all([
      session.pageSizes(),
      session.permissions().catch(() => null),
      session.direction().catch(() => null),
      opening
        ? opening(session).catch((error: unknown) => {
            console.error("reading the initial view failed", error);
            return null;
          })
        : null,
      this.#extensions.loaded(),
    ]);
    signal.throwIfAborted();
    shown.session = session;
    shown.permissions = permissions;
    shown.direction = direction;
    // Every page has the first one's size until the background pass knows better.
    this.#sizes = [...sizes];
    this.#extensions.prepare(session, signal);
    signal.throwIfAborted();
    const renderer = new Renderer(session, {
      ...rendererOptions(this.#options),
      links: this.#links,
      forms: this.#formLayers,
      formScripting: this.#formScripting,
      ...(this.#annotationEditor ? { annotationEditor: this.#annotationEditor } : {}),
      selection: this.#selection,
      onPainted: (pageIndex) => {
        if (pageIndex === 0 && this.#firstPaintAt === null) {
          this.#firstPaintAt = performance.now();
        }
      },
      onTextReady: (pageIndex, handle) => {
        this.#textPages.set(pageIndex, handle);
        this.#extensions.textLayer(pageIndex, handle);
      },
      onTextRemoved: (pageIndex) => {
        this.#textPages.delete(pageIndex);
        this.#extensions.textLayer(pageIndex, null);
      },
      signal,
    });
    shown.renderer = renderer;
    // Pages unmounting while no viewport shows them keep nothing.
    if (!this.#scroller) renderer.setKeeping(false);
    for (const [index, host] of this.#pageHosts) renderer.attach(index, host);
    if (view?.spread) this.store.set({ spread: view.spread });
    if (view?.scrollMode) this.store.set({ scrollMode: view.scrollMode });
    this.store.set({ direction: this.#direction() });
    // Where a viewport showed the document, it shows it again at once.
    const saved = shown.savedPosition;
    shown.savedPosition = null;
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
    // A row of pages read from the right starts at its right end.
    else if (this.store.get().direction === "rtl") this.goToPage(0);
    this.#update();
    this.#extensions.ready(session, signal);
    this.#background(this.#measurePages(session, signal), "measuring page sizes", signal);
    // Until the session's layers arrive, the viewer draws the document's
    // default ones, which they start with: nothing is drawn again, unless
    // another viewer of the session changed them already. Changes any viewer
    // of the session makes are drawn in every one.
    this.#background(
      session.layers().then((layers) => {
        if (signal.aborted) return;
        shown.layers = layers;
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
    const shown = this.#shown;
    if (!shown?.layers) return;
    shown.renderer?.invalidateContent();
    this.#extensions.layersChanged();
  };

  /**
   * Build the renderer again with the options it takes, as a viewport that
   * detaches and attaches again: features hear `detaching`, the position is
   * kept, and the pages are laid out and drawn again.
   */
  #rebuild(): void {
    const shown = this.#shown;
    if (!shown || !this.#scroller || !this.store.get().layout) return;
    shown.savedPosition = this.position();
    this.#extensions.detaching(true);
    shown.work?.abort();
    shown.renderer = null;
    this.#start(shown);
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
    if (resuming && this.#shown) this.#start(this.#shown);
    this.#shown?.renderer?.setKeeping(true);
    const layout = this.store.get().layout;
    if (layout) this.#sizeContent(layout);
    scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    const detachGestures = this.#gestures.attach(scroller);
    const detachInput = this.#input.attach(scroller);
    scroller.classList.toggle("parapdf-hand", this.store.get().tool === "hand");
    const resize = new ResizeObserver(this.#onResize);
    resize.observe(scroller);
    const detachSelection = this.#selection.attachPages(content);
    this.#requestUpdate();
    this.#extensions.viewport(scroller, content, control.signal);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      // A provider may keep the session while its viewport is hidden (Activity).
      // Only viewport work ends; its view and edits return on the next attach.
      const shown = this.#shown;
      if (shown) shown.savedPosition = this.store.get().layout ? this.position() : null;
      this.#extensions.detaching();
      control.abort();
      if (shown) shown.renderer = null;
      this.#pageHosts.clear();
      clearTimeout(this.#settleTimer);
      this.#settleTimer = 0;
      scroller.removeEventListener("scroll", this.#onScroll);
      detachGestures();
      detachInput();
      scroller.classList.remove("parapdf-hand");
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
    this.#shown?.renderer?.attach(index, host);
    this.#pageHosts.set(index, host);
    return () => {
      if (this.#pageHosts.get(index) !== host) return;
      this.#pageHosts.delete(index);
      this.#shown?.renderer?.detach(index);
    };
  }

  hasPixels(index: number): boolean {
    return this.#shown?.renderer?.hasPixels(index) ?? false;
  }

  /** Fraction of the viewport covered by pages that show no pixels yet. */
  blankFraction(): number {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    if (!layout || !scroller) return 0;
    return blankFraction(layout, viewportOf(scroller), (index) => this.hasPixels(index));
  }

  /**
   * How sharp the visible pages look: the resolution of their pixels as a
   * share of full device resolution, weighted by visible area. 1 means sharp
   * everywhere, 0 means blank.
   */
  sharpness(): number {
    const layout = this.store.get().layout;
    const scroller = this.#scroller;
    const renderer = this.#shown?.renderer;
    if (!layout || !scroller || !renderer) return 0;
    const needed = layout.scale * (window.devicePixelRatio || 1);
    return sharpness(layout, viewportOf(scroller), needed, (index, area, needed) =>
      renderer.sharpness(index, area, needed),
    );
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
    this.#scrollTo(scroller, pageTarget(layout, target, scroller));
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
      // Flipping to the page on the right shows it from its left edge.
      const rightward = direction > 0 !== (layout.direction === "rtl");
      scroller.scrollLeft = rightward ? 0 : scroller.scrollWidth;
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

  /** Scroll to `target`, read before this write: its top, then its left unless null. */
  #scrollTo(scroller: HTMLElement, target: ScrollTarget): void {
    scroller.scrollTop = target.top;
    if (target.left !== null) scroller.scrollLeft = target.left;
  }

  /**
   * Follow an internal link or outline entry, with the zoom its destination
   * asks for unless `destinationZoom` is false. The history feature keeps
   * the position before the jump for `back()`. Resolves to false when the target is
   * invalid or null, as an outline entry's without one is.
   */
  async goToDestination(dest: Destination | null): Promise<boolean> {
    const session = this.#shown?.session;
    const signal = this.#shown?.work?.signal;
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
    const fitted = zoom
      ? destinationScale(
          this.#sizes,
          this.store.get(),
          target,
          scroller,
          this.#gap,
          this.#minScale,
          this.#maxScale,
        )
      : null;
    if (fitted) {
      this.store.set({ zoomMode: fitted.mode, currentPage: pageIndex });
      if (fitted.mode !== "custom") {
        this.#markFitted(scroller);
      }
      if (Math.abs(fitted.scale - current.scale) > 1e-4) {
        current = this.#applyLayout(fitted.scale, pageIndex);
        this.store.set({ scale: fitted.scale });
      }
    }
    const layout = this.#show(current, pageIndex);
    this.#scrollTo(scroller, destinationTarget(layout, target, scroller, exact));
    this.store.set({ currentPage: pageIndex });
    this.#update();
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
      this.#markFitted(scroller);
    }
    this.store.set({ zoomMode: mode, scale });
    this.#applyLayout(scale, page);
    if (rotation !== before.rotation) this.#shown?.renderer?.rotate(rotation);
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
    this.#scrollTo(scroller, rectTarget(layout, pageIndex, rect, scroller));
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
    return positionAt(layout, scroller, this.store.get());
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
        this.#markFitted(scroller);
      }
      current = this.#applyLayout(scale, pageIndex);
      this.store.set({ scale });
    }
    const layout = this.#show(current, pageIndex);
    this.#scrollTo(scroller, positionTarget(layout, entry, scroller));
    this.store.set({ currentPage: entry.current });
    this.#update();
  }

  /** A link, outline entry, or named action is about to jump: history keeps the position. */
  #jumping(): void {
    this.#extensions.jumping();
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
        this.#extensions.namedAction(action);
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
    this.#shown?.renderer?.rotate(turned);
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
        this.#markFitted(scroller);
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
    if (tool !== "hand") this.#input.release();
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
    this.#markFitted(scroller);
    this.#zoomTo(scale);
    if (mode === "fit-page") this.goToPage(page);
  }

  /** `fitScale()` for this viewer's pages, arrangement, viewport, and limits. */
  #fitScale(index: number, mode: "fit-width" | "fit-page"): number | null {
    return fitScale(
      this.#sizes,
      this.store.get(),
      index,
      mode,
      this.#scroller,
      this.#gap,
      this.#minScale,
      this.#maxScale,
    );
  }

  /** The zoom was fitted to the viewport as it is now: a resize to another size fits it again. */
  #markFitted(scroller: HTMLElement): void {
    this.#fittedWidth = scroller.clientWidth;
    this.#fittedHeight = scroller.clientHeight;
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
    this.#markFitted(scroller);
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
    const { rotation, spread, scrollMode, direction, layout, currentPage } = this.store.get();
    return {
      gap: this.#gap,
      rotation,
      spread,
      scrollMode,
      direction,
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
    signal: AbortSignal | undefined = this.#shown?.work?.signal,
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
    if (scroller && refits(mode, scroller, this.#fittedWidth, this.#fittedHeight)) {
      this.#gestures.finish();
      this.#fit();
    } else if (scroller && this.store.get().direction === "rtl") {
      // The browser keeps the content's left edge in place; pages read from
      // the right keep their right edge, as the viewport or a scrollbar
      // changes. A browser that already moved them, clamping at the end of
      // the row, scrolled to where they keep it.
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth - this.#fromRight;
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

  #onScroll = (): void => {
    const scroller = this.#scroller;
    if (!scroller) return;
    if (this.store.get().direction === "rtl") {
      this.#fromRight = scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth;
    }
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
    this.#shown?.renderer?.update({
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
