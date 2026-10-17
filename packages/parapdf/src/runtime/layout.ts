import type { PageSize } from "../engine/types.ts";

/** Immutable vertical layout of every page at one zoom level, in CSS pixels. */
export interface Layout {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Space between pages and around the document. */
  readonly gap: number;
  /** Page sizes in PDF points. */
  readonly sizes: readonly PageSize[];
  readonly tops: Float64Array;
  readonly widths: Float64Array;
  readonly heights: Float64Array;
  readonly totalHeight: number;
  readonly totalWidth: number;
}

export function computeLayout(sizes: readonly PageSize[], scale: number, gap: number): Layout {
  const count = sizes.length;
  const tops = new Float64Array(count);
  const widths = new Float64Array(count);
  const heights = new Float64Array(count);
  let y = gap;
  let maxWidth = 0;
  for (let index = 0; index < count; index++) {
    const size = sizes[index] ?? { width: 0, height: 0 };
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
