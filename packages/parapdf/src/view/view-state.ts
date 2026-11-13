import type { Rotation } from "../pdfjs/draw.ts";
import {
  type Layout,
  pageAtPoint,
  pageLeft,
  pageTop,
  type ScrollMode,
  type SpreadMode,
  toRotation,
  turnBox,
  turnedSize,
} from "./layout.ts";
import type { ShownView } from "./options.ts";
import type { FitMode, ViewerState } from "./state.ts";

/**
 * Where and how a viewer shows its document, to keep and show again: a
 * plain, JSON-compatible object (see `viewer.viewState()`).
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
  scale: number | FitMode;
  rotation: Rotation;
  spread: SpreadMode;
  scrollMode: ScrollMode;
}

const FIT_MODES = new Set<string>(["fit-width", "fit-page", "auto"]);
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
  if (FIT_MODES.has(view.scale as string)) shown.scale = view.scale as FitMode;
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
 * Where and how a viewer shows its document now, from its layout, scroll
 * container, and state.
 */
export function viewStateAt(
  layout: Layout,
  scroller: Pick<HTMLElement, "scrollLeft" | "scrollTop" | "clientWidth" | "clientHeight">,
  state: Pick<ViewerState, "zoomMode" | "spread" | "scrollMode">,
): ViewState {
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

/** Whether two `ViewState` snapshots describe the exact same view. */
export function sameViewState(a: ViewState | null, b: ViewState): boolean {
  return (
    a !== null &&
    a.page === b.page &&
    a.x === b.x &&
    a.y === b.y &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.spread === b.spread &&
    a.scrollMode === b.scrollMode
  );
}
