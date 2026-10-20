import type { PageSize, Rotation } from "../engine/types.ts";

/**
 * How pages pair up side by side, as in pdf.js: "none" shows one page per
 * row, "odd" pairs each odd page with the next (1–2, 3–4), and "even" shows
 * the first page alone and pairs each even page with the next (1, 2–3),
 * like a book with its cover.
 */
export type SpreadMode = "none" | "odd" | "even";

/**
 * Immutable layout of every page at one zoom level, in CSS pixels. Pages
 * stack in rows of one page, or two in a spread; each row is centered in the
 * viewport and each page centered vertically in its row.
 */
export interface Layout {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Clockwise view rotation; widths and heights are the turned page boxes. */
  readonly rotation: Rotation;
  /** Space between pages and around the document. */
  readonly gap: number;
  readonly spread: SpreadMode;
  /** Page sizes in PDF points, unturned by the view. */
  readonly sizes: readonly PageSize[];
  readonly tops: Float64Array;
  readonly widths: Float64Array;
  readonly heights: Float64Array;
  /** Each page's distance from its row's left edge. */
  readonly offsets: Float64Array;
  /** The top, width, and height of each page's row. */
  readonly rowTops: Float64Array;
  readonly rowWidths: Float64Array;
  readonly rowHeights: Float64Array;
  readonly totalHeight: number;
  readonly totalWidth: number;
}

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
  gap: number,
  rotation: Rotation = 0,
  spread: SpreadMode = "none",
): Layout {
  const count = sizes.length;
  const tops = new Float64Array(count);
  const widths = new Float64Array(count);
  const heights = new Float64Array(count);
  const offsets = new Float64Array(count);
  const rowTops = new Float64Array(count);
  const rowWidths = new Float64Array(count);
  const rowHeights = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const size = turnedSize(sizes[index] ?? { width: 0, height: 0 }, rotation);
    widths[index] = Math.round(size.width * scale);
    heights[index] = Math.round(size.height * scale);
  }
  let y = gap;
  let maxWidth = 0;
  for (let first = 0; first < count; ) {
    const end = rowBounds(spread, first, count).last + 1;
    let rowWidth = 0;
    let rowHeight = 0;
    for (let index = first; index < end; index++) {
      offsets[index] = index === first ? 0 : rowWidth + gap;
      rowWidth = (offsets[index] ?? 0) + (widths[index] ?? 0);
      rowHeight = Math.max(rowHeight, heights[index] ?? 0);
    }
    for (let index = first; index < end; index++) {
      tops[index] = y + Math.round((rowHeight - (heights[index] ?? 0)) / 2);
      rowTops[index] = y;
      rowWidths[index] = rowWidth;
      rowHeights[index] = rowHeight;
    }
    y += rowHeight + gap;
    maxWidth = Math.max(maxWidth, rowWidth);
    first = end;
  }
  return {
    scale,
    rotation,
    gap,
    spread,
    sizes,
    tops,
    widths,
    heights,
    offsets,
    rowTops,
    rowWidths,
    rowHeights,
    totalHeight: y,
    totalWidth: maxWidth + 2 * gap,
  };
}

/** The first page of the row that page `index` is in. */
export const rowStart = (layout: Layout, index: number): number =>
  index > 0 && layout.rowTops[index - 1] === layout.rowTops[index] ? index - 1 : index;

/** The last page of the row that page `index` is in. */
export const rowEnd = (layout: Layout, index: number): number =>
  index < layout.rowTops.length - 1 && layout.rowTops[index + 1] === layout.rowTops[index]
    ? index + 1
    : index;

/** The first page of the last row whose top is at or above `y` (binary search). */
export function pageAt(layout: Layout, y: number): number {
  const { rowTops } = layout;
  let low = 0;
  let high = rowTops.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((rowTops[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }
  return rowStart(layout, Math.max(0, low));
}

/** The page at a point of the content, or nearest to it in its row. */
export function pageAtPoint(layout: Layout, x: number, y: number, viewportWidth: number): number {
  const first = pageAt(layout, y);
  const second = rowEnd(layout, first);
  if (second === first) return first;
  // The boundary is the middle of the gap between the two pages.
  return x >= pageLeft(layout, second, viewportWidth) - layout.gap / 2 ? second : first;
}

/** Pages intersecting the vertical band [top, top + height). */
export function visibleRange(
  layout: Layout,
  top: number,
  height: number,
): { first: number; last: number } {
  const count = layout.tops.length;
  if (count === 0) return { first: 0, last: -1 };
  let first = pageAt(layout, top);
  // A band that starts in the gap below a row begins with the next row.
  const end = rowEnd(layout, first);
  if ((layout.rowTops[first] ?? 0) + (layout.rowHeights[first] ?? 0) <= top && end < count - 1) {
    first = end + 1;
  }
  const last = rowEnd(layout, pageAt(layout, top + height));
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
   * The scroller's width, which pages are centered in (see pageLeft). It
   * differs from `width` while a zoom preview scales the content.
   */
  scrollerWidth: number;
}

/**
 * Where a page's left edge sits in the scrolled content, in CSS pixels: each
 * row is centered in the viewport, as in pdf.js's viewer, and one wider
 * than the viewport starts at the gap. Centering every row in the widest
 * row's width instead pushed narrower pages off the viewport's right edge.
 * `<PdfViewport>` places pages by the same rule in CSS.
 */
export function pageLeft(layout: Layout, index: number, viewportWidth: number): number {
  return (
    Math.max(layout.gap, (viewportWidth - (layout.rowWidths[index] ?? 0)) / 2) +
    (layout.offsets[index] ?? 0)
  );
}

/** The part of a page inside the viewport, or null when none of it is. */
export function visibleArea(layout: Layout, index: number, viewport: Viewport): PageArea | null {
  const width = layout.widths[index] ?? 0;
  const height = layout.heights[index] ?? 0;
  if (width === 0 || height === 0) return null;
  const top = layout.tops[index] ?? 0;
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
