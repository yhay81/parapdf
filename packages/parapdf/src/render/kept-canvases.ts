"use client";

import type { Rotation } from "../pdfjs/draw.ts";
import type { PageArea } from "../view/layout.ts";
import { release } from "./page.ts";
import type { ViewInput } from "./planner.ts";

/**
 * The canvases kept from pages that unmounted hold at most this many
 * viewports' worth of device pixels by default (`maxKeptPixels`): a few pages
 * at fit-width, so that going back to them, by a link's back, by scrolling,
 * or by flipping, shows them at once. Kept, a page came back sharp after 3
 * to 38 ms instead of 23 to 176 in the return benchmark, and twelve rather
 * than six brought a scroll back over ten or twenty pages sharp about a
 * second sooner, drawing nothing again (decision 0004).
 */
const KEPT_VIEWPORTS = 12;

/**
 * The canvases of a page that unmounted, kept with what they show: its
 * whole-page detail alone, which covers its base, or its base and any
 * partial detail.
 */
export interface KeptPage {
  readonly rotation: Rotation;
  readonly version: number;
  readonly base: { readonly canvas: HTMLCanvasElement; readonly scale: number } | null;
  readonly detail: {
    readonly canvas: HTMLCanvasElement;
    readonly scale: number;
    readonly region: PageArea | null;
  } | null;
}

/**
 * The canvases of pages that unmounted, by page, within a budget of device
 * pixels (decision 0004). The renderer says what a page keeps and shows it
 * again; these hold the canvases, count their pixels, and release them, the
 * least recently kept first.
 */
export class KeptCanvases {
  /** By page, least recently kept first. */
  readonly #pages = new Map<number, { readonly page: KeptPage; readonly pixels: number }>();
  #pixels = 0;
  #trimQueued = false;
  /** `maxKeptPixels`; undefined follows the viewport. */
  #maxPixels: number | undefined;
  /** Whether pages that unmount keep their canvases now; see setKeeping. */
  #keeping = true;
  /** The renderer's view now, whose viewport sets the default budget. */
  readonly #view: () => ViewInput | undefined;

  constructor(maxPixels: number | undefined, view: () => ViewInput | undefined) {
    this.#maxPixels = maxPixels;
    this.#view = view;
  }

  /** Pixels of the canvases kept. */
  get pixels(): number {
    return this.#pixels;
  }

  /** The most pixels the canvases kept may hold now. */
  #budget(): number {
    if (!this.#keeping) return 0;
    if (this.#maxPixels !== undefined) return this.#maxPixels;
    const input = this.#view();
    if (!input) return 0;
    const { width, height } = input.viewport;
    return KEPT_VIEWPORTS * width * height * input.devicePixelRatio ** 2;
  }

  /**
   * Whether pages that unmount keep their canvases: not while the viewer
   * has no viewport, so that canvases kept for pages that cannot come back
   * do not hold memory until the document closes. Turning it off lets the
   * canvases kept so far go.
   */
  setKeeping(keeping: boolean): void {
    this.#keeping = keeping;
    if (!keeping) this.clear();
  }

  /**
   * Keeps the canvases of page `index`, which unmounts, in place of what it
   * kept before, unless they alone exceed the budget; returns whether it did.
   */
  keep(index: number, page: KeptPage): boolean {
    const budget = this.#budget();
    if (budget <= 0) return false;
    const pixels = [page.detail?.canvas, page.base?.canvas].reduce(
      (sum, canvas) => sum + (canvas ? canvas.width * canvas.height : 0),
      0,
    );
    if (pixels > budget) return false;
    this.#forget(index);
    this.#pages.set(index, { page, pixels });
    this.#pixels += pixels;
    // Over the budget, the least recently kept go once the pages mounting
    // in the same React commit, which unmounts pages before it mounts
    // others, have taken theirs back: a jump away and back unmounted the
    // pages it went to and let the ones it came back to go first.
    if (!this.#trimQueued) {
      this.#trimQueued = true;
      queueMicrotask(() => {
        this.#trimQueued = false;
        this.trim(this.#budget());
      });
    }
    return true;
  }

  /**
   * Takes back what page `index` kept, if it was drawn for `rotation` and
   * the content `version`, the view's now; the rest goes.
   */
  take(index: number, rotation: Rotation, version: number): KeptPage | undefined {
    const kept = this.#pages.get(index);
    if (!kept) return undefined;
    const { page } = kept;
    // A kept canvas cleared meanwhile has nothing to show.
    const cleared = [page.base?.canvas, page.detail?.canvas].some(
      (canvas) => canvas !== undefined && canvas.width * canvas.height === 0,
    );
    if (cleared || page.rotation !== rotation || page.version !== version) {
      this.#forget(index);
      return undefined;
    }
    this.#pages.delete(index);
    this.#pixels -= kept.pixels;
    return page;
  }

  /** Releases the least recently kept while they hold more than `limit` pixels. */
  trim(limit: number): void {
    while (this.#pixels > limit && this.#pages.size > 0) {
      const oldest = this.#pages.keys().next();
      if (!oldest.done) this.#forget(oldest.value);
    }
  }

  /** Releases them all. */
  clear(): void {
    for (const index of [...this.#pages.keys()]) this.#forget(index);
  }

  /** Releases them all, and keeps nothing from now on, as when the document closes. */
  close(): void {
    this.#maxPixels = 0;
    this.clear();
  }

  #forget(index: number): void {
    const kept = this.#pages.get(index);
    if (!kept) return;
    this.#pages.delete(index);
    this.#pixels -= kept.pixels;
    for (const canvas of [kept.page.base?.canvas, kept.page.detail?.canvas]) {
      if (canvas) release(canvas);
    }
  }
}
