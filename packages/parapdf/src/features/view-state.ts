import type { Rotation } from "../pdfjs/draw.ts";
import {
  pageAtPoint,
  pageLeft,
  pageTop,
  type ScrollMode,
  type SpreadMode,
  toRotation,
  turnBox,
  turnedSize,
} from "../view/layout.ts";
import type { ShownView } from "../view/options.ts";
import type { Viewer } from "../view/viewer.ts";

/**
 * Where and how a viewer shows its document, to keep and show again: a
 * plain, JSON-compatible object (see `getViewState()`).
 */
export interface ViewState {
  /** The zero-based page at the viewport's top-left corner. */
  page: number;
  /**
   * The point of that page at the viewport's top-left corner, in PDF points
   * from the page's top-left corner, unturned by the view: negative in the
   * space before the page.
   */
  x: number;
  y: number;
  /** CSS pixels per PDF point, or the fit that keeps the zoom. */
  scale: number | "fit-width" | "fit-page";
  rotation: Rotation;
  spread: SpreadMode;
  scrollMode: ScrollMode;
}

const SPREADS = new Set<string>(["none", "odd", "even"]);
const SCROLL_MODES = new Set<string>(["vertical", "horizontal", "wrapped", "page"]);

const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The view `view` asks for, with values of the wrong kind left out, so that
 * a view read from a URL needs no checking: a rotation rounded to a quarter
 * turn, a whole page, and a point only with a page. The viewer clamps the
 * page and the scale to its range.
 */
export function toShownView(view: Partial<ViewState>): ShownView {
  const shown: ShownView = {};
  if (number(view.rotation)) shown.rotation = toRotation(view.rotation);
  if (SPREADS.has(view.spread as string)) shown.spread = view.spread as SpreadMode;
  if (SCROLL_MODES.has(view.scrollMode as string)) {
    shown.scrollMode = view.scrollMode as ScrollMode;
  }
  if (view.scale === "fit-width" || view.scale === "fit-page") shown.scale = view.scale;
  else if (number(view.scale) && view.scale > 0) shown.scale = view.scale;
  if (number(view.page)) {
    shown.target = {
      pageIndex: Math.trunc(view.page),
      x: number(view.x) ? view.x : null,
      y: number(view.y) ? view.y : null,
    };
  }
  return shown;
}

/**
 * Where and how `viewer` shows its document now, to show again with
 * `setViewState()` or `initialViewState`, in this viewer or another, such
 * as when the reader opens the document again or follows a shared link.
 * Null until the document is ready.
 */
export function getViewState(viewer: Viewer): ViewState | null {
  const state = viewer.store.get();
  const layout = state.layout;
  const scroller = viewer.scroller;
  if (!layout || !scroller) return null;
  const { scrollLeft, scrollTop, clientWidth, clientHeight } = scroller;
  // The gap above a row belongs to it: a page shown from its top, as
  // `goToPage()` shows it, is the page of the view, not the one above.
  const page = pageAtPoint(layout, scrollLeft, scrollTop + layout.gap, clientWidth);
  const size = layout.sizes[page] ?? { width: 0, height: 0 };
  // The point on the page as it shows, turned back by the view's rotation.
  const point = turnBox(
    {
      x: (scrollLeft - pageLeft(layout, page, clientWidth)) / layout.scale,
      y: (scrollTop - pageTop(layout, page, clientHeight)) / layout.scale,
      width: 0,
      height: 0,
    },
    turnedSize(size, layout.rotation),
    ((360 - layout.rotation) % 360) as Rotation,
  );
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    page,
    x: round(point.x),
    y: round(point.y),
    scale: state.zoomMode === "custom" ? layout.scale : state.zoomMode,
    rotation: layout.rotation,
    spread: state.spread,
    scrollMode: state.scrollMode,
  };
}

/**
 * Show a view kept from `getViewState()`: its arrangement, rotation, and
 * zoom, and the same point of the same page at the viewport's top-left
 * corner. Fields left out keep the view's; without `x` and `y`, the page
 * shows from its top. Values out of range are clamped or ignored, so a
 * view read from a URL needs no checking.
 */
export function setViewState(viewer: Viewer, view: Partial<ViewState>): void {
  viewer.show(toShownView(view));
}
