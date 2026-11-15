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

interface Thumbnail {
  readonly pageIndex: number;
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Width in CSS pixels. */
  readonly width: number;
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
 * Owns `<canvas class="parapdf-thumbnail">` elements inside `<PdfThumbnails>`'s
 * host slots: shares the viewer's render slots at lower priority
 * (`Renderer.enqueue`), copies a page's drawing instead of rendering when the
 * viewer already has one large enough, and retains detached `<canvas>` nodes in
 * a bounded LRU pool when items scroll out of the virtualized window so
 * scrolling back moves the kept `<canvas>` directly into the new host with zero
 * pixel copy and no second backing-store allocation.
 */
export class ThumbnailRenderer {
  readonly #host: ThumbnailHost;
  readonly #mounted = new Map<HTMLElement, Thumbnail>();
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

  /** Place and draw page `pageIndex`'s `<canvas>` inside `host`, `width` CSS pixels wide. */
  attach(pageIndex: number, host: HTMLElement, width: number): () => void {
    const existing = this.#mounted.get(host);
    if (existing) {
      this.#mounted.delete(host);
      this.#clear(existing);
      existing.canvas.remove();
    }

    const kept = this.#takeKept(pageIndex);
    const canvas = kept ? kept.canvas : createThumbnailCanvas(host);
    host.replaceChildren(canvas);

    const thumbnail: Thumbnail = {
      pageIndex,
      host,
      canvas,
      width,
      drawn: kept ? kept.key : null,
      cancel: null,
    };
    this.#mounted.set(host, thumbnail);
    this.#draw(thumbnail);

    return () => {
      if (this.#mounted.get(host) === thumbnail) this.#mounted.delete(host);
      thumbnail.cancel?.();
      thumbnail.cancel = null;
      canvas.remove();
      if (thumbnail.drawn !== null && canvas.width > 0 && canvas.height > 0) {
        const drawnKey = thumbnail.drawn;
        thumbnail.drawn = null;
        this.#keep(pageIndex, canvas, drawnKey);
      } else {
        this.#clear(thumbnail);
      }
    };
  }

  /** Draw every mounted thumbnail that is not drawn yet, say once the document loads. */
  refresh(): void {
    for (const thumbnail of this.#mounted.values()) this.#draw(thumbnail);
  }

  /** Drop every mounted and kept thumbnail's pixels, for example when the document closes. */
  reset(): void {
    this.#clearKept();
    for (const thumbnail of this.#mounted.values()) this.#clear(thumbnail);
  }

  #draw(thumbnail: Thumbnail): void {
    const renderer = this.#host.renderer();
    const size = this.#host.pageSize(thumbnail.pageIndex);
    if (!renderer || !size || size.width === 0 || size.height === 0) {
      if (thumbnail.drawn !== null) this.#clear(thumbnail);
      return;
    }
    const rotation = this.#host.rotation();
    const turned = turnedSize(size, rotation);
    const width = Math.max(1, Math.round(thumbnail.width * (window.devicePixelRatio || 1)));
    // Rounded down as pdf.js's drawings are sized, so a thumbnail keeps its
    // size whether it is copied from the page or drawn: in CI's Chromium a
    // drawn one came out 1 px shorter than a copied one.
    const height = Math.max(1, Math.floor((width * turned.height) / turned.width + 1e-6));
    const key = `${rotation} ${width}`;
    const { canvas } = thumbnail;
    if (thumbnail.drawn === key && canvas.width === width && canvas.height === height) return;
    if (thumbnail.cancel) return;
    thumbnail.drawn = null;
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

  #takeKept(pageIndex: number): KeptThumbnail | null {
    const kept = this.#kept.get(pageIndex);
    if (!kept) return null;
    this.#kept.delete(pageIndex);
    this.#keptPixels -= kept.pixels;
    return kept;
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

function createThumbnailCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.ownerDocument.createElement("canvas");
  // Empty until drawn: a canvas's default 300 by 150 pixels would hold memory for nothing.
  canvas.width = 0;
  canvas.height = 0;
  canvas.className = "parapdf-thumbnail";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.background = "#fff";
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
