"use client";

import { useEffect, useState } from "react";
import { getSelection, type PdfSelection } from "../features/selection.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

const sameSelection = (a: PdfSelection | null, b: PdfSelection | null): boolean =>
  a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * The text selected in `viewer`, or in the viewer of the nearest `<PdfView>`
 * or `<PdfDocument>`, and the rectangles it covers on its pages (see
 * `getSelection()`); null when nothing is selected there. It follows the
 * selection at most once a frame while the reader drags.
 */
export function useSelection(viewer?: Viewer): PdfSelection | null {
  const resolved = useOptionalViewer(viewer);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = getSelection(resolved);
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
  }, [resolved]);
  return selection;
}
