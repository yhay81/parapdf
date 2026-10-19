import {
  type AnnotationLayerHandle,
  type AnnotationLayerTask,
  isRenderCancelled,
  type LinkHandlers,
  type PageSize,
  type PdfEngineDocument,
  type RenderRegion,
  type RenderTask,
  type Rotation,
  type TextLayerHandle,
  type TextLayerTask,
} from "../engine/types.ts";
import {
  areaSize,
  intersectAreas,
  type Layout,
  type PageArea,
  turnedSize,
  type Viewport,
  visibleArea,
} from "./layout.ts";
import type { TextSelectionTracker } from "./selection.ts";

type Layer = "base" | "detail";

/**
 * Each mounted page owns two stacked canvases. The base layer is a quick,
 * low-resolution render that fills the page as soon as it scrolls in; the
 * detail layer covers it at full device resolution once scrolling settles.
 * Because the base stays underneath, re-rendering the detail layer (for
 * example after zooming) never flashes an empty page. Pages that slow
 * scrolling brings into the mounted window render their detail before they
 * scroll in and get a base only once they need one in view.
 *
 * The text and annotation layers are DOM built on the main thread, so they
 * are the last things a page gets: one layer at a time, only after scrolling
 * settles, during idle periods, text before links.
 *
 * A text layer keeps the zoom it was laid out for: it carries its own
 * `--total-scale-factor`, and later zooms scale the laid-out layer with CSS.
 * Laying out every mounted page's text runs again at each zoom step was most
 * of the main thread's work while zooming. A visible page is laid out again,
 * one per idle period, only once the zoom goes in past TEXT_RELAYOUT_ZOOM
 * times the zoom its text was laid out for.
 */
interface Slot {
  readonly index: number;
  readonly base: HTMLCanvasElement;
  readonly detail: HTMLCanvasElement;
  readonly text: HTMLElement | null;
  readonly annotations: HTMLElement | null;
  /** Device pixels per point of the last completed render, 0 when empty. */
  baseScale: number;
  detailScale: number;
  /** The part of the page the detail layer covers; null for the whole page. */
  detailRegion: PageArea | null;
  job: { layer: Layer; scale: number; region: PageArea | null; task: RenderTask } | undefined;
  textTask: TextLayerTask | undefined;
  textHandle: TextLayerHandle | undefined;
  /** CSS pixels per point and view rotation the text runs were laid out for; 0 before any. */
  textScale: number;
  textRotation: Rotation;
  annotationTask: AnnotationLayerTask | undefined;
  annotationHandle: AnnotationLayerHandle | undefined;
  annotationScale: number;
  annotationRotation: Rotation;
}

export interface ScheduleInput {
  layout: Layout;
  /** Pages intersecting the viewport. */
  first: number;
  last: number;
  /** Page nearest the viewport center; work radiates out from it. */
  focus: number;
  viewport: Viewport;
  devicePixelRatio: number;
  /** Scrolling is slow or stopped, so full-resolution work is worth starting. */
  settled: boolean;
}

export interface SchedulerStats {
  base: number;
  detail: number;
  text: number;
  /** Text layers laid out again for a new zoom. */
  textUpdates: number;
  annotations: number;
  cancelled: number;
  failed: number;
  /** Canvases of pages outside the viewport cleared to stay within maxCanvasPixels. */
  trimmed: number;
}

export interface SchedulerOptions {
  maxConcurrent?: number;
  /**
   * The most pixels a detail canvas holds. A page whose full-resolution render
   * is larger gets detail only for its visible area plus a margin.
   */
  maxDetailPixels?: number;
  /** The most pixels a base canvas holds; beyond it the base renders at lower resolution. */
  maxBasePixels?: number;
  /**
   * The most pixels all canvases hold together. Pages outside the viewport
   * render only within it and give their pixels back, farthest first and
   * detail before base, when visible pages need more; visible pages always
   * get theirs.
   */
  maxCanvasPixels?: number;
  /** Where activated links in annotation layers go. */
  links?: LinkHandlers;
  /** Keeps drag selections inside rendered text layers. */
  selection?: TextSelectionTracker;
  onPainted?: (pageIndex: number, layer: Layer) => void;
  onTextReady?: (pageIndex: number, handle: TextLayerHandle) => void;
  onTextRemoved?: (pageIndex: number) => void;
}

/** Base renders use half a device pixel per CSS pixel at most: fast, and fine as a placeholder. */
const BASE_FACTOR = 0.5;

/**
 * Once scrolling settles, a visible page with no pixels yet gets its
 * whole-page detail without a base first when that detail holds at most this
 * many times maxBasePixels (8.4 MP by default, an A4 page about 1,200 CSS
 * pixels wide at devicePixelRatio 2). A base repeats all of the page's drawing
 * work, most of the cost of vector drawings, and delays the sharp page.
 */
const QUICK_DETAIL_BASES = 4;

/**
 * Zooming in past this multiple of the zoom a text layer was laid out for
 * lays it out again. CSS scaling keeps runs where they were laid out, but
 * runs laid out small carry rounding errors that it magnifies: in Chromium,
 * up to 2.4 points at 0.25 CSS pixels per point against 0.04 at 4. Zooming
 * out keeps the finer layout.
 */
const TEXT_RELAYOUT_ZOOM = 2;

/** What a page's detail layer should hold. */
interface DetailPlan {
  /** Device pixels per point. */
  scale: number;
  /** The part of the page to draw; null for the whole page. */
  region: PageArea | null;
}

/**
 * pdf.js's PDFPageDetailView redraws its region once the visible area leaves
 * it, or once the margin on one side grows past (1 + 0.5) / 0.5 = 3 times the
 * margin on the opposite side, which is wasted on the region's far side.
 */
const LOPSIDED_MARGIN = 3;

/**
 * Margins narrower than this share of the visible span never make a region
 * lopsided. A region without a margin, which a detail budget smaller than the
 * visible area leaves, keeps only the pixel or so that snapping to whole
 * pixels adds on each side, unevenly: counted as lopsided, it was drawn again
 * and again, about 60 times a second, while the view stood still.
 */
const MIN_LOPSIDED_MARGIN = 0.02;

function shouldRedrawRegion(region: PageArea, visible: PageArea): boolean {
  if (
    visible.minX < region.minX ||
    visible.minY < region.minY ||
    visible.maxX > region.maxX ||
    visible.maxY > region.maxY
  ) {
    return true;
  }
  const left = visible.minX - region.minX;
  const right = region.maxX - visible.maxX;
  const top = visible.minY - region.minY;
  const bottom = region.maxY - visible.maxY;
  const width = (visible.maxX - visible.minX) * MIN_LOPSIDED_MARGIN;
  const height = (visible.maxY - visible.minY) * MIN_LOPSIDED_MARGIN;
  return (
    (region.minX > 0 && right > width && right / left > LOPSIDED_MARGIN) ||
    (region.maxX < 1 && left > width && left / right > LOPSIDED_MARGIN) ||
    (region.minY > 0 && bottom > height && bottom / top > LOPSIDED_MARGIN) ||
    (region.maxY < 1 && top > height && top / bottom > LOPSIDED_MARGIN)
  );
}

/** Lowers `scale` until a page of `size` points fits in `maxPixels`. */
function capScale(scale: number, size: PageSize | undefined, maxPixels: number): number {
  if (!size) return scale;
  const pixels = size.width * scale * (size.height * scale);
  return pixels > maxPixels ? scale * Math.sqrt(maxPixels / pixels) : scale;
}

/** Positions a detail canvas over `region` of its page, or over the whole page. */
function placeDetail(canvas: HTMLCanvasElement, region: PageArea | null): void {
  const { style } = canvas;
  const area = region ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  style.left = `${area.minX * 100}%`;
  style.top = `${area.minY * 100}%`;
  style.width = `${(area.maxX - area.minX) * 100}%`;
  style.height = `${(area.maxY - area.minY) * 100}%`;
}

/**
 * Keeps a text layer at the zoom it is laid out for, `scale` CSS pixels per
 * point, whatever its page shows; null hands it back to the page's zoom.
 */
function pinTextLayer(container: HTMLElement, scale: number | null): void {
  if (scale === null) container.style.removeProperty("--total-scale-factor");
  else container.style.setProperty("--total-scale-factor", String(scale));
  container.style.scale = "";
}

/** Scales a pinned text layer with CSS to the page's zoom, `scale`, without laying it out. */
function followZoom(slot: Slot, scale: number): void {
  if (!slot.text || slot.textScale === 0) return;
  slot.text.style.scale = scale === slot.textScale ? "" : String(scale / slot.textScale);
}

const whenIdle: (callback: () => void) => void =
  typeof requestIdleCallback === "function"
    ? (callback) => requestIdleCallback(callback, { timeout: 300 })
    : (callback) => setTimeout(callback, 16);

export class RenderScheduler {
  readonly stats: SchedulerStats = {
    base: 0,
    detail: 0,
    text: 0,
    textUpdates: 0,
    annotations: 0,
    cancelled: 0,
    failed: 0,
    trimmed: 0,
  };
  readonly #doc: PdfEngineDocument;
  readonly #slots = new Map<number, Slot>();
  readonly #maxConcurrent: number;
  readonly #maxDetailPixels: number;
  readonly #maxBasePixels: number;
  readonly #maxCanvasPixels: number;
  readonly #options: SchedulerOptions;
  #input: ScheduleInput | undefined;
  #running = 0;
  #textRunning = false;
  /** Bumped when every canvas becomes stale, so renders started before are dropped. */
  #epoch = 0;
  #textScheduled = false;

  constructor(doc: PdfEngineDocument, options: SchedulerOptions = {}) {
    this.#doc = doc;
    this.#maxConcurrent = options.maxConcurrent ?? 2;
    this.#maxDetailPixels = options.maxDetailPixels ?? 16_777_216;
    this.#maxBasePixels = options.maxBasePixels ?? 2_097_152;
    this.#maxCanvasPixels = options.maxCanvasPixels ?? Number.POSITIVE_INFINITY;
    this.#options = options;
  }

  attach(
    index: number,
    base: HTMLCanvasElement,
    detail: HTMLCanvasElement,
    text: HTMLElement | null,
    annotations: HTMLElement | null,
  ): void {
    this.detach(index);
    this.#slots.set(index, {
      index,
      base,
      detail,
      text,
      annotations,
      baseScale: 0,
      detailScale: 0,
      detailRegion: null,
      job: undefined,
      textTask: undefined,
      textHandle: undefined,
      textScale: 0,
      textRotation: 0,
      annotationTask: undefined,
      annotationHandle: undefined,
      annotationScale: 0,
      annotationRotation: 0,
    });
    this.#pump();
  }

  detach(index: number): void {
    const slot = this.#slots.get(index);
    if (!slot) return;
    this.#slots.delete(index);
    slot.job?.task.cancel();
    slot.textTask?.cancel();
    slot.annotationTask?.cancel();
    if (slot.textHandle) this.#options.onTextRemoved?.(index);
    if (slot.text) {
      this.#options.selection?.remove(slot.text);
      slot.text.replaceChildren();
      pinTextLayer(slot.text, null);
    }
    slot.annotations?.replaceChildren();
    // Zero-sized canvases hand their backing memory back immediately, which
    // matters on iOS where total canvas memory is capped.
    for (const canvas of [slot.base, slot.detail]) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.#doc.releasePage(index);
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
      slot.base.width = 0;
      slot.base.height = 0;
      this.#clearDetail(slot);
      if (slot.textHandle) {
        slot.textHandle.update(slot.textScale, rotation);
        slot.textRotation = rotation;
      }
      if (slot.annotationHandle) {
        slot.annotationHandle.update(slot.annotationScale, rotation);
        slot.annotationRotation = rotation;
      }
    }
    // The next update() brings the turned layout and starts the new renders.
  }

  /** Cancels all work and releases every page, for example when the document closes. */
  dispose(): void {
    for (const index of [...this.#slots.keys()]) this.detach(index);
  }

  update(input: ScheduleInput): void {
    const zoomed = input.layout.scale !== this.#input?.layout.scale;
    this.#input = input;
    for (const slot of this.#slots.values()) {
      if (zoomed) followZoom(slot, input.layout.scale);
      const plan = this.#detailPlan(slot.index, input);
      const job = slot.job;
      // A page that scrolls in during a fling while its first render, a
      // detail render, is still running gets a quick base instead.
      const blankInView =
        !input.settled &&
        slot.baseScale === 0 &&
        slot.detailScale === 0 &&
        slot.index >= input.first &&
        slot.index <= input.last;
      if (job?.layer === "detail" && (!plan || !sameScale(job.scale, plan.scale) || blankInView)) {
        job.task.cancel();
      }
      if (!plan && slot.detailScale > 0) {
        // Pages that left the viewport at a region-rendering zoom give their
        // detail memory back; their base layer still shows.
        this.#clearDetail(slot);
      }
    }
    this.#pump();
  }

  hasPixels(index: number): boolean {
    const slot = this.#slots.get(index);
    return slot !== undefined && (slot.baseScale > 0 || slot.detailScale > 0);
  }

  textHandle(index: number): TextLayerHandle | undefined {
    return this.#slots.get(index)?.textHandle;
  }

  /**
   * How sharp a page looks over `area`: the resolution of its pixels as a
   * share of `needed` device pixels per point, weighted by area. 1 means
   * full resolution everywhere, 0 means blank.
   */
  sharpness(index: number, area: PageArea, needed: number): number {
    const slot = this.#slots.get(index);
    const total = areaSize(area);
    if (!slot || total === 0) return 0;
    const base = Math.min(1, slot.baseScale / needed);
    if (slot.detailScale === 0) return base;
    const detail = Math.max(base, Math.min(1, slot.detailScale / needed));
    const covered = slot.detailRegion ? areaSize(intersectAreas(area, slot.detailRegion)) : total;
    return (covered * detail + (total - covered) * base) / total;
  }

  #baseScale(index: number, input: ScheduleInput): number {
    return capScale(
      input.layout.scale * BASE_FACTOR,
      input.layout.sizes[index],
      this.#maxBasePixels,
    );
  }

  /**
   * A page whose full-resolution render fits in maxDetailPixels gets detail
   * for the whole page. A larger one gets detail only while visible, for the
   * visible area grown by up to its own size on each side as far as the pixel
   * budget allows, as in pdf.js's PDFPageDetailView. Null: no detail layer.
   */
  #detailPlan(index: number, input: ScheduleInput): DetailPlan | null {
    const { layout, devicePixelRatio } = input;
    const size = layout.sizes[index];
    if (!size) return null;
    const scale = layout.scale * devicePixelRatio;
    const pagePixels = size.width * scale * (size.height * scale);
    if (pagePixels <= this.#maxDetailPixels) return { scale, region: null };
    const visible = visibleArea(layout, index, input.viewport);
    if (!visible) return null;
    const visiblePixels = areaSize(visible) * pagePixels;
    const overflow = Math.min(
      1,
      Math.max(0, (Math.sqrt(this.#maxDetailPixels / visiblePixels) - 1) / 2),
    );
    const growX = (visible.maxX - visible.minX) * overflow;
    const growY = (visible.maxY - visible.minY) * overflow;
    const region = {
      minX: Math.max(0, visible.minX - growX),
      minY: Math.max(0, visible.minY - growY),
      maxX: Math.min(1, visible.maxX + growX),
      maxY: Math.min(1, visible.maxY + growY),
    };
    // A viewport larger than the budget gets its detail at lower resolution.
    const regionPixels = areaSize(region) * pagePixels;
    return {
      scale:
        regionPixels > this.#maxDetailPixels
          ? scale * Math.sqrt(this.#maxDetailPixels / regionPixels)
          : scale,
      region,
    };
  }

  #needsDetail(slot: Slot, plan: DetailPlan, input: ScheduleInput): boolean {
    if (!sameScale(slot.detailScale, plan.scale)) return true;
    if (!plan.region) return slot.detailRegion !== null;
    if (!slot.detailRegion) return true;
    const visible = visibleArea(input.layout, slot.index, input.viewport);
    return visible !== null && shouldRedrawRegion(slot.detailRegion, visible);
  }

  /** Pixels of page `index` drawn at `scale` device pixels per point, over `region` or all of it. */
  #pixels(index: number, scale: number, region: PageArea | null, input: ScheduleInput): number {
    const size = input.layout.sizes[index];
    if (!size) return 0;
    return size.width * scale * size.height * scale * (region ? areaSize(region) : 1);
  }

  /** Pixels a layer holds, or will hold once its running render sizes the canvas. */
  #layerPixels(slot: Slot, layer: Layer, input: ScheduleInput): number {
    const job = slot.job;
    if (job?.layer === layer) return this.#pixels(slot.index, job.scale, job.region, input);
    const canvas = layer === "base" ? slot.base : slot.detail;
    return canvas.width * canvas.height;
  }

  #canvasPixels(input: ScheduleInput): number {
    let total = 0;
    for (const slot of this.#slots.values()) {
      total += this.#layerPixels(slot, "base", input) + this.#layerPixels(slot, "detail", input);
    }
    return total;
  }

  /**
   * Over maxCanvasPixels, pages outside the viewport give their pixels back,
   * farthest first and detail before base. Visible pages keep theirs.
   */
  #trim(input: ScheduleInput): void {
    if (this.#maxCanvasPixels === Number.POSITIVE_INFINITY) return;
    let total = this.#canvasPixels(input);
    if (total <= this.#maxCanvasPixels) return;
    const outside = [...this.#slots.values()]
      .filter((slot) => slot.index < input.first || slot.index > input.last)
      .sort((a, b) => Math.abs(b.index - input.focus) - Math.abs(a.index - input.focus));
    for (const layer of ["detail", "base"] as const) {
      for (const slot of outside) {
        if (total <= this.#maxCanvasPixels) return;
        const pixels = this.#layerPixels(slot, layer, input);
        if (pixels === 0) continue;
        // A running render ends through its own promise, which frees its slot.
        if (slot.job?.layer === layer) slot.job.task.cancel();
        if (layer === "detail") this.#clearDetail(slot);
        else {
          slot.baseScale = 0;
          slot.base.width = 0;
          slot.base.height = 0;
        }
        this.stats.trimmed++;
        total -= pixels;
      }
    }
  }

  #clearDetail(slot: Slot): void {
    slot.detailScale = 0;
    slot.detailRegion = null;
    slot.detail.width = 0;
    slot.detail.height = 0;
  }

  #byDistance(input: ScheduleInput): Slot[] {
    return [...this.#slots.values()].sort(
      (a, b) => Math.abs(a.index - input.focus) - Math.abs(b.index - input.focus),
    );
  }

  /** Highest-priority idle slot and the canvas layer it needs, or nothing to do. */
  #next(): { slot: Slot; layer: Layer; scale: number; region: PageArea | null } | undefined {
    const input = this.#input;
    if (!input) return undefined;
    const idle = this.#byDistance(input).filter((slot) => slot.job === undefined);
    const visible = (slot: Slot) => slot.index >= input.first && slot.index <= input.last;
    const plans = new Map<Slot, DetailPlan | null>();
    const planOf = (slot: Slot) => {
      if (!plans.has(slot)) plans.set(slot, this.#detailPlan(slot.index, input));
      return plans.get(slot) ?? null;
    };
    const needsDetail = (slot: Slot) => {
      const plan = planOf(slot);
      return plan !== null && this.#needsDetail(slot, plan, input);
    };
    // A base render from a very different zoom level still beats an empty page,
    // so refreshing it comes last.
    const staleBase = (slot: Slot) => {
      const target = this.#baseScale(slot.index, input);
      return slot.baseScale > 0 && (slot.baseScale > target * 2 || slot.baseScale < target / 2);
    };

    // A base under current whole-page detail would never show. Once scrolling
    // settles, a page outside the viewport that gets whole-page detail renders
    // it without a base first: the detail has time to arrive before the page
    // scrolls in, and drawing both doubled the work for every page that slow
    // scrolling brought in.
    const needsBase = (slot: Slot) =>
      slot.baseScale === 0 &&
      !(slot.detailScale > 0 && slot.detailRegion === null && !needsDetail(slot));
    const detailFirst = (slot: Slot) => input.settled && planOf(slot)?.region === null;
    // See QUICK_DETAIL_BASES.
    const quickDetail = (slot: Slot) => {
      if (!input.settled || slot.baseScale > 0 || slot.detailScale > 0) return false;
      const plan = planOf(slot);
      return (
        plan !== null &&
        plan.region === null &&
        this.#pixels(slot.index, plan.scale, null, input) <=
          this.#maxBasePixels * QUICK_DETAIL_BASES
      );
    };
    // Pages outside the viewport render only within maxCanvasPixels.
    const total = this.#canvasPixels(input);
    const fits = (slot: Slot, layer: Layer) => {
      const plan = layer === "detail" ? planOf(slot) : null;
      const pixels =
        layer === "base"
          ? this.#pixels(slot.index, this.#baseScale(slot.index, input), null, input)
          : plan
            ? this.#pixels(slot.index, plan.scale, plan.region, input)
            : 0;
      return total - this.#layerPixels(slot, layer, input) + pixels <= this.#maxCanvasPixels;
    };

    const phases: [(slot: Slot) => boolean, Layer][] = [
      [(slot) => visible(slot) && needsBase(slot) && !quickDetail(slot), "base"],
      [(slot) => input.settled && visible(slot) && needsDetail(slot), "detail"],
      [
        (slot) => !visible(slot) && needsBase(slot) && !detailFirst(slot) && fits(slot, "base"),
        "base",
      ],
      [
        (slot) => input.settled && !visible(slot) && needsDetail(slot) && fits(slot, "detail"),
        "detail",
      ],
      [(slot) => input.settled && staleBase(slot) && (visible(slot) || fits(slot, "base")), "base"],
    ];
    for (const [matches, layer] of phases) {
      const slot = idle.find(matches);
      if (slot) {
        if (layer === "base") {
          return { slot, layer, scale: this.#baseScale(slot.index, input), region: null };
        }
        const plan = planOf(slot);
        if (plan) return { slot, layer, scale: plan.scale, region: plan.region };
      }
    }
    return undefined;
  }

  #pump(): void {
    if (this.#input) this.#trim(this.#input);
    while (this.#running < this.#maxConcurrent) {
      const next = this.#next();
      if (!next) break;
      this.#start(next.slot, next.layer, next.scale, next.region);
    }
    this.#scheduleText();
  }

  #start(slot: Slot, layer: Layer, scale: number, plannedRegion: PageArea | null): void {
    const canvas = layer === "base" ? slot.base : slot.detail;
    let region = plannedRegion;
    let pixels: RenderRegion | undefined;
    const layout = this.#input?.layout;
    const unturned = layout?.sizes[slot.index];
    const size = layout && unturned ? turnedSize(unturned, layout.rotation) : undefined;
    if (region && size) {
      // Snap the region to whole pixels so it lines up with the base below.
      const width = size.width * scale;
      const height = size.height * scale;
      const x = Math.floor(region.minX * width);
      const y = Math.floor(region.minY * height);
      const right = Math.min(Math.ceil(width), Math.ceil(region.maxX * width));
      const bottom = Math.min(Math.ceil(height), Math.ceil(region.maxY * height));
      pixels = { x, y, width: right - x, height: bottom - y };
      region = { minX: x / width, minY: y / height, maxX: right / width, maxY: bottom / height };
    }
    // The canvas is resized, which clears it, before the page next paints, so
    // moving it now never shows old pixels in the new place, and the page has
    // none of this layer's pixels until the render completes.
    if (layer === "detail") {
      placeDetail(canvas, region);
      slot.detailScale = 0;
      slot.detailRegion = null;
    } else slot.baseScale = 0;
    const task = this.#doc.render({
      pageIndex: slot.index,
      scale,
      rotation: layout?.rotation ?? 0,
      canvas,
      ...(pixels ? { region: pixels } : {}),
    });
    slot.job = { layer, scale, region, task };
    this.#running++;
    const epoch = this.#epoch;
    const current = () => this.#slots.get(slot.index) === slot && epoch === this.#epoch;
    task.promise
      .then(
        () => {
          if (!current()) return;
          if (layer === "base") {
            slot.baseScale = scale;
            this.stats.base++;
          } else {
            slot.detailScale = scale;
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
          }
          if (layer === "detail" && current()) {
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

  #scheduleText(): void {
    if (this.#textScheduled || this.#textRunning || !this.#input?.settled) return;
    this.#textScheduled = true;
    whenIdle(() => {
      this.#textScheduled = false;
      this.#pumpText();
    });
  }

  /**
   * Start or refresh at most one DOM layer: visible pages before overscan,
   * text before links, building before re-measuring after a zoom.
   */
  #pumpText(): void {
    const input = this.#input;
    if (!input?.settled || this.#textRunning) return;
    // Text and annotations are parsed again in the engine's worker, so they
    // wait while a visible page renders its first pixels: on a page of
    // 200,000 segments, the text layer used to delay them by 48 ms. The
    // render's completion pumps again.
    for (let index = input.first; index <= input.last; index++) {
      const slot = this.#slots.get(index);
      if (slot?.job && slot.baseScale === 0 && slot.detailScale === 0) return;
    }
    const { scale, rotation } = input.layout;
    const slots = this.#byDistance(input);
    const visible = (slot: Slot) => slot.index >= input.first && slot.index <= input.last;
    const needsText = (slot: Slot) => slot.text !== null && !slot.textHandle && !slot.textTask;
    const needsLinks = (slot: Slot) =>
      slot.annotations !== null && !slot.annotationHandle && !slot.annotationTask;
    for (const inWindow of [visible, (slot: Slot) => !visible(slot)]) {
      const text = slots.find((slot) => inWindow(slot) && needsText(slot));
      if (text) {
        this.#startText(text, scale, rotation);
        return;
      }
      const links = slots.find((slot) => inWindow(slot) && needsLinks(slot));
      if (links) {
        this.#startAnnotations(links, scale, rotation);
        return;
      }
    }
    // Lay visible text out again, one page per idle period, once the zoom has
    // gone in past TEXT_RELAYOUT_ZOOM times its layout zoom; CSS scales it
    // until then (see followZoom). Pages outside the viewport wait until they
    // scroll in.
    const textStale = (slot: Slot) =>
      slot.textHandle !== undefined &&
      (scale > slot.textScale * TEXT_RELAYOUT_ZOOM || slot.textRotation !== rotation);
    const linksStale = (slot: Slot) =>
      slot.annotationHandle !== undefined &&
      (!sameScale(slot.annotationScale, scale) || slot.annotationRotation !== rotation);
    const stale = slots.find((slot) => visible(slot) && (textStale(slot) || linksStale(slot)));
    if (stale) {
      if (textStale(stale) && stale.text) {
        pinTextLayer(stale.text, scale);
        stale.textHandle?.update(scale, rotation);
        stale.textScale = scale;
        stale.textRotation = rotation;
        this.stats.textUpdates++;
      }
      if (linksStale(stale)) {
        stale.annotationHandle?.update(scale, rotation);
        stale.annotationScale = scale;
        stale.annotationRotation = rotation;
      }
      this.#scheduleText();
    }
  }

  #startAnnotations(slot: Slot, cssScale: number, rotation: Rotation): void {
    const container = slot.annotations;
    const links = this.#options.links;
    if (!container || !links) return;
    container.replaceChildren();
    const task = this.#doc.renderAnnotationLayer({
      pageIndex: slot.index,
      container,
      cssScale,
      rotation,
      links,
    });
    slot.annotationTask = task;
    this.#textRunning = true;
    task.promise
      .then(
        (handle) => {
          if (this.#slots.get(slot.index) !== slot || slot.annotationTask !== task) return;
          slot.annotationHandle = handle;
          slot.annotationScale = cssScale;
          slot.annotationRotation = rotation;
          this.stats.annotations++;
        },
        (error: unknown) => {
          if (isRenderCancelled(error)) this.stats.cancelled++;
          else {
            this.stats.failed++;
            console.error(`page ${slot.index + 1}: annotation layer failed`, error);
          }
        },
      )
      .finally(() => {
        if (slot.annotationTask === task) slot.annotationTask = undefined;
        this.#textRunning = false;
        this.#scheduleText();
      });
  }

  #startText(slot: Slot, cssScale: number, rotation: Rotation): void {
    const container = slot.text;
    if (!container) return;
    this.#options.selection?.remove(container);
    container.replaceChildren();
    pinTextLayer(container, cssScale);
    slot.textScale = cssScale;
    const task = this.#doc.renderTextLayer({
      pageIndex: slot.index,
      container,
      cssScale,
      rotation,
    });
    slot.textTask = task;
    this.#textRunning = true;
    task.promise
      .then(
        (handle) => {
          if (this.#slots.get(slot.index) !== slot || slot.textTask !== task) return;
          // Like pdf.js's viewer, end with an element that catches drags past
          // the last run so selections do not jump to the page's start.
          const end = document.createElement("div");
          end.className = "endOfContent";
          container.append(end);
          this.#options.selection?.add(container, end);
          slot.textHandle = handle;
          slot.textRotation = rotation;
          this.stats.text++;
          this.#options.onTextReady?.(slot.index, handle);
        },
        (error: unknown) => {
          if (isRenderCancelled(error)) this.stats.cancelled++;
          else {
            this.stats.failed++;
            console.error(`page ${slot.index + 1}: text layer failed`, error);
          }
        },
      )
      .finally(() => {
        if (slot.textTask === task) slot.textTask = undefined;
        this.#textRunning = false;
        this.#scheduleText();
      });
  }
}

const sameScale = (a: number, b: number): boolean => Math.abs(a - b) <= b * 0.01;
