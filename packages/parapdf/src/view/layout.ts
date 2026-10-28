import type { PageSize } from "../document/session.ts";
import type { Rotation } from "../pdfjs/draw.ts";

/**
 * How pages pair up side by side, as in pdf.js: "none" shows one page per
 * row, "odd" pairs each odd page with the next (1–2, 3–4), and "even" shows
 * the first page alone and pairs each even page with the next (1, 2–3),
 * like a book with its cover.
 */
export type SpreadMode = "none" | "odd" | "even";

/**
 * How pages are arranged and scrolled, as in pdf.js: "vertical" stacks rows
 * of one page, or two in a spread, top to bottom; "horizontal" puts every
 * page in one row and scrolls sideways; "wrapped" fills rows with as many
 * pages, or spreads, as fit the viewport's width; "page" shows one row at a
 * time, which keys and `goToPage()` flip.
 */
export type ScrollMode = "vertical" | "horizontal" | "wrapped" | "page";

/**
 * The order of pages in a row: left to right, or right to left, as a
 * document whose /ViewerPreferences /Direction is R2L asks.
 */
export type Direction = "ltr" | "rtl";

/**
 * Immutable layout of every page at one zoom level, in CSS pixels. Pages sit
 * in rows, each page centered vertically in its row and each row centered in
 * the viewport's width (see pageLeft). Rows stack top to bottom; in
 * "horizontal" and "page" mode, which have one row in view, the row is also
 * centered in the viewport's height (see pageTop).
 */
export interface Layout {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Clockwise view rotation; widths and heights are the turned page boxes. */
  readonly rotation: Rotation;
  /** Space between pages and around the document. */
  readonly gap: number;
  readonly spread: SpreadMode;
  readonly scrollMode: ScrollMode;
  readonly direction: Direction;
  /** Page sizes in PDF points, unturned by the view. */
  readonly sizes: readonly PageSize[];
  /** Each page's top, before a row is centered in the viewport's height (see pageTop). */
  readonly tops: Float64Array;
  readonly widths: Float64Array;
  readonly heights: Float64Array;
  /**
   * Each page's distance from its row's left edge: in "rtl", the row's
   * first page is at its right end.
   */
  readonly offsets: Float64Array;
  /** The top, width, and height of each page's row. */
  readonly rowTops: Float64Array;
  readonly rowWidths: Float64Array;
  readonly rowHeights: Float64Array;
  /** The first and last page of each page's row. */
  readonly rowFirst: Int32Array;
  readonly rowLast: Int32Array;
  /**
   * In "page" mode, the first and last page of the row shown; every row sits
   * in the same place, and the others are hidden. Null in the other modes.
   */
  readonly shown: { readonly first: number; readonly last: number } | null;
  /** The size of the content: in "page" mode, of the row shown. */
  readonly totalHeight: number;
  readonly totalWidth: number;
}

export interface LayoutOptions {
  /** Space between pages and around the document, in CSS pixels. */
  gap: number;
  rotation?: Rotation;
  spread?: SpreadMode;
  scrollMode?: ScrollMode;
  direction?: Direction;
  /** The width "wrapped" rows fill: the scroller's. */
  viewportWidth?: number;
  /** In "page" mode, a page of the row shown (default 0). */
  page?: number;
}

/** `value` within `min` and `max`. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The first and last page of the row that page `index` of `count` is in. */
export function rowBounds(
  spread: SpreadMode,
  index: number,
  count: number,
): { first: number; last: number } {
  if (spread === "none" || (spread === "even" && index === 0)) return { first: index, last: index };
  // "odd" pairs 0–1, 2–3; "even" pairs 1–2, 3–4.
  const first = index - ((index - (spread === "even" ? 1 : 0)) % 2);
  return { first, last: Math.min(count - 1, first + 1) };
}

export function computeLayout(
  sizes: readonly PageSize[],
  scale: number,
  options: LayoutOptions,
): Layout {
  const {
    gap,
    rotation = 0,
    spread = "none",
    scrollMode = "vertical",
    direction = "ltr",
    viewportWidth = 0,
    page = 0,
  } = options;
  const count = sizes.length;
  const tops = new Float64Array(count);
  const widths = new Float64Array(count);
  const heights = new Float64Array(count);
  const offsets = new Float64Array(count);
  const rowTops = new Float64Array(count);
  const rowWidths = new Float64Array(count);
  const rowHeights = new Float64Array(count);
  const rowFirst = new Int32Array(count);
  const rowLast = new Int32Array(count);
  for (let index = 0; index < count; index++) {
    const size = turnedSize(sizes[index] ?? { width: 0, height: 0 }, rotation);
    widths[index] = Math.round(size.width * scale);
    heights[index] = Math.round(size.height * scale);
  }
  /** The width of pages `first` to `end` (exclusive) side by side. */
  const span = (first: number, end: number) => {
    let width = (end - first - 1) * gap;
    for (let index = first; index < end; index++) width += widths[index] ?? 0;
    return width;
  };
  // Rows of whole spreads: one each, all of them, or as many as fit.
  const endOfRow = (first: number): number => {
    if (scrollMode === "horizontal") return count;
    let end = rowBounds(spread, first, count).last + 1;
    if (scrollMode !== "wrapped") return end;
    let width = span(first, end);
    while (end < count) {
      const next = rowBounds(spread, end, count).last + 1;
      const wider = width + gap + span(end, next);
      if (wider + 2 * gap > viewportWidth) break;
      width = wider;
      end = next;
    }
    return end;
  };
  // "horizontal" has one row and "page" shows one: their rows all start at the gap.
  const stacked = scrollMode === "vertical" || scrollMode === "wrapped";
  let y = gap;
  let maxWidth = 0;
  let maxHeight = 0;
  for (let first = 0; first < count; ) {
    const end = endOfRow(first);
    let rowWidth = 0;
    let rowHeight = 0;
    for (let index = first; index < end; index++) {
      offsets[index] = index === first ? 0 : rowWidth + gap;
      rowWidth = (offsets[index] ?? 0) + (widths[index] ?? 0);
      rowHeight = Math.max(rowHeight, heights[index] ?? 0);
    }
    if (direction === "rtl") {
      for (let index = first; index < end; index++) {
        offsets[index] = rowWidth - (offsets[index] ?? 0) - (widths[index] ?? 0);
      }
    }
    const top = stacked ? y : gap;
    for (let index = first; index < end; index++) {
      tops[index] = top + Math.round((rowHeight - (heights[index] ?? 0)) / 2);
      rowTops[index] = top;
      rowWidths[index] = rowWidth;
      rowHeights[index] = rowHeight;
      rowFirst[index] = first;
      rowLast[index] = end - 1;
    }
    y += rowHeight + gap;
    maxWidth = Math.max(maxWidth, rowWidth);
    maxHeight = Math.max(maxHeight, rowHeight);
    first = end;
  }
  const layout: Layout = {
    scale,
    rotation,
    gap,
    spread,
    scrollMode,
    direction,
    sizes,
    tops,
    widths,
    heights,
    offsets,
    rowTops,
    rowWidths,
    rowHeights,
    rowFirst,
    rowLast,
    shown: null,
    totalHeight: stacked ? y : maxHeight + 2 * gap,
    totalWidth: maxWidth + 2 * gap,
  };
  return scrollMode === "page" && count > 0 ? withShownRow(layout, page) : layout;
}

function withShownRow(layout: Layout, page: number): Layout {
  const index = Math.min(Math.max(0, page), layout.tops.length - 1);
  return {
    ...layout,
    shown: { first: layout.rowFirst[index] ?? 0, last: layout.rowLast[index] ?? 0 },
    totalHeight: (layout.rowHeights[index] ?? 0) + 2 * layout.gap,
    totalWidth: (layout.rowWidths[index] ?? 0) + 2 * layout.gap,
  };
}

/**
 * In "page" mode, the layout that shows the row of page `index`, sharing
 * this one's arrays; the same layout when it shows that row already, or in
 * the other modes.
 */
export function showPage(layout: Layout, index: number): Layout {
  const { shown } = layout;
  if (!shown || (index >= shown.first && index <= shown.last)) return layout;
  return withShownRow(layout, index);
}

/** Whether two layouts break their pages into the same rows. */
export function sameRows(a: Layout, b: Layout): boolean {
  if (a.rowFirst.length !== b.rowFirst.length) return false;
  for (let index = 0; index < a.rowFirst.length; index++) {
    if (a.rowFirst[index] !== b.rowFirst[index]) return false;
  }
  return true;
}

/** The first page of the row that page `index` is in. */
export const rowStart = (layout: Layout, index: number): number => layout.rowFirst[index] ?? index;

/** The last page of the row that page `index` is in. */
export const rowEnd = (layout: Layout, index: number): number => layout.rowLast[index] ?? index;

/**
 * The row at the content's height `y`: in the modes that stack rows, the last
 * whose top is at or above it (binary search); the one row of "horizontal"
 * mode; the row "page" mode shows.
 */
function rowAt(layout: Layout, y: number): { first: number; last: number } {
  const { rowTops } = layout;
  if (layout.shown) return layout.shown;
  if (rowTops.length === 0) return { first: 0, last: -1 };
  let low = 0;
  let high = rowTops.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((rowTops[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }
  return { first: rowStart(layout, low), last: rowEnd(layout, low) };
}

/**
 * The page from `first` to `last`, pages of one row, whose left edge is the
 * nearest at or left of `x` (binary search); the leftmost when none is.
 */
function pageAtX(
  layout: Layout,
  first: number,
  last: number,
  x: number,
  viewportWidth: number,
): number {
  let low = first;
  let high = last;
  if (layout.direction === "rtl") {
    // Left edges fall as the pages go on: the first page at or left of `x`.
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pageLeft(layout, mid, viewportWidth) <= x) high = mid;
      else low = mid + 1;
    }
    return low;
  }
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (pageLeft(layout, mid, viewportWidth) <= x) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The page at a point of the content, or nearest to it in its row. */
export function pageAtPoint(layout: Layout, x: number, y: number, viewportWidth: number): number {
  const { first, last } = rowAt(layout, y);
  if (last < first) return 0;
  // The boundary between two pages is the middle of the gap between them.
  return pageAtX(layout, first, last, x + layout.gap / 2, viewportWidth);
}

/** Pages intersecting the viewport, as a range of whole rows in the modes that stack rows. */
export function visibleRange(layout: Layout, viewport: Viewport): { first: number; last: number } {
  const count = layout.tops.length;
  if (count === 0) return { first: 0, last: -1 };
  if (layout.shown) return { first: layout.shown.first, last: layout.shown.last };
  if (layout.scrollMode === "horizontal") {
    const { left, width, scrollerWidth } = viewport;
    let leftmost = pageAtX(layout, 0, count - 1, left, scrollerWidth);
    // A viewport that starts in the gap right of a page begins with the page beyond it.
    if (pageLeft(layout, leftmost, scrollerWidth) + (layout.widths[leftmost] ?? 0) <= left) {
      const step = layout.direction === "rtl" ? -1 : 1;
      leftmost = Math.min(count - 1, Math.max(0, leftmost + step));
    }
    const rightmost = pageAtX(layout, 0, count - 1, left + width, scrollerWidth);
    return layout.direction === "rtl"
      ? { first: Math.min(leftmost, rightmost), last: leftmost }
      : { first: leftmost, last: Math.max(leftmost, rightmost) };
  }
  const { top, height } = viewport;
  let { first, last: end } = rowAt(layout, top);
  // A band that starts in the gap below a row begins with the next row.
  if ((layout.rowTops[first] ?? 0) + (layout.rowHeights[first] ?? 0) <= top && end < count - 1) {
    first = end + 1;
  }
  const last = rowAt(layout, top + height).last;
  return { first, last: Math.max(first, last) };
}

/** A rectangle within a page, as fractions of the page's width and height. */
export interface PageArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The part of the scrolled content the viewport shows, in the content's CSS pixels. */
export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * The scroller's size, which rows are centered in (see pageLeft and
   * pageTop). It differs from `width` and `height` while a zoom preview
   * scales the content.
   */
  scrollerWidth: number;
  scrollerHeight: number;
}

/**
 * Where a page's left edge sits in the scrolled content, in CSS pixels: each
 * row is centered in the viewport, as in pdf.js's viewer, and one wider
 * than the viewport starts at the gap. Centering every row in the widest
 * row's width instead pushed narrower pages off the viewport's right edge.
 * `<PdfViewer>` places pages by the same rule in CSS.
 */
export function pageLeft(layout: Layout, index: number, viewportWidth: number): number {
  return (
    Math.max(layout.gap, (viewportWidth - (layout.rowWidths[index] ?? 0)) / 2) +
    (layout.offsets[index] ?? 0)
  );
}

/**
 * Where a page's top edge sits in the scrolled content, in CSS pixels. In
 * "horizontal" and "page" mode, the row is centered in the viewport's height,
 * and one taller than the viewport starts at the gap, as pageLeft centers
 * rows in its width. `<PdfViewer>` places pages by the same rule in CSS.
 */
export function pageTop(layout: Layout, index: number, viewportHeight: number): number {
  const top = layout.tops[index] ?? 0;
  if (layout.scrollMode === "vertical" || layout.scrollMode === "wrapped") return top;
  return top + Math.max(0, (viewportHeight - (layout.rowHeights[index] ?? 0)) / 2 - layout.gap);
}

/** The scroller's size, which rows are centered in. */
export interface ScrollerSize {
  width: number;
  height: number;
}

/**
 * The scroll position at which the content point `point` of `layout` shows
 * at `anchor` (viewport coordinates) in `next`, as a share of the same page
 * along both axes: rows are centered in the viewport and may wrap
 * differently, so a share of the content's size moved points sideways. The
 * browser clamps it to the scrollable range.
 */
export function zoomTarget(
  layout: Layout,
  next: Layout,
  scroller: ScrollerSize,
  anchor: { x: number; y: number },
  point: { x: number; y: number },
): { left: number; top: number } {
  const { width, height } = scroller;
  const page = pageAtPoint(layout, point.x, point.y, width);
  const withinX = (point.x - pageLeft(layout, page, width)) / (layout.widths[page] || 1);
  const withinY = (point.y - pageTop(layout, page, height)) / (layout.heights[page] || 1);
  return {
    left: pageLeft(next, page, width) + withinX * (next.widths[page] ?? 0) - anchor.x,
    top: pageTop(next, page, height) + withinY * (next.heights[page] ?? 0) - anchor.y,
  };
}

/** The part of a page inside the viewport, or null when none of it is. */
export function visibleArea(layout: Layout, index: number, viewport: Viewport): PageArea | null {
  const width = layout.widths[index] ?? 0;
  const height = layout.heights[index] ?? 0;
  if (width === 0 || height === 0) return null;
  // "page" mode hides the rows it does not show where it shows its row.
  const { shown } = layout;
  if (shown && (index < shown.first || index > shown.last)) return null;
  const top = pageTop(layout, index, viewport.scrollerHeight);
  const left = pageLeft(layout, index, viewport.scrollerWidth);
  const minX = Math.max(0, viewport.left - left) / width;
  const maxX = Math.min(width, viewport.left + viewport.width - left) / width;
  const minY = Math.max(0, viewport.top - top) / height;
  const maxY = Math.min(height, viewport.top + viewport.height - top) / height;
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

export const areaSize = (area: PageArea): number =>
  Math.max(0, area.maxX - area.minX) * Math.max(0, area.maxY - area.minY);

export const intersectAreas = (a: PageArea, b: PageArea): PageArea => ({
  minX: Math.max(a.minX, b.minX),
  minY: Math.max(a.minY, b.minY),
  maxX: Math.min(a.maxX, b.maxX),
  maxY: Math.min(a.maxY, b.maxY),
});

/** The rotation `degrees` stands for: the nearest quarter turn, from 0 to 270. */
export const toRotation = (degrees: number): Rotation =>
  ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rotation;

/** A page's size as the view shows it: a quarter turn swaps width and height. */
export const turnedSize = (size: PageSize, rotation: Rotation): PageSize =>
  rotation % 180 === 0 ? size : { width: size.height, height: size.width };

/**
 * Where a box given in PDF points from the top-left corner of an unturned
 * page of `size` lands once the view turns it clockwise by `rotation`.
 */
export function turnBox(
  box: { x: number; y: number; width: number; height: number },
  size: PageSize,
  rotation: Rotation,
): { x: number; y: number; width: number; height: number } {
  const { x, y, width, height } = box;
  switch (rotation) {
    case 90:
      return { x: size.height - y - height, y: x, width: height, height: width };
    case 180:
      return { x: size.width - x - width, y: size.height - y - height, width, height };
    case 270:
      return { x: y, y: size.width - x - width, width: height, height: width };
    default:
      return box;
  }
}
