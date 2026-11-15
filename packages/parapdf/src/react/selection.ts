"use client";

import { useEffect, useRef, useState } from "react";
import { getSelection, type PdfSelection } from "../features/selection.ts";
import { type Viewer, ViewerController } from "../view/viewer.ts";
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

interface SelectionRangeSnapshot {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
  readonly layout: object;
}

function useViewerSelection(resolved: ViewerController, settleDrag: boolean): PdfSelection | null {
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const currentRef = useRef<PdfSelection | null>(selection);
  currentRef.current = selection;

  useEffect(() => {
    let frame = 0;
    let lastRange: SelectionRangeSnapshot | null = null;

    const commit = (next: PdfSelection | null) => {
      if (sameSelection(currentRef.current, next)) return;
      currentRef.current = next;
      setSelection(next);
    };

    const clear = () => {
      lastRange = null;
      commit(null);
    };

    const read = () => {
      frame = 0;
      if (settleDrag && resolved.selectionDragging) {
        clear();
        return;
      }
      const domSelection = document.getSelection();
      const layout = resolved.store.get().layout;
      if (
        !domSelection ||
        domSelection.isCollapsed ||
        !layout ||
        !resolved.content ||
        resolved.textLayers.size === 0
      ) {
        clear();
        return;
      }
      if (domSelection.rangeCount === 1) {
        const range = domSelection.getRangeAt(0);
        if (
          lastRange !== null &&
          lastRange.layout === layout &&
          lastRange.startContainer === range.startContainer &&
          lastRange.startOffset === range.startOffset &&
          lastRange.endContainer === range.endContainer &&
          lastRange.endOffset === range.endOffset
        ) {
          return;
        }
        lastRange = {
          startContainer: range.startContainer,
          startOffset: range.startOffset,
          endContainer: range.endContainer,
          endOffset: range.endOffset,
          layout,
        };
      } else {
        lastRange = null;
      }
      const next = getSelection(resolved);
      if (!next) lastRange = null;
      commit(next);
    };

    const onChange = () => {
      if (settleDrag && resolved.selectionDragging) return;
      frame ||= requestAnimationFrame(read);
    };

    const unsubscribeDrag = settleDrag
      ? resolved.onSelectionDragChange(() => {
          if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
          }
          if (resolved.selectionDragging) clear();
          else read();
        })
      : null;

    document.addEventListener("selectionchange", onChange);
    read();
    return () => {
      document.removeEventListener("selectionchange", onChange);
      unsubscribeDrag?.();
      cancelAnimationFrame(frame);
    };
  }, [resolved, settleDrag]);
  return selection;
}

export interface SelectionOptions {
  /**
   * When true, suppresses DOM range measurements and React state commits while
   * the reader drags a primary-button text selection and commits once on
   * pointer release (default `false`, which follows drags at most once a frame).
   * Keyboard and programmatic selections still update immediately.
   */
  settleDrag?: boolean;
}

function isSelectionOptions(
  value: Viewer | SelectionOptions | undefined,
): value is SelectionOptions {
  if (typeof value !== "object" || value === null || ViewerController.is(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const key of Object.keys(value)) {
    if (key !== "settleDrag") return false;
  }
  return true;
}

/**
 * The text selected in `viewer`, or in the viewer of the nearest `<PdfView>`
 * or `<PdfDocument>`, the rectangles it covers on its pages, and a virtual
 * `anchor` whose `getBoundingClientRect()` follows scroll, zoom, and rotation;
 * null when nothing is selected there. By default it follows drags at most once
 * a frame; pass `{ settleDrag: true }` to wait for pointer release.
 */
export function useSelection(viewer?: Viewer, options?: SelectionOptions): PdfSelection | null;
export function useSelection(options: SelectionOptions): PdfSelection | null;
export function useSelection(
  viewerOrOptions?: Viewer | SelectionOptions,
  maybeOptions?: SelectionOptions,
): PdfSelection | null {
  const optionsFirst = maybeOptions === undefined && isSelectionOptions(viewerOrOptions);
  const viewer = optionsFirst ? undefined : (viewerOrOptions as Viewer | undefined);
  const options = optionsFirst ? viewerOrOptions : maybeOptions;
  return useViewerSelection(useOptionalViewer(viewer), Boolean(options?.settleDrag));
}
