"use client";

import type { PageSize } from "../document/session.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import { pageLeft, pageTop, turnBox, turnedSize } from "../view/layout.ts";
import type { ViewerController } from "../view/viewer.ts";
import type { TextPoint } from "./text/document-text.ts";

/** A rectangle in PDF points from the top-left corner of a page, unturned by the view. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Virtual reference element compatible with Floating UI, Radix Popover, and
 * Base UI, returning the live client `DOMRect` of a `PdfSelection` across
 * scroll, zoom, and rotation without per-frame React state updates.
 */
export interface SelectionAnchor {
  getBoundingClientRect(): DOMRect;
}

/** The text selected in a viewer and where it lies on its pages. */
export interface PdfSelection {
  /** The selected text, as the browser copies it. */
  text: string;
  /** The rectangles the selected text covers, page by page, in page order. */
  pages: readonly { pageIndex: number; rects: readonly PdfRect[] }[];
  /**
   * Where the selection starts and ends in the document's text, for
   * `getText()`: null for an end outside the pages' text layers.
   */
  start: TextPoint | null;
  end: TextPoint | null;
  /**
   * Virtual anchor whose `getBoundingClientRect()` returns the selection's
   * live union box in client coordinates, following scroll, zoom, and rotation.
   */
  anchor: SelectionAnchor;
}

const toDomRect = (x: number, y: number, width: number, height: number): DOMRect =>
  typeof DOMRect === "function"
    ? new DOMRect(x, y, width, height)
    : ({
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON() {
          return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
        },
      } as DOMRect);

export function createSelectionAnchor(
  viewer: ViewerController,
  pages: readonly { pageIndex: number; rects: readonly PdfRect[] }[],
): SelectionAnchor {
  return {
    getBoundingClientRect(): DOMRect {
      const layout = viewer.store.get().layout;
      const scroller = viewer.scroller;
      if (!layout || !scroller || !viewer.content || pages.length === 0) {
        return toDomRect(0, 0, 0, 0);
      }
      const { shown, rotation } = layout;
      let scrollerBox: DOMRect | null = null;
      let minLeft = Number.POSITIVE_INFINITY;
      let minTop = Number.POSITIVE_INFINITY;
      let maxRight = Number.NEGATIVE_INFINITY;
      let maxBottom = Number.NEGATIVE_INFINITY;

      for (const { pageIndex, rects } of pages) {
        if (rects.length === 0) continue;
        if (shown !== null && (pageIndex < shown.first || pageIndex > shown.last)) continue;
        const size = layout.sizes[pageIndex];
        if (!size || size.width <= 0 || size.height <= 0) continue;
        const turned = turnedSize(size, rotation);
        if (turned.width <= 0 || turned.height <= 0) continue;

        let boxLeft = 0;
        let boxTop = 0;
        let boxWidth = 0;
        let boxHeight = 0;
        const section = viewer.pageHost(pageIndex);
        if (section && section.style.visibility !== "hidden") {
          const box = section.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            boxLeft = box.left;
            boxTop = box.top;
            boxWidth = box.width;
            boxHeight = box.height;
          }
        }
        if (boxWidth <= 0 || boxHeight <= 0) {
          scrollerBox ??= scroller.getBoundingClientRect();
          const scrollerWidth = scroller.clientWidth || scrollerBox.width;
          const scrollerHeight = scroller.clientHeight || scrollerBox.height;
          boxLeft =
            scrollerBox.left +
            scroller.clientLeft -
            scroller.scrollLeft +
            pageLeft(layout, pageIndex, scrollerWidth);
          boxTop =
            scrollerBox.top +
            scroller.clientTop -
            scroller.scrollTop +
            pageTop(layout, pageIndex, scrollerHeight);
          boxWidth = layout.widths[pageIndex] ?? 0;
          boxHeight = layout.heights[pageIndex] ?? 0;
        }
        if (boxWidth <= 0 || boxHeight <= 0) continue;

        for (const rect of rects) {
          const turnedRect = turnBox(rect, size, rotation);
          const left = boxLeft + (turnedRect.x / turned.width) * boxWidth;
          const top = boxTop + (turnedRect.y / turned.height) * boxHeight;
          const width = (turnedRect.width / turned.width) * boxWidth;
          const height = (turnedRect.height / turned.height) * boxHeight;
          if (left < minLeft) minLeft = left;
          if (top < minTop) minTop = top;
          if (left + width > maxRight) maxRight = left + width;
          if (top + height > maxBottom) maxBottom = top + height;
        }
      }

      if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
        return toDomRect(0, 0, 0, 0);
      }
      return toDomRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
    },
  };
}

/**
 * Add the rectangles of the text `range` selects in a text `layer` to
 * `rects`, in PDF points of its unturned page of `size`: each text node's
 * selected part, measured on screen against the page's box, then turned
 * back by the view's rotation.
 */
function selectedRects(
  range: Range,
  layer: HTMLElement,
  section: HTMLElement,
  size: PageSize,
  rotation: Rotation,
  rects: PdfRect[],
): void {
  const box = section.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const turned = turnedSize(size, rotation);
  const back = ((360 - rotation) % 360) as Rotation;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || !(node instanceof Text)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    if (part.collapsed) continue;
    for (const rect of part.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      rects.push(
        turnBox(
          {
            x: ((rect.left - box.left) / box.width) * turned.width,
            y: ((rect.top - box.top) / box.height) * turned.height,
            width: (rect.width / box.width) * turned.width,
            height: (rect.height / box.height) * turned.height,
          },
          turned,
          back,
        ),
      );
    }
  }
}

const itemIndexes = new WeakMap<readonly HTMLElement[], ReadonlyMap<Node, number>>();

function itemsOf(elements: readonly HTMLElement[]): ReadonlyMap<Node, number> {
  let map = itemIndexes.get(elements);
  if (!map) {
    const built = new Map<Node, number>();
    for (let item = 0; item < elements.length; item++) {
      const element = elements[item];
      if (element) built.set(element, item);
    }
    map = built;
    itemIndexes.set(elements, map);
  }
  return map;
}

/**
 * The place in the document's text of a range boundary (`node`, `offset`)
 * in a text layer whose runs are `elements`, one per item of the page's text;
 * null outside the runs. A boundary between runs is the start of the next
 * one, or the end of the last.
 */
function textPointOf(
  pageIndex: number,
  elements: readonly HTMLElement[],
  node: Node,
  offset: number,
): TextPoint | null {
  const items = itemsOf(elements);
  for (let at: Node | null = node; at; at = at.parentNode) {
    const item = items.get(at);
    if (item === undefined) continue;
    // Inside a run: count the text before the boundary.
    const range = document.createRange();
    range.selectNodeContents(at);
    range.setEnd(node, offset);
    return { pageIndex, item, offset: range.toString().length };
  }
  // Between runs, in the layer or a marked-content span that holds them.
  const point = document.createRange();
  point.setStart(node, offset);
  for (let item = 0; item < elements.length; item++) {
    const element = elements[item];
    // pdf.js leaves the runs of empty items out of the layer.
    if (!element?.parentNode) continue;
    const run = document.createRange();
    run.selectNode(element);
    if (point.compareBoundaryPoints(Range.START_TO_START, run) <= 0) {
      return { pageIndex, item, offset: 0 };
    }
  }
  const last = elements.length - 1;
  if (last < 0) return null;
  return { pageIndex, item: last, offset: elements[last]?.textContent?.length ?? 0 };
}

/** Where a range boundary in a mounted page's text layer of `viewer` lies in the document's text. */
function textPointAt(viewer: ViewerController, node: Node, offset: number): TextPoint | null {
  for (const [pageIndex, handle] of viewer.textLayers) {
    if (handle.layer.contains(node)) {
      return textPointOf(pageIndex, handle.elements, node, offset);
    }
  }
  return null;
}

/**
 * The text selected in `viewer`'s pages, the rectangles it covers in
 * `<PdfPageRect>`'s coordinates, and a live `anchor` for positioning floating
 * popovers; null when nothing is selected there. Only mounted pages have text
 * to select.
 */
export function getSelection(viewer: ViewerController): PdfSelection | null {
  const content = viewer.content;
  const layout = viewer.store.get().layout;
  const selection = document.getSelection();
  if (!content || !layout || !selection || selection.isCollapsed || viewer.textLayers.size === 0) {
    return null;
  }
  const rectsByPage = new Map<number, PdfRect[]>();
  let text = "";
  let outside = false;
  for (let at = 0; at < selection.rangeCount; at++) {
    const range = selection.getRangeAt(at);
    if (!range.intersectsNode(content)) {
      outside = true;
      continue;
    }
    if (!content.contains(range.commonAncestorContainer)) outside = true;
    text += range.toString();
    for (const [pageIndex, handle] of viewer.textLayers) {
      const { layer } = handle;
      if (!range.intersectsNode(layer)) continue;
      const section = viewer.pageHost?.(pageIndex) ?? layer.parentElement;
      const size = layout.sizes[pageIndex];
      if (!section || !size) continue;
      let rects = rectsByPage.get(pageIndex);
      if (!rects) {
        rects = [];
        rectsByPage.set(pageIndex, rects);
      }
      selectedRects(range, layer, section, size, layout.rotation, rects);
    }
  }
  if (rectsByPage.size === 0) return null;
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  const pages = [...rectsByPage]
    .sort(([a], [b]) => a - b)
    .map(([pageIndex, rects]) => ({ pageIndex, rects }));
  return {
    // The selection's own text keeps its line breaks.
    text: outside ? text : selection.toString(),
    pages,
    start: textPointAt(viewer, first.startContainer, first.startOffset),
    end: textPointAt(viewer, last.endContainer, last.endOffset),
    anchor: createSelectionAnchor(viewer, pages),
  };
}
