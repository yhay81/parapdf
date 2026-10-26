import type { DocumentSession, PdfInitialView, PdfPageLayout } from "../document/session.ts";
import type { ScrollMode, SpreadMode } from "../view/layout.ts";
import type { Opening, ViewerOptions } from "../view/viewer.ts";
import { toShownView, type ViewState } from "./view-state.ts";

export interface InitialViewOptions {
  /**
   * "document" opens the document as it asks to be opened: at its
   * /OpenAction destination, with its zoom, and with its pages arranged
   * as its /PageLayout says, in spreads or one page at a time. What the
   * application sets wins: `defaultPage`, the zoom, the spread, and the
   * scroll mode, controlled or by default. The default, "options", follows
   * the application alone.
   */
  initialView?: "options" | "document";
  /**
   * The view to open with, kept from `getViewState()`, such as the reader's
   * last position or one shared in a URL. Its fields win over the page, the
   * zoom, the spread, and the scroll mode the application sets, and over
   * `initialView`; those it leaves out still apply.
   */
  initialViewState?: Partial<ViewState>;
}

/** How pdf.js's viewer arranges pages for each /PageLayout. */
const PAGE_LAYOUTS: Record<PdfPageLayout, { spread: SpreadMode; scrollMode: ScrollMode }> = {
  SinglePage: { spread: "none", scrollMode: "page" },
  OneColumn: { spread: "none", scrollMode: "vertical" },
  TwoColumnLeft: { spread: "odd", scrollMode: "vertical" },
  TwoColumnRight: { spread: "even", scrollMode: "vertical" },
  TwoPageLeft: { spread: "odd", scrollMode: "page" },
  TwoPageRight: { spread: "even", scrollMode: "page" },
};

type Explicit = Pick<
  ViewerOptions,
  "initialPage" | "initialScale" | "initialSpread" | "initialScrollMode"
>;

/**
 * How a document of `pageCount` pages that asks to open as `view` opens:
 * with `initialView: "document"`, its pages arranged as its /PageLayout
 * asks, unless the application chose the arrangement, at its /OpenAction
 * destination, unless the application chose the page, with the zoom it asks
 * for, unless the application chose the zoom; with `initialViewState`, that
 * view, at the destination when the view names no page.
 */
export function openingOf(
  view: PdfInitialView | null,
  pageCount: number,
  options: InitialViewOptions & Explicit,
): Opening | null {
  const opening: Opening = {};
  const asked = options.initialView === "document" ? view : null;
  if (asked) {
    // A document that asks for no layout gets the default one, not the
    // layout of the document the viewer showed before.
    const arrangement =
      (asked.pageLayout ? PAGE_LAYOUTS[asked.pageLayout] : null) ?? PAGE_LAYOUTS.OneColumn;
    if (options.initialSpread === undefined) opening.spread = arrangement.spread;
    if (options.initialScrollMode === undefined) opening.scrollMode = arrangement.scrollMode;
    const destination = asked.destination;
    if (
      options.initialPage === undefined &&
      destination &&
      destination.pageIndex >= 0 &&
      destination.pageIndex < pageCount
    ) {
      // The application's zoom wins over the destination's.
      if (options.initialScale !== undefined) {
        const { view: _, ...point } = destination;
        opening.destination = point;
      } else opening.destination = destination;
    }
  }
  if (options.initialViewState) {
    const shown = toShownView(options.initialViewState);
    if (!shown.target && opening.destination) shown.target = opening.destination;
    opening.view = shown;
  }
  return Object.keys(opening).length > 0 ? opening : null;
}

/**
 * The viewer's `opening` for these options, which reads the document's
 * initial view only with `initialView: "document"`; undefined when they ask
 * for neither the document's view nor a view state.
 */
export function initialViewOpening(
  options: InitialViewOptions & Explicit,
): ViewerOptions["opening"] {
  if (options.initialView !== "document" && !options.initialViewState) return undefined;
  return async (session: DocumentSession) => {
    const view =
      options.initialView === "document"
        ? await session.initialView().catch((error: unknown) => {
            console.error("reading the initial view failed", error);
            return null;
          })
        : null;
    return openingOf(view, session.pageCount, options);
  };
}
