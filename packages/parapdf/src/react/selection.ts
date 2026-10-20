"use client";

import { useEffect, useState } from "react";
import type { PdfSelection } from "../runtime/viewer.ts";
import { usePdfViewer } from "./context.ts";

const sameSelection = (a: PdfSelection | null, b: PdfSelection | null): boolean =>
  a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * The text selected in the viewer and the rectangles it covers on its pages
 * (see `getSelection()`), null when nothing is selected there. It follows
 * the selection at most once a frame while the reader drags.
 */
export function usePdfSelection(): PdfSelection | null {
  const viewer = usePdfViewer();
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = viewer.getSelection();
      setSelection((previous) => (sameSelection(previous, next) ? previous : next));
    };
    const onChange = () => {
      frame ||= requestAnimationFrame(read);
    };
    document.addEventListener("selectionchange", onChange);
    read();
    return () => {
      document.removeEventListener("selectionchange", onChange);
      cancelAnimationFrame(frame);
    };
  }, [viewer]);
  return selection;
}
