"use client";

import type { Viewer } from "../../view/viewer.ts";
import { ThumbnailRenderer } from "./renderer.ts";

/** Each viewer's thumbnails, while any is attached. */
const renderers = new WeakMap<
  Viewer,
  { renderer: ThumbnailRenderer; count: number; detach(): void }
>();

/**
 * Draw page `pageIndex` of `viewer`'s document into `canvas` as a thumbnail
 * `width` CSS pixels wide while it is near the visible part of its scroll
 * container, at a lower priority than the pages in the viewport; returns
 * the function that releases it. `<PdfThumbnail>` calls this.
 */
export function attachThumbnail(
  viewer: Viewer,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  width: number,
): () => void {
  let entry = renderers.get(viewer);
  if (!entry) {
    const renderer = new ThumbnailRenderer({
      scheduler: () => viewer.scheduler,
      pageSize: (index) => viewer.store.get().layout?.sizes[index],
      rotation: () => viewer.store.get().rotation,
      layers: () => viewer.layers,
    });
    const detach = viewer.extend({
      ready(_session, signal) {
        renderer.refresh();
        // The document's pixels go with it, and with the viewport.
        signal.addEventListener("abort", () => renderer.reset(), { once: true });
      },
      layersChanged() {
        renderer.reset();
        renderer.refresh();
      },
    });
    entry = { renderer, count: 0, detach };
    renderers.set(viewer, entry);
  }
  const held = entry;
  held.count++;
  const release = held.renderer.attach(pageIndex, canvas, width);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (--held.count > 0) return;
    held.detach();
    if (renderers.get(viewer) === held) renderers.delete(viewer);
  };
}
