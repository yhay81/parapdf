"use client";

import type { DocumentSession } from "../document/session.ts";
import type { LinkHandlers } from "../pdfjs/annotation-layer.ts";
import {
  copyDrawing,
  type DrawRequest,
  type DrawTask,
  drawPage,
  isRenderCancelled,
  type PageColors,
  type Rotation,
} from "../pdfjs/draw.ts";
import type { AnnotationEditor } from "../pdfjs/editor.ts";
import type { LayerState } from "../pdfjs/layers.ts";
import type { TextLayerHandle } from "../pdfjs/text.ts";
import { type PageArea, turnedSize } from "../view/layout.ts";
import { type DomLayerStats, DomLayers } from "./dom-layers.ts";
import {
  addEditorLayer,
  mountPage,
  type PageElements,
  placeDetail,
  release,
  removeEditorLayer,
  unmountPage,
} from "./page.ts";
import {
  type Budgets,
  baseScale,
  canvasPixels,
  DEFAULT_BUDGETS,
  demotes,
  type FailedDrawing,
  type Layer,
  type PageState,
  type PlanContext,
  type PlannedDrawing,
  plan,
  type RunningDrawing,
  sharpness,
  staleDetail,
  trim,
  type ViewInput,
} from "./planner.ts";
import type { TextSelectionTracker } from "./selection.ts";

/** A drawing of one of a page's layers that runs. */
interface Job extends RunningDrawing {
  readonly task: DrawTask;
  /** The canvas it draws into: the layer's own, or for a detail beside a shown one, the spare. */
  readonly canvas: HTMLCanvasElement;
}

/** A mounted page: its DOM, and what it shows and draws, which the planner reads. */
class Slot implements PageState {
  readonly index: number;
  readonly elements: PageElements;
  baseScale = 0;
  detailScale = 0;
  baseVersion = 0;
  detailVersion = 0;
  detailRegion: PageArea | null = null;
  /** Failed drawings stay blocked until their conditions change or the page mounts again. */
  readonly failures: Partial<Record<Layer, FailedDrawing>> = {};
  job: Job | undefined;
  readonly hasSpare = true;

  constructor(index: number, elements: PageElements) {
    this.index = index;
    this.elements = elements;
  }

  get basePixels(): number {
    const { base } = this.elements;
    return base.width * base.height;
  }

  get detailPixels(): number {
    const { detail } = this.elements;
    return detail.width * detail.height;
  }

  get sparePixels(): number {
    const { spare } = this.elements;
    return spare.width * spare.height;
  }
}

export interface RenderStats extends DomLayerStats {
  base: number;
  detail: number;
  /** Canvases of pages outside the viewport cleared to stay within maxCanvasPixels. */
  trimmed: number;
  /** Layers shown again from the canvases a page kept when it unmounted (`maxKeptPixels`). */
  kept: number;
  /** Whole-page details drawn into the base instead of a base drawn again (decision 0012). */
  demoted: number;
}

export interface RendererOptions extends Partial<Budgets> {
  maxConcurrent?: number;
  /** Pages get a text layer, and a tagged page the structure that goes with it. */
  textLayer?: boolean;
  /** Pages get an annotation layer: links, and form fields with `forms`. */
  annotationLayer?: boolean;
  /** Where activated links in annotation layers go. */
  links?: LinkHandlers;
  /** Annotation layers show form fields the reader can fill in; the drawings leave them out. */
  forms?: boolean;
  /** Colors pages are drawn in instead of their own. */
  pageColors?: PageColors;
  /** Which layers drawings and annotation layers show; see `invalidateContent`. */
  layers?: LayerState;
  /** Keeps drag selections inside built text layers. */
  selection?: TextSelectionTracker;
  /** Edits annotations on the pages; see `setAnnotationEditor`. */
  annotationEditor?: AnnotationEditor;
  /**
   * The most pixels kept of the canvases of pages that unmount, so that a
   * page coming back shows its drawing at once, its canvases moved into its
   * new host, instead of drawing it again; by default KEPT_VIEWPORTS times
   * the viewport's device pixels, and 0 keeps none. The least recently kept
   * go first, and within maxCanvasPixels they count as canvases and go
   * before any page's canvases, but never keep a page from drawing.
   */
  maxKeptPixels?: number;
  onPainted?: (pageIndex: number, layer: Layer) => void;
  onTextReady?: (pageIndex: number, handle: TextLayerHandle) => void;
  onTextRemoved?: (pageIndex: number) => void;
  /** Aborting it disposes the renderer, as when its document closes in the viewer. */
  signal?: AbortSignal;
}

/**
 * The canvases kept from pages that unmounted hold at most this many
 * viewports' worth of device pixels by default (`maxKeptPixels`): a few pages
 * at fit-width, so that going back to them, by a link's back, by scrolling,
 * or by flipping, shows them at once. Kept, a page came back sharp after 3
 * to 38 ms instead of 23 to 176 in the return benchmark (decision 0004).
 */
const KEPT_VIEWPORTS = 6;

/**
 * The canvases of a page that unmounted, kept with what they show: its
 * whole-page detail alone, which covers its base, or its base and any
 * partial detail.
 */
interface KeptPage {
  readonly rotation: Rotation;
  readonly version: number;
  readonly pixels: number;
  readonly base: { readonly canvas: HTMLCanvasElement; readonly scale: number } | null;
  readonly detail: {
    readonly canvas: HTMLCanvasElement;
    readonly scale: number;
    readonly region: PageArea | null;
  } | null;
}

/** A drawing outside the page layers, such as a thumbnail, waiting for a free drawing slot. */
interface ExtraJob {
  readonly pageIndex: number;
  readonly request: DrawRequest;
  readonly done: (error: unknown) => void;
  task: DrawTask | undefined;
  cancelled: boolean;
}

/**
 * Draws a viewer's mounted pages: builds each page's DOM in the host React
 * places, carries out the planner's plans, starting, cancelling, and
 * releasing drawings, keeps the canvases of pages that unmount, and builds
 * the DOM layers.
 *
 * A page that shows a detail draws its next one, after a zoom for example,
 * into its spare canvas, and the two change places once the new one is
 * complete, as pdf.js's viewer replaces a page's canvas only once the new
 * one is drawn. Until then the page shows its old detail, scaled by CSS.
 * Drawn in place, a detail showed white while pdf.js drew it, for 80 to 175
 * ms after each zoom in Safari in the iPadOS simulator; hidden until
 * complete, it left the page to its base, at a quarter of the device's
 * resolution, for 100 to 130 ms there. Within maxCanvasPixels, a detail
 * that does not fit beside the old one is still drawn in place, over the
 * base.
 */
export class Renderer {
  readonly stats: RenderStats = {
    base: 0,
    detail: 0,
    text: 0,
    textUpdates: 0,
    annotations: 0,
    editors: 0,
    cancelled: 0,
    failed: 0,
    trimmed: 0,
    kept: 0,
    demoted: 0,
  };
  readonly #session: DocumentSession;
  readonly #slots = new Map<number, Slot>();
  readonly #maxConcurrent: number;
  readonly #budgets: Budgets;
  readonly #options: RendererOptions;
  readonly #layers: DomLayers;
  /** `maxKeptPixels`; undefined follows the viewport. */
  #maxKeptPixels: number | undefined;
  /** Canvases of pages that unmounted, by page, least recently kept first. */
  readonly #kept = new Map<number, KeptPage>();
  #keptPixels = 0;
  #trimKeptQueued = false;
  /** Whether pages that unmount keep their canvases now; see setKeeping. */
  #keeping = true;
  #input: ViewInput | undefined;
  #running = 0;
  /** Bumped when every canvas becomes stale, so drawings started before are dropped. */
  #epoch = 0;
  /** Drawings outside the page layers, in the order they were asked for. */
  readonly #extras: ExtraJob[] = [];
  /** The content version pages should show; see PlanContext. */
  #version = 0;

  constructor(session: DocumentSession, options: RendererOptions = {}) {
    this.#session = session;
    this.#maxConcurrent = options.maxConcurrent ?? 2;
    this.#budgets = {
      maxDetailPixels: options.maxDetailPixels ?? DEFAULT_BUDGETS.maxDetailPixels,
      maxDetailViewports: options.maxDetailViewports ?? DEFAULT_BUDGETS.maxDetailViewports,
      maxBasePixels: options.maxBasePixels ?? DEFAULT_BUDGETS.maxBasePixels,
      maxCanvasPixels: options.maxCanvasPixels ?? DEFAULT_BUDGETS.maxCanvasPixels,
    };
    this.#options = options;
    this.#maxKeptPixels = options.maxKeptPixels;
    this.#layers = new DomLayers(
      session,
      {
        links: options.links,
        forms: options.forms,
        layers: options.layers,
        selection: options.selection,
        annotationEditor: options.annotationEditor,
        onTextReady: options.onTextReady,
        onTextRemoved: options.onTextRemoved,
      },
      this.stats,
      () => this.#waitingForPixels(),
    );
    options.signal?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  #context(): PlanContext | undefined {
    const input = this.#input;
    return input ? { input, budgets: this.#budgets, version: this.#version } : undefined;
  }

  /** The most pixels the canvases kept from pages that unmounted may hold now. */
  #keptBudget(): number {
    if (!this.#keeping) return 0;
    if (this.#maxKeptPixels !== undefined) return this.#maxKeptPixels;
    const input = this.#input;
    if (!input) return 0;
    const { width, height } = input.viewport;
    return KEPT_VIEWPORTS * width * height * input.devicePixelRatio ** 2;
  }

  /** Pixels of the canvases kept from pages that unmounted. */
  get keptPixels(): number {
    return this.#keptPixels;
  }

  /**
   * Whether pages that unmount keep their canvases: not while the viewer
   * has no viewport, so that canvases kept for pages that cannot come back
   * do not hold memory until the document closes. Turning it off lets the
   * canvases kept so far go.
   */
  setKeeping(keeping: boolean): void {
    this.#keeping = keeping;
    if (!keeping) this.#forgetAll();
  }

  /**
   * Builds page `index`'s DOM in `host`, before what React renders there,
   * and draws it; returns nothing, `detach` takes it down.
   */
  attach(index: number, host: HTMLElement): void {
    this.detach(index);
    const kept = this.#takeKept(index);
    const elements = mountPage(
      host,
      {
        text: this.#options.textLayer ?? true,
        annotations: this.#options.annotationLayer ?? true,
        editor: this.#layers.annotationEditor !== undefined,
      },
      { base: kept?.base?.canvas, detail: kept?.detail?.canvas },
    );
    const slot = new Slot(index, elements);
    this.#slots.set(index, slot);
    this.#layers.attach(index, elements);
    // pdf.js keeps the page's parsing results while a viewer of the session shows it.
    this.#session.holdPage(index);
    if (kept) this.#restore(slot, kept);
    this.#pump();
  }

  detach(index: number): void {
    const slot = this.#slots.get(index);
    if (!slot) return;
    this.#slots.delete(index);
    slot.job?.task.cancel();
    this.#layers.detach(index);
    const kept = this.#keep(slot);
    const { base, detail, spare } = slot.elements;
    for (const canvas of [base, detail, spare]) {
      if (!kept.has(canvas)) release(canvas);
    }
    unmountPage(slot.elements);
    this.#session.releasePage(index);
  }

  /**
   * Keeps the canvases of an unmounting page that show its current drawing,
   * as they are: unmounted, a canvas keeps its pixels. Returns them.
   */
  #keep(slot: Slot): Set<HTMLCanvasElement> {
    const keep = new Set<HTMLCanvasElement>();
    const budget = this.#keptBudget();
    if (budget <= 0) return keep;
    // With form fields shown as HTML, pdf.js draws check boxes, radio
    // buttons, and some fields into canvases of their own, which only a
    // drawing hands to the page's annotation layer: shown again, the page
    // would show them empty, as copyPage() knows.
    if (this.#options.forms && slot.elements.annotations) return keep;
    const { elements } = slot;
    const detail =
      slot.detailScale > 0 && slot.detailVersion === this.#version
        ? { canvas: elements.detail, scale: slot.detailScale, region: slot.detailRegion }
        : null;
    const base =
      slot.baseScale > 0 && slot.baseVersion === this.#version && detail?.region !== null
        ? { canvas: elements.base, scale: slot.baseScale }
        : null;
    if (!detail && !base) return keep;
    const pixels = [detail?.canvas, base?.canvas].reduce(
      (sum, canvas) => sum + (canvas ? canvas.width * canvas.height : 0),
      0,
    );
    if (pixels > budget) return keep;
    this.#forget(slot.index);
    this.#kept.set(slot.index, {
      rotation: this.#input?.layout.rotation ?? 0,
      version: this.#version,
      pixels,
      base,
      detail,
    });
    this.#keptPixels += pixels;
    if (base) keep.add(base.canvas);
    if (detail) keep.add(detail.canvas);
    // Over the budget, the least recently kept go once the pages mounting
    // in the same React commit, which unmounts pages before it mounts
    // others, have taken theirs back: a jump away and back unmounted the
    // pages it went to and let the ones it came back to go first.
    if (!this.#trimKeptQueued) {
      this.#trimKeptQueued = true;
      queueMicrotask(() => {
        this.#trimKeptQueued = false;
        const limit = this.#keptBudget();
        while (this.#keptPixels > limit && this.#kept.size > 0) this.#forgetOldest();
      });
    }
    return keep;
  }

  /** Releases the canvases a page kept. */
  #forget(index: number): void {
    const kept = this.#kept.get(index);
    if (!kept) return;
    this.#kept.delete(index);
    this.#keptPixels -= kept.pixels;
    for (const canvas of [kept.base?.canvas, kept.detail?.canvas]) {
      if (canvas) release(canvas);
    }
  }

  #forgetOldest(): void {
    const oldest = this.#kept.keys().next();
    if (!oldest.done) this.#forget(oldest.value);
  }

  #forgetAll(): void {
    for (const index of [...this.#kept.keys()]) this.#forget(index);
  }

  /**
   * Takes back what a mounting page kept, if it was drawn for the view's
   * rotation and the content as it is; the rest goes.
   */
  #takeKept(index: number): KeptPage | undefined {
    const kept = this.#kept.get(index);
    if (!kept) return undefined;
    // A kept canvas cleared meanwhile has nothing to show.
    const cleared = [kept.base?.canvas, kept.detail?.canvas].some(
      (canvas) => canvas !== undefined && canvas.width * canvas.height === 0,
    );
    if (
      cleared ||
      kept.rotation !== (this.#input?.layout.rotation ?? 0) ||
      kept.version !== this.#version
    ) {
      this.#forget(index);
      return undefined;
    }
    this.#kept.delete(index);
    this.#keptPixels -= kept.pixels;
    return kept;
  }

  /**
   * Shows what a mounting page kept, its canvases moved into its new host
   * without a copy. A drawing kept at another zoom still beats an empty
   * page, and is drawn again as after a zoom.
   */
  #restore(slot: Slot, kept: KeptPage): void {
    if (kept.base) {
      slot.elements.base.style.visibility = "";
      slot.baseScale = kept.base.scale;
      slot.baseVersion = kept.version;
      this.stats.kept++;
    }
    if (kept.detail) {
      placeDetail(slot.elements.detail, kept.detail.region);
      slot.elements.detail.style.visibility = "";
      slot.detailScale = kept.detail.scale;
      slot.detailVersion = kept.version;
      slot.detailRegion = kept.detail.region;
      this.stats.kept++;
    }
    for (const layer of ["base", "detail"] as const) {
      if (kept[layer]) this.#options.onPainted?.(slot.index, layer);
    }
  }

  /**
   * The view turned: pixels drawn for the old rotation are dropped at once,
   * and text and annotation layers, laid out unturned, only turn with CSS.
   */
  rotate(rotation: Rotation): void {
    this.#epoch++;
    for (const slot of this.#slots.values()) {
      if (slot.job) {
        slot.job.task.cancel();
        slot.job = undefined;
      }
      slot.baseScale = 0;
      release(slot.elements.base);
      this.#clearDetail(slot);
    }
    this.#layers.rotate(rotation);
    // Kept canvases show the old rotation.
    this.#forgetAll();
    // The next update() brings the turned layout and starts the new drawings.
  }

  /**
   * Build the layers of the annotations `editor` edits on the mounted pages
   * from now on, or, with null, take them down.
   */
  setAnnotationEditor(editor: AnnotationEditor | null): void {
    if (this.#layers.annotationEditor === (editor ?? undefined)) return;
    // Pages drawn without the annotations an editor was editing show them again.
    const editing = this.#layers.annotationEditor?.layerEditing.editing ?? false;
    for (const slot of this.#slots.values()) {
      if (editor) addEditorLayer(slot.elements);
    }
    this.#layers.setAnnotationEditor(editor ?? undefined);
    if (!editor) {
      for (const slot of this.#slots.values()) removeEditorLayer(slot.elements);
    }
    if (editing) this.invalidateContent();
  }

  /**
   * Draw with `layers` from now on. It must show what drawings showed
   * without it, the document's default layers; `invalidateContent` draws
   * changes.
   */
  setLayers(layers: LayerState): void {
    this.#options.layers = layers;
    this.#layers.setLayerState(layers);
  }

  /**
   * Show form fields as HTML in annotation layers, or leave them in the
   * drawings: pages drawn the other way are drawn again.
   */
  setForms(forms: boolean): void {
    if ((this.#options.forms ?? false) === forms) return;
    this.#options.forms = forms;
    this.#layers.setForms(forms);
    this.invalidateContent();
  }

  /**
   * What the pages show changed, say a layer was shown or hidden: every
   * page is drawn again, keeping its old pixels until the new ones are in,
   * and annotation layers are built again.
   */
  invalidateContent(): void {
    this.#layers.invalidateAnnotations();
    this.invalidateDrawings();
  }

  /** What the drawings show changed, but not the layers: every page is drawn again. */
  invalidateDrawings(): void {
    this.#version++;
    this.#forgetAll();
    for (const slot of this.#slots.values()) slot.job?.task.cancel();
    this.#pump();
  }

  /** Cancels all work and releases every page, for example when the document closes. */
  dispose(): void {
    // Closing pages keep nothing.
    this.#maxKeptPixels = 0;
    this.#forgetAll();
    for (const index of [...this.#slots.keys()]) this.detach(index);
    for (const job of this.#extras.splice(0)) {
      job.cancelled = true;
      job.task?.cancel();
    }
  }

  /**
   * Draw page `pageIndex` as `request` asks once no page layer waits for a
   * drawing slot: thumbnails never delay the pages in view. `done` hears null
   * on success, or the error. Returns the function that cancels the drawing.
   */
  enqueue(pageIndex: number, request: DrawRequest, done: (error: unknown) => void): () => void {
    const job: ExtraJob = { pageIndex, request, done, task: undefined, cancelled: false };
    this.#extras.push(job);
    this.#pump();
    return () => {
      if (job.cancelled) return;
      job.cancelled = true;
      if (job.task) job.task.cancel();
      else this.#extras.splice(this.#extras.indexOf(job), 1);
    };
  }

  /**
   * Copy page `index`'s drawing to `canvas`, already sized, if a whole-page
   * layer at least as large as it is drawn for `rotation`; false otherwise.
   */
  copyPage(index: number, canvas: HTMLCanvasElement, rotation: Rotation): boolean {
    const slot = this.#slots.get(index);
    if (!slot || (this.#input?.layout.rotation ?? 0) !== rotation) return false;
    const { elements } = slot;
    // With form fields shown as HTML, the drawing leaves them out, as pdf.js's
    // viewer knows when it declines to reuse such a drawing for a thumbnail.
    if (this.#options.forms && elements.annotations) return false;
    // A layer being drawn in place holds no finished drawing.
    const source =
      slot.detailScale > 0 &&
      slot.detailRegion === null &&
      slot.detailVersion === this.#version &&
      slot.job?.canvas !== elements.detail
        ? elements.detail
        : slot.baseScale > 0 &&
            slot.baseVersion === this.#version &&
            slot.job?.canvas !== elements.base
          ? elements.base
          : null;
    if (!source || source.width < canvas.width) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return true;
  }

  update(input: ViewInput): void {
    this.#input = input;
    this.#layers.update(input);
    const context = this.#context();
    if (context) {
      for (const slot of this.#slots.values()) {
        const { cancel, clear } = staleDetail(context, slot);
        if (cancel) slot.job?.task.cancel();
        // Pages that left the viewport at a region-drawing zoom give their
        // detail memory back; their base layer still shows, a small
        // whole-page detail drawn into it first.
        if (clear) {
          this.#demote(slot, context);
          this.#clearDetail(slot);
        }
      }
    }
    this.#pump();
  }

  hasPixels(index: number): boolean {
    const slot = this.#slots.get(index);
    return slot !== undefined && (slot.baseScale > 0 || slot.detailScale > 0);
  }

  textHandle(index: number): TextLayerHandle | undefined {
    return this.#layers.textHandle(index);
  }

  /** See `sharpness` in the planner. */
  sharpness(index: number, area: PageArea, needed: number): number {
    return sharpness(this.#slots.get(index), area, needed);
  }

  /** See DomLayers.whenEditable. */
  whenEditable(index: number): Promise<boolean> {
    return this.#layers.whenEditable(index);
  }

  /** Whether a visible page draws its first pixels now. */
  #waitingForPixels(): boolean {
    const input = this.#input;
    if (!input) return false;
    for (let index = input.first; index <= input.last; index++) {
      const slot = this.#slots.get(index);
      if (slot?.job && slot.baseScale === 0 && slot.detailScale === 0) return true;
    }
    return false;
  }

  /**
   * Over maxCanvasPixels, the kept canvases go first, then pages outside
   * the viewport give their pixels back as the planner says.
   */
  #trim(context: PlanContext): void {
    if (this.#budgets.maxCanvasPixels === Number.POSITIVE_INFINITY) return;
    this.#trimKept(context);
    for (const { index, layer } of trim(context, this.#slots.values())) {
      const slot = this.#slots.get(index);
      if (!slot) continue;
      // A running drawing ends through its own promise, which frees its slot.
      if (slot.job?.layer === layer) slot.job.task.cancel();
      if (layer === "detail") this.#clearDetail(slot);
      else {
        slot.baseScale = 0;
        release(slot.elements.base);
      }
      this.stats.trimmed++;
    }
  }

  /**
   * Kept canvases count within maxCanvasPixels too, and go first: while they
   * and the pages' canvases, the drawings running included, exceed it.
   */
  #trimKept(context: PlanContext): void {
    if (this.#budgets.maxCanvasPixels === Number.POSITIVE_INFINITY) return;
    const total = canvasPixels(context, this.#slots.values());
    while (total + this.#keptPixels > this.#budgets.maxCanvasPixels && this.#kept.size > 0) {
      this.#forgetOldest();
    }
  }

  /**
   * Draws the page's whole-page detail into its base canvas, scaled down to
   * the base's resolution, where the planner says it becomes the base
   * (`demotes`) and the base is older or less sharp. One `drawImage()` of a
   * canvas no larger than a base, instead of a base drawn from scratch.
   */
  #demote(slot: Slot, context: PlanContext): void {
    if (!demotes(context, slot)) return;
    const { layout } = context.input;
    const unturned = layout.sizes[slot.index];
    if (!unturned) return;
    const scale = Math.min(slot.detailScale, baseScale(context, slot.index));
    if (slot.baseVersion === context.version && slot.baseScale >= scale) return;
    // A base being drawn would draw over the copy.
    if (slot.job?.layer === "base") slot.job.task.cancel();
    const size = turnedSize(unturned, layout.rotation);
    const { base, detail } = slot.elements;
    // Whole pixels, as pdf.js sizes a base drawn at this scale.
    copyDrawing(
      this.#session.pdfjs,
      base,
      detail,
      Math.floor(size.width * scale + 1e-6),
      Math.floor(size.height * scale + 1e-6),
    );
    base.style.visibility = "";
    slot.baseScale = scale;
    slot.baseVersion = context.version;
    this.stats.demoted++;
  }

  /** Drops the page's detail pixels, the spare's included; any detail drawing is cancelled first. */
  #clearDetail(slot: Slot): void {
    slot.detailScale = 0;
    slot.detailRegion = null;
    release(slot.elements.detail);
    release(slot.elements.spare);
  }

  #pump(): void {
    const context = this.#context();
    if (context) {
      this.#trim(context);
      const free = this.#maxConcurrent - this.#running;
      if (free > 0) {
        for (const drawing of plan(context, this.#slots.values(), free)) {
          const slot = this.#slots.get(drawing.index);
          if (slot) this.#start(slot, drawing);
        }
      }
    }
    // Extra drawings leave a slot free for the page that scrolls in next.
    const extraSlots = Math.max(1, this.#maxConcurrent - 1);
    while (
      this.#running < this.#maxConcurrent &&
      this.#extras.filter((extra) => extra.task).length < extraSlots
    ) {
      const job = this.#extras.find((extra) => !extra.task);
      if (!job) break;
      this.#startExtra(job);
    }
    // The drawings just started may need the room kept canvases take.
    if (context) this.#trimKept(context);
    this.#layers.schedule();
  }

  #startExtra(job: ExtraJob): void {
    const task = drawPage(this.#session.pdfjs, this.#session.page(job.pageIndex), job.request);
    job.task = task;
    this.#running++;
    task.promise
      .then(
        () => {
          if (!job.cancelled) job.done(null);
        },
        (error: unknown) => {
          if (isRenderCancelled(error)) this.stats.cancelled++;
          else {
            this.stats.failed++;
            console.error(`page ${job.pageIndex + 1}: render failed`, error);
          }
          if (!job.cancelled) job.done(error);
        },
      )
      .finally(() => {
        this.#running--;
        const at = this.#extras.indexOf(job);
        if (at >= 0) this.#extras.splice(at, 1);
        this.#pump();
      });
  }

  #start(slot: Slot, drawing: PlannedDrawing): void {
    const { layer, scale, region, intoSpare } = drawing;
    const { elements } = slot;
    const canvas = layer === "base" ? elements.base : intoSpare ? elements.spare : elements.detail;
    const layout = this.#input?.layout;
    const unturned = layout?.sizes[slot.index];
    // The canvas is resized, which clears it, before the page next paints, so
    // moving it now never shows old pixels in the new place. It stays hidden
    // until the drawing completes: a resized canvas with pdf.js's opaque
    // context is black, pdf.js's renderer worker sends its first frame a
    // round trip later, and pdf.js drawing on the main thread fills the
    // canvas white and draws over it in chunks, one per animation frame. So
    // a detail drawing covered the base below it with black or white, and a
    // base drawing showed a black page. Drawn in place, a layer has none of
    // its pixels until then.
    canvas.style.visibility = "hidden";
    if (layer === "detail") {
      placeDetail(canvas, region);
      if (!intoSpare) {
        slot.detailScale = 0;
        slot.detailRegion = null;
      }
    } else slot.baseScale = 0;
    const { forms, pageColors, layers } = this.#options;
    const task = drawPage(this.#session.pdfjs, this.#session.page(slot.index), {
      scale,
      rotation: layout?.rotation ?? 0,
      canvas,
      ...(drawing.pixels ? { region: drawing.pixels } : {}),
      ...(forms && elements.annotations ? { formLayer: elements.annotations } : {}),
      // The annotation layer makes editors of what the drawing leaves out.
      ...(this.#layers.annotationEditor?.layerEditing.editing && elements.annotations
        ? { editing: elements.annotations }
        : {}),
      ...(pageColors ? { colors: pageColors } : {}),
      ...(layers ? { layers: layers.config } : {}),
    });
    const version = this.#version;
    slot.job = { layer, scale, region, intoSpare, task, canvas };
    this.#running++;
    const epoch = this.#epoch;
    const current = () => this.#slots.get(slot.index) === slot && epoch === this.#epoch;
    task.promise
      .then(
        () => {
          if (!current()) return;
          delete slot.failures[layer];
          canvas.style.visibility = "";
          if (layer === "base") {
            slot.baseScale = scale;
            slot.baseVersion = version;
            // A failed replacement may leave an older content version on
            // top. Keep those pixels until this fallback is ready to show.
            if (version === this.#version && slot.detailVersion !== version) {
              this.#clearDetail(slot);
            }
            this.stats.base++;
          } else {
            if (intoSpare) {
              // The new detail takes the shown one's place in the same frame,
              // and a whole-page one it replaces with part of the page may
              // show under it as the base.
              const context = this.#context();
              if (region !== null && context) this.#demote(slot, context);
              const shown = elements.detail;
              elements.detail = canvas;
              elements.spare = shown;
              release(shown);
            }
            slot.detailScale = scale;
            slot.detailVersion = version;
            slot.detailRegion = region;
            this.stats.detail++;
          }
          this.#options.onPainted?.(slot.index, layer);
        },
        (error: unknown) => {
          if (isRenderCancelled(error)) this.stats.cancelled++;
          else {
            this.stats.failed++;
            console.error(`page ${slot.index + 1}: ${layer} render failed`, error);
            if (current() && layout && unturned) {
              // A permanent failure must not pump the same drawing forever.
              slot.failures[layer] = {
                scale,
                region: drawing.plannedRegion,
                version,
                rotation: layout.rotation,
                width: unturned.width,
                height: unturned.height,
              };
            }
          }
          if (layer !== "detail" || !current()) return;
          if (intoSpare) {
            // The shown detail stays; the spare's half drawing goes.
            release(canvas);
          } else {
            // Hide a half-drawn detail layer so the base shows through.
            this.#clearDetail(slot);
          }
        },
      )
      .finally(() => {
        this.#running--;
        if (slot.job?.task === task) slot.job = undefined;
        this.#pump();
      });
  }
}
