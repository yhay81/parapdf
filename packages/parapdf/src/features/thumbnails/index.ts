"use client";

import { createSlotKey } from "../../document/store.ts";
import type { ViewerController } from "../../view/viewer.ts";
import { ThumbnailRenderer } from "./renderer.ts";

/** Each viewer's thumbnails, while any is attached. */
const THUMBNAILS_SLOT = createSlotKey<{
  renderer: ThumbnailRenderer;
  count: number;
  detach(): void;
}>("parapdf.thumbnails");

/**
 * Place and draw page `pageIndex` of `viewer`'s document inside `host` as a
 * thumbnail `width` CSS pixels wide, at a lower priority than the pages in the
 * viewport; returns the function that releases it into the kept-canvas pool.
 */
export function attachThumbnail(
  viewer: ViewerController,
  pageIndex: number,
  host: HTMLElement,
  width: number,
): () => void {
  const held = viewer.slot(THUMBNAILS_SLOT, () => {
    const renderer = new ThumbnailRenderer({
      renderer: () => viewer.renderer,
      pageSize: (index) => viewer.store.get().layout?.sizes[index],
      rotation: () => viewer.store.get().rotation,
      layers: () => viewer.layers,
    });
    const detach = viewer.extend({
      ready(session, signal) {
        renderer.refresh();
        session.onContentChange(() => {
          renderer.reset();
          renderer.refresh();
        }, signal);
        // The document's pixels go with it, and with the viewport.
        signal.addEventListener("abort", () => renderer.reset(), { once: true });
      },
      layersChanged() {
        renderer.reset();
        renderer.refresh();
      },
    });
    return { renderer, count: 0, detach };
  });
  held.count++;
  const release = held.renderer.attach(pageIndex, host, width);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (--held.count > 0) return;
    // Defer teardown past the current React commit so StrictMode ref replay and
    // single-commit window jumps (`0..10` -> `494..506`) keep kept canvases
    // alive while unmounting `<PdfThumbnails>` releases them immediately after.
    queueMicrotask(() => {
      if (held.count > 0) return;
      held.renderer.reset();
      held.detach();
      viewer.clearSlot(THUMBNAILS_SLOT, held);
    });
  };
}
