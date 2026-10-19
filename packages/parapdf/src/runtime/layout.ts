import type { PageSize, Rotation } from "../engine/types.ts";

/** Immutable vertical layout of every page at one zoom level, in CSS pixels. */
export interface Layout {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Clockwise view rotation; widths and heights are the turned page boxes. */
  readonly rotation: Rotation;
  /** Space between pages and around the document. */
  readonly gap: number;
  /** Page sizes in PDF points, unturned by the view. */
  readonly sizes: readonly PageSize[];
  readonly tops: Float64Array;
  readonly widths: Float64Array;
  readonly heights: Float64Array;
  readonly totalHeight: number;
  readonly totalWidth: number;
}

export function computeLayout(
  sizes: readonly PageSize[],
  scale: number,
  gap: number,
  rotation: Rotation = 0,
): Layout {
  const count = sizes.length;
  const tops = new Float64Array(count);
  const widths = new Float64Array(count);
  const heights = new Float64Array(count);
  let y = gap;
  let maxWidth = 0;
  for (let index = 0; index < count; index++) {
    const size = turnedSize(sizes[index] ?? { width: 0, height: 0 }, rotation);
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);
    tops[index] = y;
    widths[index] = width;
    heights[index] = height;
    y += height + gap;
    if (width > maxWidth) maxWidth = width;
  }
  return {
    scale,
    rotation,
    gap,
    sizes,
    tops,
    widths,
    heights,
    totalHeight: y,
    totalWidth: maxWidth + 2 * gap,
  };
}

/** Index of the last page whose top is at or above `y` (binary search). */
export function pageAt(layout: Layout, y: number): number {
  const { tops } = layout;
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((tops[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
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
  // A band that starts in the gap below a page begins with the next page.
  if ((layout.tops[first] ?? 0) + (layout.heights[first] ?? 0) <= top && first < count - 1) first++;
  const last = pageAt(layout, top + height);
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
 * page is centered in the viewport, as in pdf.js's viewer, and one wider
 * than the viewport starts at the gap. Centering every page in the widest
 * page's width instead pushed narrower pages off the viewport's right edge.
 * `<PdfViewport>` places pages by the same rule in CSS.
 */
export function pageLeft(layout: Layout, index: number, viewportWidth: number): number {
  return Math.max(layout.gap, (viewportWidth - (layout.widths[index] ?? 0)) / 2);
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
