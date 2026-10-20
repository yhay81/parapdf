import type { LayerState, PageSize, Rotation } from "../engine/types.ts";
import { turnedSize } from "./layout.ts";
import type { RenderScheduler } from "./scheduler.ts";

/** What thumbnails need from the viewer. */
export interface ThumbnailHost {
  /** The open document's scheduler; null until it loads. */
  scheduler(): RenderScheduler | null;
  /** A page's size in PDF points, unturned by the view. */
  pageSize(pageIndex: number): PageSize | undefined;
  rotation(): Rotation;
  /** Which layers show in the viewer. */
  layers(): LayerState | null;
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

/**
 * Thumbnails share the viewer's render slots but only take what the pages in
 * view leave (`RenderScheduler.enqueue`), and copy a page's drawing instead
 * of rendering when the viewer already has one large enough. Only those near
 * the visible part of their scroller hold pixels: a long list of them would
 * otherwise hold canvas memory for every page, past what iOS allows.
 */
export class ThumbnailRenderer {
  readonly #host: ThumbnailHost;
  readonly #byCanvas = new Map<Element, Thumbnail>();
  /** One observer per scroll container, which a margin of its height extends, and its thumbnails. */
  readonly #observers = new Map<
    Element | null,
    { observer: IntersectionObserver; count: number }
  >();

  constructor(host: ThumbnailHost) {
    this.#host = host;
  }

  /** Draw page `pageIndex` into `canvas`, `width` CSS pixels wide, while near view. */
  attach(pageIndex: number, canvas: HTMLCanvasElement, width: number): () => void {
    const thumbnail: Thumbnail = {
      pageIndex,
      canvas,
      width,
      near: false,
      drawn: null,
      cancel: null,
    };
    this.#byCanvas.set(canvas, thumbnail);
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

  /** Drop every thumbnail's pixels, for example when the document closes. */
  reset(): void {
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
    const scheduler = this.#host.scheduler();
    const size = this.#host.pageSize(thumbnail.pageIndex);
    if (!thumbnail.near || !scheduler || !size || size.width === 0 || size.height === 0) return;
    const rotation = this.#host.rotation();
    const turned = turnedSize(size, rotation);
    const width = Math.max(1, Math.round(thumbnail.width * (window.devicePixelRatio || 1)));
    const key = `${rotation} ${width}`;
    if (thumbnail.drawn === key || thumbnail.cancel) return;
    const { canvas } = thumbnail;
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((width * turned.height) / turned.width));
    if (scheduler.copyPage(thumbnail.pageIndex, canvas, rotation)) {
      thumbnail.drawn = key;
      return;
    }
    const layers = this.#host.layers();
    thumbnail.cancel = scheduler.enqueue(
      {
        pageIndex: thumbnail.pageIndex,
        scale: width / turned.width,
        rotation,
        canvas,
        ...(layers ? { layers } : {}),
      },
      (error) => {
        thumbnail.cancel = null;
        // A failed page stays blank; the scheduler has logged the failure.
        if (error === null) thumbnail.drawn = key;
      },
    );
  }

  #clear(thumbnail: Thumbnail): void {
    thumbnail.cancel?.();
    thumbnail.cancel = null;
    thumbnail.drawn = null;
    thumbnail.canvas.width = 0;
    thumbnail.canvas.height = 0;
  }
}

/** The nearest ancestor that scrolls vertically; null for the document. */
function scrollParent(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}
