"use client";

import type { PageSize } from "../../document/session.ts";
import type { Rotation } from "../../pdfjs/draw.ts";
import type { LayerState } from "../../pdfjs/layers.ts";
import type { Renderer } from "../../render/renderer.ts";
import { turnedSize } from "../../view/layout.ts";

/**
 * Default pixel budget for detached thumbnail canvases kept across virtualized
 * sidebar scrolling (~32 MiB at 4 bytes/pixel, or ~110 thumbnails at 120 CSS px
 * on a 2x display). Cleared immediately on `reset()` when the document closes,
 * layers or content change, or the thumbnail list unmounts.
 */
const DEFAULT_MAX_KEPT_PIXELS = 8 * 1024 * 1024;

/** What thumbnails need from the viewer. */
export interface ThumbnailHost {
  /** The open document's renderer; null until it loads. */
  renderer(): Renderer | null;
  /** A page's size in PDF points, unturned by the view. */
  pageSize(pageIndex: number): PageSize | undefined;
  rotation(): Rotation;
  /** Which layers show in the document's viewers. */
  layers(): LayerState | null;
  /** Optional pixel budget override for kept unmounted thumbnail canvases. */
  maxKeptPixels?: number | undefined;
}

export interface AttachThumbnailOptions {
  /**
   * Set by `<PdfThumbnails>` when the caller already window-virtualizes the
   * mounted items: skips `getComputedStyle` scroll-parent walks and per-item
   * `IntersectionObserver` registration, draws immediately, and retains drawn
   * canvases in a bounded LRU pool when items scroll out of the window.
   */
  virtualized?: boolean | undefined;
}

interface Thumbnail {
  readonly pageIndex: number;
  readonly canvas: HTMLCanvasElement;
  /** Width in CSS pixels. */
  readonly width: number;
  /** Near enough to the visible part of its scroller to be drawn. */
  near: boolean;
  /** What the canvas holds: the view rotation and pixel width it was drawn for. */
  drawn: string | null;
  cancel: (() => void) | null;
}

interface KeptThumbnail {
  readonly canvas: HTMLCanvasElement;
  readonly key: string;
  readonly pixels: number;
}

/**
 * Thumbnails share the viewer's render slots but only take what the pages in
 * view leave (`Renderer.enqueue`), copy a page's drawing instead of rendering
 * when the viewer already has one large enough, and keep a bounded LRU pool of
 * unmounted thumbnail canvases so scrolling a virtualized `<PdfThumbnails>`
 * sidebar back and forth restores thumbnails synchronously without re-rendering
 * in pdf.js. Standalone `<PdfThumbnail>` elements observe their scroll parent
 * so non-virtualized lists hold pixels only near view.
 */
export class ThumbnailRenderer {
  readonly #host: ThumbnailHost;
  readonly #byCanvas = new Map<Element, Thumbnail>();
  /** One observer per scroll container, which a margin of its height extends, and its thumbnails. */
  readonly #observers = new Map<
    Element | null,
    { observer: IntersectionObserver; count: number }
  >();
  /** Unmounted drawn canvases by page index, least recently kept first. */
  readonly #kept = new Map<number, KeptThumbnail>();
  #keptPixels = 0;
  #trimQueued = false;
  readonly #maxKeptPixels: number;

  constructor(host: ThumbnailHost) {
    this.#host = host;
    this.#maxKeptPixels = host.maxKeptPixels ?? DEFAULT_MAX_KEPT_PIXELS;
  }

  /** Total device pixels currently held in the unmounted thumbnail LRU pool. */
  get keptPixels(): number {
    return this.#keptPixels;
  }

  /** Draw page `pageIndex` into `canvas`, `width` CSS pixels wide, while near view. */
  attach(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    width: number,
    options?: AttachThumbnailOptions,
  ): () => void {
    const virtualized = options?.virtualized === true;
    const thumbnail: Thumbnail = {
      pageIndex,
      canvas,
      width,
      near: virtualized,
      drawn: null,
      cancel: null,
    };
    this.#byCanvas.set(canvas, thumbnail);

    if (virtualized) {
      this.#draw(thumbnail);
      // If the same canvas re-attached while not drawable (e.g. document closed), drop any stale kept entry for it.
      if (this.#kept.get(pageIndex)?.canvas === canvas) {
        this.#forgetKept(pageIndex);
      }
      return () => {
        if (this.#byCanvas.get(canvas) === thumbnail) this.#byCanvas.delete(canvas);
        thumbnail.cancel?.();
        thumbnail.cancel = null;
        if (thumbnail.drawn !== null && canvas.width > 0 && canvas.height > 0) {
          const drawnKey = thumbnail.drawn;
          thumbnail.drawn = null;
          this.#keep(pageIndex, canvas, drawnKey);
        } else {
          this.#clear(thumbnail);
        }
      };
    }

    const root = scrollParent(canvas);
    const entry = this.#observerFor(root);
    entry.count++;
    entry.observer.observe(canvas);
    return () => {
      entry.observer.unobserve(canvas);
      if (--entry.count === 0) {
        entry.observer.disconnect();
        this.#observers.delete(root);
      }
      if (this.#byCanvas.get(canvas) === thumbnail) this.#byCanvas.delete(canvas);
      this.#clear(thumbnail);
    };
  }

  /** Draw every thumbnail near view that is not drawn yet, say once the document loads. */
  refresh(): void {
    for (const thumbnail of this.#byCanvas.values()) this.#draw(thumbnail);
  }

  /** Drop every mounted and kept thumbnail's pixels, for example when the document closes. */
  reset(): void {
    this.#clearKept();
    for (const thumbnail of this.#byCanvas.values()) this.#clear(thumbnail);
  }

  #observerFor(root: Element | null): { observer: IntersectionObserver; count: number } {
    let entry = this.#observers.get(root);
    if (!entry) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const thumbnail = this.#byCanvas.get(entry.target);
            if (!thumbnail) continue;
            thumbnail.near = entry.isIntersecting;
            if (thumbnail.near) this.#draw(thumbnail);
            else this.#clear(thumbnail);
          }
        },
        { root, rootMargin: "100% 0px" },
      );
      entry = { observer, count: 0 };
      this.#observers.set(root, entry);
    }
    return entry;
  }

  #draw(thumbnail: Thumbnail): void {
    const renderer = this.#host.renderer();
    const size = this.#host.pageSize(thumbnail.pageIndex);
    if (!thumbnail.near || !renderer || !size || size.width === 0 || size.height === 0) return;
    const rotation = this.#host.rotation();
    const turned = turnedSize(size, rotation);
    const width = Math.max(1, Math.round(thumbnail.width * (window.devicePixelRatio || 1)));
    // Rounded down as pdf.js's drawings are sized, so a thumbnail keeps its
    // size whether it is copied from the page or drawn: in CI's Chromium a
    // drawn one came out 1 px shorter than a copied one.
    const height = Math.max(1, Math.floor((width * turned.height) / turned.width + 1e-6));
    const key = `${rotation} ${width}`;
    if (thumbnail.drawn === key || thumbnail.cancel) return;
    const { canvas } = thumbnail;
    if (this.#restoreKept(thumbnail.pageIndex, canvas, key, width, height)) {
      thumbnail.drawn = key;
      return;
    }
    canvas.width = width;
    canvas.height = height;
    if (renderer.copyPage(thumbnail.pageIndex, canvas, rotation)) {
      thumbnail.drawn = key;
      return;
    }
    const layers = this.#host.layers();
    thumbnail.cancel = renderer.enqueue(
      thumbnail.pageIndex,
      {
        scale: width / turned.width,
        rotation,
        canvas,
        ...(layers ? { layers: layers.config } : {}),
      },
      (error) => {
        thumbnail.cancel = null;
        // A failed page stays blank; the renderer has logged the failure.
        if (error === null) thumbnail.drawn = key;
      },
    );
  }

  #keep(pageIndex: number, canvas: HTMLCanvasElement, key: string): void {
    const budget = this.#maxKeptPixels;
    const pixels = canvas.width * canvas.height;
    if (budget <= 0 || pixels <= 0 || pixels > budget) {
      releaseCanvas(canvas);
      return;
    }
    const existing = this.#kept.get(pageIndex);
    if (existing) {
      this.#kept.delete(pageIndex);
      this.#keptPixels -= existing.pixels;
      if (existing.canvas !== canvas) releaseCanvas(existing.canvas);
    }
    this.#kept.set(pageIndex, { canvas, key, pixels });
    this.#keptPixels += pixels;
    if (!this.#trimQueued) {
      this.#trimQueued = true;
      queueMicrotask(() => {
        this.#trimQueued = false;
        this.#trimKept(this.#maxKeptPixels);
      });
    }
  }

  #restoreKept(
    pageIndex: number,
    target: HTMLCanvasElement,
    key: string,
    width: number,
    height: number,
  ): boolean {
    const kept = this.#kept.get(pageIndex);
    if (!kept) return false;
    this.#kept.delete(pageIndex);
    this.#keptPixels -= kept.pixels;
    if (kept.key !== key || kept.canvas.width !== width || kept.canvas.height !== height) {
      if (kept.canvas !== target) releaseCanvas(kept.canvas);
      return false;
    }
    if (kept.canvas === target) return true;
    target.width = width;
    target.height = height;
    const context = target.getContext("2d", { alpha: false });
    if (!context) {
      releaseCanvas(kept.canvas);
      return false;
    }
    context.drawImage(kept.canvas, 0, 0);
    releaseCanvas(kept.canvas);
    return true;
  }

  #forgetKept(pageIndex: number): void {
    const kept = this.#kept.get(pageIndex);
    if (!kept) return;
    this.#kept.delete(pageIndex);
    this.#keptPixels -= kept.pixels;
    releaseCanvas(kept.canvas);
  }

  #trimKept(limit: number): void {
    while (this.#keptPixels > limit && this.#kept.size > 0) {
      const oldest = this.#kept.keys().next();
      if (!oldest.done) this.#forgetKept(oldest.value);
    }
  }

  #clearKept(): void {
    for (const kept of this.#kept.values()) releaseCanvas(kept.canvas);
    this.#kept.clear();
    this.#keptPixels = 0;
  }

  #clear(thumbnail: Thumbnail): void {
    thumbnail.cancel?.();
    thumbnail.cancel = null;
    thumbnail.drawn = null;
    releaseCanvas(thumbnail.canvas);
  }
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** The nearest ancestor that scrolls vertically; null for the document. */
function scrollParent(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}
