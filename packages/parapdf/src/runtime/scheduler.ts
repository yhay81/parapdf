import {
  type AnnotationLayerHandle,
  type AnnotationLayerTask,
  isRenderCancelled,
  type LinkHandlers,
  type PdfEngineDocument,
  type RenderTask,
  type TextLayerHandle,
  type TextLayerTask,
} from "../engine/types.ts";
import type { Layout } from "./layout.ts";

type Layer = "base" | "detail";

/**
 * Each mounted page owns two stacked canvases. The base layer is a quick,
 * low-resolution render that fills the page as soon as it scrolls in; the
 * detail layer covers it at full device resolution once scrolling settles.
 * Because the base stays underneath, re-rendering the detail layer (for
 * example after zooming) never flashes an empty page.
 *
 * The text and annotation layers are DOM built on the main thread, so they
 * are the last things a page gets: one layer at a time, only after scrolling
 * settles, during idle periods, text before links.
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
  job: { layer: Layer; scale: number; task: RenderTask } | undefined;
  textTask: TextLayerTask | undefined;
  textHandle: TextLayerHandle | undefined;
  /** CSS pixels per point the text runs were measured for. */
  textScale: number;
  annotationTask: AnnotationLayerTask | undefined;
  annotationHandle: AnnotationLayerHandle | undefined;
  annotationScale: number;
}

export interface ScheduleInput {
  layout: Layout;
  /** Pages intersecting the viewport. */
  first: number;
  last: number;
  /** Page nearest the viewport center; work radiates out from it. */
  focus: number;
  devicePixelRatio: number;
  /** Scrolling is slow or stopped, so full-resolution work is worth starting. */
  settled: boolean;
}

export interface SchedulerStats {
  base: number;
  detail: number;
  text: number;
  annotations: number;
  cancelled: number;
  failed: number;
}

export interface SchedulerOptions {
  maxConcurrent?: number;
  /** Detail canvases are capped at this many pixels until region rendering lands. */
  maxDetailPixels?: number;
  /** Where activated links in annotation layers go. */
  links?: LinkHandlers;
  onPainted?: (pageIndex: number, layer: Layer) => void;
  onTextReady?: (pageIndex: number, handle: TextLayerHandle) => void;
  onTextRemoved?: (pageIndex: number) => void;
}

/** Base renders use half a device pixel per CSS pixel at most: fast, and fine as a placeholder. */
const BASE_FACTOR = 0.5;

const whenIdle: (callback: () => void) => void =
  typeof requestIdleCallback === "function"
    ? (callback) => requestIdleCallback(callback, { timeout: 300 })
    : (callback) => setTimeout(callback, 16);

export class RenderScheduler {
  readonly stats: SchedulerStats = {
    base: 0,
    detail: 0,
    text: 0,
    annotations: 0,
    cancelled: 0,
    failed: 0,
  };
  readonly #doc: PdfEngineDocument;
  readonly #slots = new Map<number, Slot>();
  readonly #maxConcurrent: number;
  readonly #maxDetailPixels: number;
  readonly #options: SchedulerOptions;
  #input: ScheduleInput | undefined;
  #running = 0;
  #textRunning = false;
  #textScheduled = false;

  constructor(doc: PdfEngineDocument, options: SchedulerOptions = {}) {
    this.#doc = doc;
    this.#maxConcurrent = options.maxConcurrent ?? 2;
    this.#maxDetailPixels = options.maxDetailPixels ?? 16_777_216;
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
      job: undefined,
      textTask: undefined,
      textHandle: undefined,
      textScale: 0,
      annotationTask: undefined,
      annotationHandle: undefined,
      annotationScale: 0,
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
    slot.text?.replaceChildren();
    slot.annotations?.replaceChildren();
    // Zero-sized canvases hand their backing memory back immediately, which
    // matters on iOS where total canvas memory is capped.
    for (const canvas of [slot.base, slot.detail]) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.#doc.releasePage(index);
  }

  update(input: ScheduleInput): void {
    this.#input = input;
    for (const slot of this.#slots.values()) {
      const job = slot.job;
      if (job?.layer === "detail" && !sameScale(job.scale, this.#detailScale(slot.index, input))) {
        job.task.cancel();
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

  #baseScale(input: ScheduleInput): number {
    return input.layout.scale * BASE_FACTOR;
  }

  #detailScale(index: number, input: ScheduleInput): number {
    const { layout, devicePixelRatio } = input;
    const scale = layout.scale * devicePixelRatio;
    const size = layout.sizes[index];
    if (!size) return scale;
    const pixels = size.width * scale * (size.height * scale);
    return pixels > this.#maxDetailPixels
      ? scale * Math.sqrt(this.#maxDetailPixels / pixels)
      : scale;
  }

  #byDistance(input: ScheduleInput): Slot[] {
    return [...this.#slots.values()].sort(
      (a, b) => Math.abs(a.index - input.focus) - Math.abs(b.index - input.focus),
    );
  }

  /** Highest-priority idle slot and the canvas layer it needs, or nothing to do. */
  #next(): { slot: Slot; layer: Layer; scale: number } | undefined {
    const input = this.#input;
    if (!input) return undefined;
    const idle = this.#byDistance(input).filter((slot) => slot.job === undefined);
    const visible = (slot: Slot) => slot.index >= input.first && slot.index <= input.last;
    const baseScale = this.#baseScale(input);
    const needsDetail = (slot: Slot) =>
      !sameScale(slot.detailScale, this.#detailScale(slot.index, input));
    // A base render from a very different zoom level still beats an empty page,
    // so refreshing it comes last.
    const staleBase = (slot: Slot) =>
      slot.baseScale > 0 && (slot.baseScale > baseScale * 2 || slot.baseScale < baseScale / 2);

    const phases: [(slot: Slot) => boolean, Layer][] = [
      [(slot) => visible(slot) && slot.baseScale === 0, "base"],
      [(slot) => input.settled && visible(slot) && needsDetail(slot), "detail"],
      [(slot) => !visible(slot) && slot.baseScale === 0, "base"],
      [(slot) => input.settled && !visible(slot) && needsDetail(slot), "detail"],
      [(slot) => input.settled && staleBase(slot), "base"],
    ];
    for (const [matches, layer] of phases) {
      const slot = idle.find(matches);
      if (slot) {
        const scale = layer === "base" ? baseScale : this.#detailScale(slot.index, input);
        return { slot, layer, scale };
      }
    }
    return undefined;
  }

  #pump(): void {
    while (this.#running < this.#maxConcurrent) {
      const next = this.#next();
      if (!next) break;
      this.#start(next.slot, next.layer, next.scale);
    }
    this.#scheduleText();
  }

  #start(slot: Slot, layer: Layer, scale: number): void {
    const canvas = layer === "base" ? slot.base : slot.detail;
    const task = this.#doc.render({ pageIndex: slot.index, scale, canvas });
    slot.job = { layer, scale, task };
    this.#running++;
    task.promise
      .then(
        () => {
          if (this.#slots.get(slot.index) !== slot) return;
          if (layer === "base") {
            slot.baseScale = scale;
            this.stats.base++;
          } else {
            slot.detailScale = scale;
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
          if (layer === "detail" && this.#slots.get(slot.index) === slot) {
            // Hide a half-drawn detail layer so the base shows through.
            slot.detailScale = 0;
            slot.detail.width = 0;
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
    const scale = input.layout.scale;
    const slots = this.#byDistance(input);
    const visible = (slot: Slot) => slot.index >= input.first && slot.index <= input.last;
    const needsText = (slot: Slot) => slot.text !== null && !slot.textHandle && !slot.textTask;
    const needsLinks = (slot: Slot) =>
      slot.annotations !== null && !slot.annotationHandle && !slot.annotationTask;
    for (const inWindow of [visible, (slot: Slot) => !visible(slot)]) {
      const text = slots.find((slot) => inWindow(slot) && needsText(slot));
      if (text) {
        this.#startText(text, scale);
        return;
      }
      const links = slots.find((slot) => inWindow(slot) && needsLinks(slot));
      if (links) {
        this.#startAnnotations(links, scale);
        return;
      }
    }
    // Zoom changes only need the layers re-measured; do one page per idle period.
    const stale = slots.find(
      (slot) =>
        visible(slot) &&
        ((slot.textHandle && !sameScale(slot.textScale, scale)) ||
          (slot.annotationHandle && !sameScale(slot.annotationScale, scale))),
    );
    if (stale) {
      if (stale.textHandle && !sameScale(stale.textScale, scale)) {
        stale.textHandle.setScale(scale);
        stale.textScale = scale;
      }
      if (stale.annotationHandle && !sameScale(stale.annotationScale, scale)) {
        stale.annotationHandle.setScale(scale);
        stale.annotationScale = scale;
      }
      this.#scheduleText();
    }
  }

  #startAnnotations(slot: Slot, cssScale: number): void {
    const container = slot.annotations;
    const links = this.#options.links;
    if (!container || !links) return;
    container.replaceChildren();
    const task = this.#doc.renderAnnotationLayer({
      pageIndex: slot.index,
      container,
      cssScale,
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

  #startText(slot: Slot, cssScale: number): void {
    const container = slot.text;
    if (!container) return;
    container.replaceChildren();
    const task = this.#doc.renderTextLayer({ pageIndex: slot.index, container, cssScale });
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
          slot.textHandle = handle;
          slot.textScale = cssScale;
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
