"use client";

import type { PageSize } from "../document/session.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import { turnBox, turnedSize } from "../view/layout.ts";
import type { Viewer } from "../view/viewer.ts";
import type { TextPoint } from "./text/document-text.ts";

/** A rectangle in PDF points from the top-left corner of a page, unturned by the view. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const items = new Map<Node, number>(elements.map((element, item) => [element, item]));
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
  for (const [item, element] of elements.entries()) {
    // pdf.js leaves the runs of empty items out of the layer.
    if (!element.parentNode) continue;
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
function textPointAt(viewer: Viewer, node: Node, offset: number): TextPoint | null {
  const element = node instanceof Element ? node : node.parentElement;
  const layer = element?.closest<HTMLElement>(".parapdf-text-layer");
  const section = layer?.closest<HTMLElement>("section[data-page]");
  if (!layer || !section || !viewer.content?.contains(section)) return null;
  const pageIndex = Number(section.dataset.page) - 1;
  const handle = viewer.textLayers.get(pageIndex);
  return handle ? textPointOf(pageIndex, handle.elements, node, offset) : null;
}

/**
 * The text selected in `viewer`'s pages and the rectangles it covers, in
 * the coordinates `<PdfPageRect>` takes, for example to keep it as a
 * highlight; null when nothing is selected there. Only mounted pages have
 * text to select.
 */
export function getSelection(viewer: Viewer): PdfSelection | null {
  const content = viewer.content;
  const layout = viewer.store.get().layout;
  const selection = document.getSelection();
  if (!content || !layout || !selection || selection.isCollapsed) return null;
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
    for (const layer of content.querySelectorAll<HTMLElement>(".parapdf-text-layer")) {
      if (!range.intersectsNode(layer)) continue;
      const section = layer.closest<HTMLElement>("section[data-page]");
      const pageIndex = Number(section?.dataset.page) - 1;
      const size = layout.sizes[pageIndex];
      if (!section || !size) continue;
      const rects = rectsByPage.get(pageIndex) ?? [];
      rectsByPage.set(pageIndex, rects);
      selectedRects(range, layer, section, size, layout.rotation, rects);
    }
  }
  if (rectsByPage.size === 0) return null;
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  return {
    // The selection's own text keeps its line breaks.
    text: outside ? text : selection.toString(),
    pages: [...rectsByPage]
      .sort(([a], [b]) => a - b)
      .map(([pageIndex, rects]) => ({ pageIndex, rects })),
    start: textPointAt(viewer, first.startContainer, first.startOffset),
    end: textPointAt(viewer, last.endContainer, last.endOffset),
  };
}
