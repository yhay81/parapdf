import type { ResolvedDestination } from "../pdfjs/destinations.ts";
import { type Layout, pageAtPoint, pageLeft, pageTop, turnBox } from "./layout.ts";
import type { ViewerState, ZoomMode } from "./state.ts";

// The navigation rules: where the viewer scrolls to show a page, a
// destination, a rectangle, or a position again, and the position it shows
// now. The viewer lays the pages out, then asks them and writes the scroll
// position: they read the scroller once its layout is up to date and before
// that write, so they force no layout the viewer's methods did not. They run
// once per navigation, never in the frame or gesture paths.

/** The scroller's position and size: the element, or what a test passes. */
export interface ScrollBox {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** A scroll position to go to; a null `left` keeps the scroller's. */
export interface ScrollTarget {
  top: number;
  left: number | null;
}

/**
 * Where a viewer shows its document, to come back to: the page at the
 * viewport's top-left corner, where that corner is as a share of the page,
 * the current page, and the zoom.
 */
export interface ViewerPosition {
  pageIndex: number;
  x: number;
  y: number;
  current: number;
  scale: number;
  zoomMode: ZoomMode;
}

/**
 * Show page `index` from its top: its row at the viewport's top, or, in
 * "horizontal" mode, the page at the viewport's left.
 */
export function pageTarget(layout: Layout, index: number, scroller: ScrollBox): ScrollTarget {
  const { gap } = layout;
  const left = pageLeft(layout, index, scroller.clientWidth);
  const top = pageTop(layout, index, scroller.clientHeight);
  if (layout.scrollMode === "horizontal") return { top: top - gap, left: left - gap };
  // The row's top: a page shorter than its row is centered in it.
  const rowTop = top - ((layout.tops[index] ?? 0) - (layout.rowTops[index] ?? 0)) - gap;
  // A page of a spread wider than the viewport may lie beside it.
  const right = left + (layout.widths[index] ?? 0);
  const beside = left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth;
  return { top: rowTop, left: beside ? left - gap : null };
}

/**
 * Show a destination's point at the viewport's top-left corner. An explicit
 * left scrolls sideways only when it is out of view, unless `exact`.
 */
export function destinationTarget(
  layout: Layout,
  target: ResolvedDestination,
  scroller: ScrollBox,
  exact: boolean,
): ScrollTarget {
  const { pageIndex } = target;
  const rect = target.view?.fit === "rect" ? target.view : null;
  // The point is on the unturned page; a quarter turn makes
  // its left coordinate the vertical one.
  const size = layout.sizes[pageIndex] ?? { width: 0, height: 0 };
  const point = turnBox(
    { x: target.x ?? 0, y: target.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 },
    size,
    layout.rotation,
  );
  const quarter = layout.rotation % 180 !== 0;
  const hasTop = (quarter ? target.x : target.y) !== null;
  const hasLeft = (quarter ? target.y : target.x) !== null;
  const pageX = pageLeft(layout, pageIndex, scroller.clientWidth);
  const pageY = pageTop(layout, pageIndex, scroller.clientHeight);
  // An explicit top lands at the top edge of the viewport, as in other PDF
  // readers, and an explicit left, in "horizontal" mode, at its left edge.
  const top = hasTop ? pageY + point.y * layout.scale : pageY - layout.gap;
  const left = hasLeft ? pageX + point.x * layout.scale : pageX - layout.gap;
  const sideways =
    layout.scrollMode === "horizontal" ||
    // A rectangle fills the viewport from its left edge, and a view
    // state shows the same part of the page again.
    ((rect || exact) && hasLeft) ||
    (hasLeft && (left < scroller.scrollLeft || left > scroller.scrollLeft + scroller.clientWidth));
  return { top, left: sideways ? left : null };
}

/**
 * Show `rect` of page `pageIndex`, in PDF points from its unturned top-left
 * corner, in the upper third of the viewport, and, in "horizontal" mode or
 * when it is out of view sideways, in its left third.
 */
export function rectTarget(
  layout: Layout,
  pageIndex: number,
  rect: { x: number; y: number; width: number; height: number },
  scroller: ScrollBox,
): ScrollTarget {
  const size = layout.sizes[pageIndex] ?? { width: 0, height: 0 };
  const box = turnBox(rect, size, layout.rotation);
  const top = pageTop(layout, pageIndex, scroller.clientHeight) + box.y * layout.scale;
  const left = pageLeft(layout, pageIndex, scroller.clientWidth) + box.x * layout.scale;
  const sideways =
    layout.scrollMode === "horizontal" ||
    left < scroller.scrollLeft ||
    left > scroller.scrollLeft + scroller.clientWidth;
  return {
    top: top - scroller.clientHeight / 3,
    left: sideways ? left - scroller.clientWidth / 3 : null,
  };
}

/**
 * Where `layout` shows the document in `scroller` now, as a page and a share
 * of it, which survive zoom changes, and `view`'s current page and zoom.
 */
export function positionAt(
  layout: Layout,
  scroller: ScrollBox,
  view: Pick<ViewerState, "currentPage" | "zoomMode">,
): ViewerPosition {
  const { scrollLeft: x, scrollTop: y, clientWidth, clientHeight } = scroller;
  const pageIndex = pageAtPoint(layout, x, y, clientWidth);
  return {
    pageIndex,
    x: (x - pageLeft(layout, pageIndex, clientWidth)) / (layout.widths[pageIndex] || 1),
    y: (y - pageTop(layout, pageIndex, clientHeight)) / (layout.heights[pageIndex] || 1),
    current: view.currentPage,
    scale: layout.scale,
    zoomMode: view.zoomMode,
  };
}

/** Show a `positionAt()` again in `layout`, laid out at the zoom it had or fits now. */
export function positionTarget(
  layout: Layout,
  position: ViewerPosition,
  scroller: ScrollBox,
): ScrollTarget {
  const { pageIndex } = position;
  return {
    top:
      pageTop(layout, pageIndex, scroller.clientHeight) +
      position.y * (layout.heights[pageIndex] ?? 0),
    left:
      pageLeft(layout, pageIndex, scroller.clientWidth) +
      position.x * (layout.widths[pageIndex] ?? 0),
  };
}
