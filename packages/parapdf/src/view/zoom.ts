import type { PageSize } from "../document/session.ts";
import type { ResolvedDestination } from "../pdfjs/destinations.ts";
import { clamp, rowBounds, turnedSize } from "./layout.ts";
import type { ShownView } from "./options.ts";
import type { FitMode, ViewerState, ZoomMode } from "./state.ts";

// The zoom rules: the scale that fits a page or its row to the viewport, and
// the zoom a destination or a view asks for. A resize runs them up to once a
// frame, so they allocate nothing the viewer's own methods did not, and read
// the viewport's size as late as those did, forcing no layout they did not.

/**
 * The scale a PDF's zoom of 1, a destination's or a script's, stands for:
 * the page at its printed size, 96 CSS pixels an inch of 72 points.
 */
export const PDF_TO_CSS = 96 / 72;

/** The largest scale "auto" fits to: pdf.js's `MAX_AUTO_SCALE`, its 125%. */
export const MAX_AUTO_SCALE = (1.25 * 96) / 72;

/** The viewport's size: the scroller, or what a test passes. */
export interface ViewportBox {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** What fitting depends on of the view: the viewer's state passes as it is. */
export type Arrangement = Pick<ViewerState, "rotation" | "spread" | "scrollMode">;

/**
 * The scale that fits the row of page `index`, the page or its spread, to
 * the viewport in `mode`; null while the pages' sizes are unknown. "auto"
 * fits as pdf.js's viewer does by default: the width when page `index` is
 * portrait, the whole row when it is landscape, and never above
 * `MAX_AUTO_SCALE`. In a
 * spread mode, a page alone in its row, such as a cover, counts twice, as
 * in pdf.js: the zoom then stays the same from row to row. In "horizontal"
 * mode, where all pages share one row, the page alone fits.
 */
export function fitScale(
  sizes: readonly PageSize[],
  view: Arrangement,
  index: number,
  mode: FitMode,
  scroller: ViewportBox | null,
  gap: number,
  minScale: number,
  maxScale: number,
): number | null {
  const { rotation, scrollMode } = view;
  // Pages that share one row side by side fit one by one, as in pdf.js.
  const spread = scrollMode === "horizontal" ? "none" : view.spread;
  const { first, last } = rowBounds(spread, index, sizes.length);
  let width = 0;
  let height = 0;
  let landscape = false;
  for (let page = first; page <= last; page++) {
    const size = sizes[page];
    if (!size) return null;
    const turned = turnedSize(size, rotation);
    if (page === index) landscape = turned.width > turned.height;
    width += turned.width;
    height = Math.max(height, turned.height);
  }
  const pages = spread === "none" ? 1 : 2;
  if (last === first) width *= pages;
  if (width === 0 || height === 0) return null;
  // The gaps around the row and between its pages stay the same at every zoom.
  const room = (scroller?.clientWidth ?? 0) - (1 + pages) * gap;
  const roomHeight = (scroller?.clientHeight ?? 0) - 2 * gap;
  let scale = room / width;
  const whole = mode === "fit-page" || (mode === "auto" && landscape);
  if (whole && roomHeight > 0) scale = Math.min(scale, roomHeight / height);
  if (mode === "auto") scale = Math.min(scale, MAX_AUTO_SCALE);
  return clamp(scale, minScale, maxScale);
}

/**
 * The zoom a destination asks for on page `target.pageIndex`, and the
 * zoom mode that keeps it; null to keep the zoom.
 */
export function destinationScale(
  sizes: readonly PageSize[],
  view: Arrangement,
  target: ResolvedDestination,
  scroller: ViewportBox | null,
  gap: number,
  minScale: number,
  maxScale: number,
): { scale: number; mode: ZoomMode } | null {
  const fit = target.view;
  const size = sizes[target.pageIndex];
  if (!fit || !scroller || !size) return null;
  const scaled = (scale: number) =>
    Number.isFinite(scale) && scale > 0
      ? { scale: clamp(scale, minScale, maxScale), mode: "custom" as const }
      : null;
  const quarter = view.rotation % 180 !== 0;
  switch (fit.fit) {
    case "zoom":
      return fit.zoom === null ? null : scaled(fit.zoom * PDF_TO_CSS);
    case "page":
    case "width": {
      const mode = fit.fit === "page" ? "fit-page" : "fit-width";
      const scale = fitScale(
        sizes,
        view,
        target.pageIndex,
        mode,
        scroller,
        gap,
        minScale,
        maxScale,
      );
      return scale === null ? null : { scale, mode };
    }
    case "height":
      return scaled((scroller.clientHeight - 2 * gap) / (quarter ? size.width : size.height));
    case "rect":
      return scaled(
        Math.min(
          scroller.clientWidth / (quarter ? fit.height : fit.width),
          scroller.clientHeight / (quarter ? fit.width : fit.height),
        ),
      );
  }
}

/**
 * The zoom a view's `scale` asks for: a fitted mode, whose scale the viewer
 * fits next, or a scale within `minScale` and `maxScale`. Left out, or not
 * a positive number, it keeps `before`'s.
 */
export function requestedZoom(
  requested: ShownView["scale"],
  before: Pick<ViewerState, "zoomMode" | "scale">,
  minScale: number,
  maxScale: number,
): { scale: number; mode: ZoomMode } {
  if (typeof requested === "string") {
    return { scale: before.scale, mode: requested };
  }
  if (requested !== undefined && Number.isFinite(requested) && requested > 0) {
    return { scale: clamp(requested, minScale, maxScale), mode: "custom" };
  }
  return { scale: before.scale, mode: before.zoomMode };
}

/**
 * Whether the viewport no longer has the size the zoom was fitted to in
 * `mode`: "fit-width" fits again when its width changed, "fit-page" and
 * "auto" when either side did, and "custom" never.
 */
export const refits = (
  mode: ZoomMode,
  scroller: ViewportBox,
  fittedWidth: number,
  fittedHeight: number,
): boolean =>
  (mode === "fit-width" && scroller.clientWidth !== fittedWidth) ||
  ((mode === "fit-page" || mode === "auto") &&
    (scroller.clientWidth !== fittedWidth || scroller.clientHeight !== fittedHeight));
