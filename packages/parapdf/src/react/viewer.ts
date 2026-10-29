"use client";

import { useEffect, useState } from "react";
import { closeViewer, Viewer } from "../view/viewer.ts";
import { detachFeatures } from "./features.ts";

/** Components holding each viewer, and the release waiting to run once none does. */
const holders = new WeakMap<Viewer, { count: number; timer: ReturnType<typeof setTimeout> }>();

/**
 * Hold `viewer` for a mounted component; returns the release. Once no
 * component holds it, after StrictMode's unmount and mount have had their
 * turn, its features detach and its document closes.
 */
function holdViewer(viewer: Viewer): () => void {
  let holder = holders.get(viewer);
  if (!holder) {
    holder = { count: 0, timer: setTimeout(() => {}, 0) };
    holders.set(viewer, holder);
  }
  const held = holder;
  held.count++;
  clearTimeout(held.timer);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--held.count > 0) return;
    held.timer = setTimeout(() => {
      if (held.count > 0) return;
      detachFeatures(viewer);
      closeViewer(viewer);
    }, 0);
  };
}

/**
 * A viewer, one viewport's controller and state, for the life of the
 * calling component: give it to a `<PdfViewer>` to show that viewer's
 * document, and to the hooks and functions that act through it. It keeps
 * its view and edits while its `<PdfViewer>` unmounts, and closes the
 * document once the component that created it unmounts.
 */
export function useViewer(): Viewer {
  const [viewer] = useState(() => new Viewer());
  useEffect(() => holdViewer(viewer), [viewer]);
  return viewer;
}
