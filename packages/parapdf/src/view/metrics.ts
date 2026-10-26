import { type Layout, type PageArea, type Viewport, visibleArea, visibleRange } from "./layout.ts";

/** CSS pixels of page `index` that `area`, a share of the page, covers. */
const pixelsOf = (layout: Layout, index: number, area: PageArea): number =>
  (area.maxX - area.minX) *
  (layout.widths[index] ?? 0) *
  (area.maxY - area.minY) *
  (layout.heights[index] ?? 0);

/** Fraction of `viewport` covered by pages that show no pixels yet. */
export function blankFraction(
  layout: Layout,
  viewport: Viewport,
  hasPixels: (index: number) => boolean,
): number {
  if (viewport.height === 0) return 0;
  const { first, last } = visibleRange(layout, viewport);
  let blank = 0;
  for (let index = first; index <= last; index++) {
    const area = visibleArea(layout, index, viewport);
    if (!area || hasPixels(index)) continue;
    blank += pixelsOf(layout, index, area);
  }
  return blank / (viewport.height * viewport.width);
}

/**
 * How sharp the visible pages look: the resolution of their pixels as a
 * share of `needed`, the device resolution, weighted by visible area, which
 * `pageSharpness` gives for a page's visible area. 1 means sharp
 * everywhere, 0 means blank.
 */
export function sharpness(
  layout: Layout,
  viewport: Viewport,
  needed: number,
  pageSharpness: (index: number, area: PageArea, needed: number) => number,
): number {
  if (viewport.height === 0) return 0;
  const { first, last } = visibleRange(layout, viewport);
  let weighted = 0;
  let total = 0;
  for (let index = first; index <= last; index++) {
    const area = visibleArea(layout, index, viewport);
    if (!area) continue;
    const size = pixelsOf(layout, index, area);
    weighted += size * pageSharpness(index, area, needed);
    total += size;
  }
  return total > 0 ? weighted / total : 0;
}
