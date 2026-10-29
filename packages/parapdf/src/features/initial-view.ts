import type { DocumentSession, PdfInitialView, PdfPageLayout } from "../document/session.ts";
import type { Destination, ResolvedDestination } from "../pdfjs/destinations.ts";
import type { ScrollMode, SpreadMode } from "../view/layout.ts";
import type { Opening, ViewerOptions } from "../view/options.ts";
import type { Viewer } from "../view/viewer.ts";
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

/** The views pdf.js's viewer names in a URL's `zoom`, as destinations. */
const ZOOM_NAMES: Record<string, (left: number | null, top: number | null) => unknown[]> = {
  "page-actual": (left, top) => [{ name: "XYZ" }, left, top, 1],
  "page-width": (_, top) => [{ name: "FitH" }, top],
  "page-height": (left) => [{ name: "FitV" }, left],
  "page-fit": () => [{ name: "Fit" }],
};

/**
 * Where a URL's fragment, without its "#", points with the open parameters
 * of RFC 8118, as pdf.js's viewer reads them (`PDFLinkService.setHash()`):
 * the destination `nameddest` names, then, should it point nowhere, the
 * one that `page` (from 1) and `zoom` make, on page `current` when the
 * fragment names no page. Empty when it has none of them; `search` and
 * `pagemode` are the application's.
 */
export function fragmentDestinations(fragment: string, current: number): Destination[] {
  if (!fragment.includes("=")) return [];
  const params = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(fragment)) params.set(key.toLowerCase(), value);
  const destinations: Destination[] = [];
  const named = params.get("nameddest");
  if (named) destinations.push(named);
  const page = params.has("page") ? (Number(params.get("page")) | 0 || 1) - 1 : null;
  const zoom = params.get("zoom");
  let view: unknown[] | null = null;
  if (zoom !== undefined) {
    // pdf.js's viewer reads the numbers as it does, truncated, 0 for junk.
    const [name = "", ...rest] = zoom.split(",");
    const arg = (index: number) => (rest.length > index ? Number(rest[index]) | 0 : null);
    const percent = Number.parseFloat(name);
    if (!name.includes("Fit")) {
      const byName = ZOOM_NAMES[name];
      // A zoom it cannot name, such as "auto", keeps the zoom.
      view = byName
        ? byName(arg(0), arg(1))
        : [{ name: "XYZ" }, arg(0), arg(1), percent ? percent / 100 : null];
    } else if (name === "Fit" || name === "FitB") view = [{ name }];
    else if (["FitH", "FitBH", "FitV", "FitBV"].includes(name)) view = [{ name }, arg(0)];
    else if (name === "FitR" && rest.length === 4) view = [{ name }, ...rest.map((_, i) => arg(i))];
  }
  if (view) destinations.push([page ?? current, ...view] as Destination);
  else if (page !== null)
    destinations.push([page, { name: "XYZ" }, null, null, null] as Destination);
  return destinations;
}

/** The first of `destinations` that points somewhere in `session`'s document. */
async function firstResolved(
  session: DocumentSession,
  destinations: readonly Destination[],
): Promise<ResolvedDestination | null> {
  for (const dest of destinations) {
    const target = await session.resolveDestination(dest).catch(() => null);
    if (target && target.pageIndex >= 0 && target.pageIndex < session.pageCount) return target;
  }
  return null;
}

/**
 * Move `viewer` where `fragment` points, as following a link does: a new
 * fragment of an open document's URL.
 */
export async function goToFragment(viewer: Viewer, fragment: string): Promise<void> {
  for (const dest of fragmentDestinations(fragment, viewer.store.get().currentPage)) {
    if (await viewer.goToDestination(dest)) return;
  }
}

/**
 * How a document of `pageCount` pages that asks to open as `view` opens:
 * with `initialView: "document"`, its pages arranged as its /PageLayout
 * asks, unless the application chose the arrangement, at its /OpenAction
 * destination, unless the application chose the page, with the zoom it asks
 * for, unless the application chose the zoom; at `linked`, where the URL's
 * fragment points, over the document's destination and the page and zoom
 * the application chose; with `initialViewState`, that view, at `linked` or
 * the destination when the view names no page.
 */
export function openingOf(
  view: PdfInitialView | null,
  pageCount: number,
  options: InitialViewOptions & Explicit,
  linked: ResolvedDestination | null = null,
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
  const target = linked && linked.pageIndex >= 0 && linked.pageIndex < pageCount ? linked : null;
  if (options.initialViewState || target) {
    // A view wins over the application's page and zoom, as the fragment does.
    const shown = options.initialViewState ? toShownView(options.initialViewState) : {};
    const at = target ?? opening.destination;
    if (!shown.target && at) shown.target = at;
    opening.view = shown;
  }
  return Object.keys(opening).length > 0 ? opening : null;
}

/**
 * The viewer's `opening` for these options, which reads the document's
 * initial view only with `initialView: "document"`, and `fragment()`, the
 * fragment of the document's URL, as the document opens; undefined when
 * they ask for neither the document's view, a view state, nor a fragment.
 */
export function initialViewOpening(
  options: InitialViewOptions & Explicit & { fragment?: () => string },
): ViewerOptions["opening"] {
  const { fragment } = options;
  if (options.initialView !== "document" && !options.initialViewState && !fragment) {
    return undefined;
  }
  return async (session: DocumentSession) => {
    const view =
      options.initialView === "document"
        ? await session.initialView().catch((error: unknown) => {
            console.error("reading the initial view failed", error);
            return null;
          })
        : null;
    // A zoom without a page applies to the page the document opens at otherwise.
    const page =
      options.initialPage ??
      (options.initialView === "document" ? view?.destination?.pageIndex : undefined) ??
      0;
    const destinations = fragment ? fragmentDestinations(fragment(), page) : [];
    const linked = destinations.length > 0 ? await firstResolved(session, destinations) : null;
    return openingOf(view, session.pageCount, options, linked);
  };
}
