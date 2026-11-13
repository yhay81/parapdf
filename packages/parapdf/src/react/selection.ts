"use client";

import { useEffect, useState } from "react";
import { getSelection, type PdfSelection } from "../features/selection.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

const samePoint = (a: PdfSelection["start"], b: PdfSelection["start"]): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.pageIndex === b.pageIndex &&
    a.item === b.item &&
    a.offset === b.offset);

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;

export function sameSelection(a: PdfSelection | null, b: PdfSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.text !== b.text || !samePoint(a.start, b.start) || !samePoint(a.end, b.end)) return false;
  if (a.pages.length !== b.pages.length) return false;
  for (let i = 0; i < a.pages.length; i++) {
    const pageA = a.pages[i];
    const pageB = b.pages[i];
    if (!pageA || !pageB || pageA.pageIndex !== pageB.pageIndex) return false;
    if (pageA.rects.length !== pageB.rects.length) return false;
    for (let j = 0; j < pageA.rects.length; j++) {
      const rectA = pageA.rects[j];
      const rectB = pageB.rects[j];
      if (
        !rectA ||
        !rectB ||
        !near(rectA.x, rectB.x) ||
        !near(rectA.y, rectB.y) ||
        !near(rectA.width, rectB.width) ||
        !near(rectA.height, rectB.height)
      ) {
        return false;
      }
    }
  }
  return true;
}

export type PopoverPlacement = "top" | "bottom";

export interface PopoverBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function computePopoverPosition(options: {
  anchorBox: PopoverBox;
  viewportBox: PopoverBox;
  windowWidth: number;
  windowHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  placement: PopoverPlacement;
  offset: number;
}): { x: number; y: number; side: PopoverPlacement } | null {
  const {
    anchorBox,
    viewportBox,
    windowWidth,
    windowHeight,
    popoverWidth,
    popoverHeight,
    placement,
    offset,
  } = options;
  if (
    (anchorBox.width <= 0 && anchorBox.height <= 0) ||
    anchorBox.bottom <= viewportBox.top ||
    anchorBox.top >= viewportBox.bottom ||
    anchorBox.right <= viewportBox.left ||
    anchorBox.left >= viewportBox.right
  ) {
    return null;
  }
  const visibleLeft = Math.max(anchorBox.left, viewportBox.left);
  const visibleRight = Math.min(anchorBox.right, viewportBox.right);
  const centerX = (visibleLeft + visibleRight) / 2;
  const minX = Math.max(4, viewportBox.left + 4);
  const maxX = Math.max(
    minX,
    Math.min(windowWidth - popoverWidth - 4, viewportBox.right - popoverWidth - 4),
  );
  const x = Math.min(maxX, Math.max(minX, centerX - popoverWidth / 2));

  const minY = Math.max(4, viewportBox.top + 4);
  const bottomLimit = Math.min(windowHeight - 4, viewportBox.bottom - 4);
  const maxY = Math.max(minY, bottomLimit - popoverHeight);
  const topCandidate = anchorBox.top - offset - popoverHeight;
  const bottomCandidate = anchorBox.bottom + offset;

  let side: PopoverPlacement = placement;
  if (placement === "top") {
    if (
      topCandidate < minY &&
      viewportBox.bottom - anchorBox.bottom > anchorBox.top - viewportBox.top
    ) {
      side = "bottom";
    }
  } else if (
    bottomCandidate + popoverHeight > bottomLimit &&
    anchorBox.top - viewportBox.top > viewportBox.bottom - anchorBox.bottom
  ) {
    side = "top";
  }
  const y = Math.min(maxY, Math.max(minY, side === "top" ? topCandidate : bottomCandidate));
  return { x: Math.round(x), y: Math.round(y), side };
}

/**
 * The text selected in `viewer`, or in the viewer of the nearest `<PdfView>`
 * or `<PdfDocument>`, the rectangles it covers on its pages, and a virtual
 * `anchor` whose `getBoundingClientRect()` follows scroll, zoom, and rotation;
 * null when nothing is selected there. It follows the selection at most once a
 * frame while the reader drags.
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
