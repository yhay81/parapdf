import { isRenderCancelled, type PdfEngineDocument, type RenderTask } from "../engine/types.ts";
import type { Layout } from "./layout.ts";

type Layer = "base" | "detail";

/**
 * Each mounted page owns two stacked canvases. The base layer is a quick,
 * low-resolution render that fills the page as soon as it scrolls in; the
 * detail layer covers it at full device resolution once scrolling settles.
 * Because the base stays underneath, re-rendering the detail layer (for
 * example after zooming) never flashes an empty page.
 */
interface Slot {
  readonly index: number;
  readonly base: HTMLCanvasElement;
  readonly detail: HTMLCanvasElement;
  /** Device pixels per point of the last completed render, 0 when empty. */
  baseScale: number;
  detailScale: number;
  job: { layer: Layer; scale: number; task: RenderTask } | undefined;
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
  cancelled: number;
  failed: number;
}

export interface SchedulerOptions {
  maxConcurrent?: number;
  /** Detail canvases are capped at this many pixels until region rendering lands. */
  maxDetailPixels?: number;
  onPainted?: (pageIndex: number, layer: Layer) => void;
}

/** Base renders use half a device pixel per CSS pixel at most: fast, and fine as a placeholder. */
const BASE_FACTOR = 0.5;

export class RenderScheduler {
  readonly stats: SchedulerStats = { base: 0, detail: 0, cancelled: 0, failed: 0 };
  readonly #doc: PdfEngineDocument;
  readonly #slots = new Map<number, Slot>();
  readonly #maxConcurrent: number;
  readonly #maxDetailPixels: number;
  readonly #onPainted: SchedulerOptions["onPainted"];
  #input: ScheduleInput | undefined;
  #running = 0;

  constructor(doc: PdfEngineDocument, options: SchedulerOptions = {}) {
    this.#doc = doc;
    this.#maxConcurrent = options.maxConcurrent ?? 2;
    this.#maxDetailPixels = options.maxDetailPixels ?? 16_777_216;
    this.#onPainted = options.onPainted;
  }

  attach(index: number, base: HTMLCanvasElement, detail: HTMLCanvasElement): void {
    this.detach(index);
    this.#slots.set(index, { index, base, detail, baseScale: 0, detailScale: 0, job: undefined });
    this.#pump();
  }

  detach(index: number): void {
    const slot = this.#slots.get(index);
    if (!slot) return;
    this.#slots.delete(index);
    slot.job?.task.cancel();
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

  /** Highest-priority idle slot and the layer it needs, or nothing to do. */
  #next(): { slot: Slot; layer: Layer; scale: number } | undefined {
    const input = this.#input;
    if (!input) return undefined;
    const idle = [...this.#slots.values()]
      .filter((slot) => slot.job === undefined)
      .sort((a, b) => Math.abs(a.index - input.focus) - Math.abs(b.index - input.focus));
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
      if (!next) return;
      this.#start(next.slot, next.layer, next.scale);
    }
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
          this.#onPainted?.(slot.index, layer);
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
}

const sameScale = (a: number, b: number): boolean => Math.abs(a - b) <= b * 0.01;
