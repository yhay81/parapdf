import type { PageSize } from "../document/session.ts";
import { Store, subscribeKeys } from "../document/store.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Direction, Layout, ScrollMode, SpreadMode } from "./layout.ts";

/**
 * What a viewer shows: its view of the document, which its store publishes.
 * The document's own state is its session's (`PdfSession.state`).
 */
export interface ViewerState {
  /** The pages laid out at the current zoom; null until a document shows. */
  layout: Layout | null;
  /** Pages in the laid-out document; 0 until a document shows. */
  pageCount: number;
  /** Mounted page window: visible pages plus overscan. */
  first: number;
  last: number;
  /**
   * The page being read: the page nearest the viewport's center, except that
   * the current page stays current while all of it is in view, as in pdf.js.
   * `goToPage()`, links, `back()`, and search make the page they show
   * current, which then stays so even when it is too small to reach the
   * center, as the first page at the start of a row of pages is.
   */
  currentPage: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /**
   * "fit-width" keeps fitting the width of the current page as the viewport
   * resizes or the view turns, "fit-page" all of that page, "auto" the
   * width of a portrait page and all of a landscape one, never above 5/3;
   * "custom" keeps `scale`.
   */
  zoomMode: ZoomMode;
  /**
   * What a mouse drag does: "select" selects text, "hand" scrolls the
   * document like grabbing paper.
   */
  tool: PointerTool;
  /** Clockwise view rotation of every page. */
  rotation: Rotation;
  /** Whether pages show one per row or side by side in pairs. */
  spread: SpreadMode;
  /**
   * How pages are arranged and scrolled: in a column, in a row, in rows
   * filling the viewport's width, or one page or spread at a time.
   */
  scrollMode: ScrollMode;
  /**
   * The order of pages in a row: the `direction` option, or the document's
   * /ViewerPreferences /Direction, or "ltr".
   */
  direction: Direction;
}

export type ZoomMode = FitMode | "custom";

/** The zoom modes that fit the page to the viewport again as it resizes. */
export type FitMode = "fit-width" | "fit-page" | "auto";

export type PointerTool = "select" | "hand";

/** Keys reported to key-filtered `ViewerStore` listeners. */
export type ViewerStoreKey = keyof ViewerState | "sizes" | "externalLinks";

/**
 * A viewer's single key-filtered store: publishes `ViewerState` along with
 * derived unrotated `sizes` (`"sizes"` only when `layout?.sizes` changes) and
 * `externalLinks` (`"externalLinks"`), installing all snapshots atomically
 * before notifying listeners.
 */
export class ViewerStore extends Store<ViewerState> {
  #externalLinks: "new-tab" | "disabled" = "new-tab";

  get sizes(): readonly PageSize[] | undefined {
    return this.get().layout?.sizes;
  }

  get externalLinks(): "new-tab" | "disabled" {
    return this.#externalLinks;
  }

  subscribeKeys = (keys: readonly ViewerStoreKey[], listener: () => void): (() => void) =>
    subscribeKeys(this, keys, listener);

  override set(patch: Partial<ViewerState>): void {
    const prevSizes = this.sizes;
    const hasLayout = "layout" in patch;
    const full =
      hasLayout && patch.pageCount === undefined
        ? { ...patch, pageCount: patch.layout?.sizes.length ?? 0 }
        : patch;
    const stateChanged = this.update(full);
    if (hasLayout && !Object.is(prevSizes, this.sizes)) {
      this.markChanged("sizes");
    }
    if (stateChanged) this.publish();
  }

  setExternalLinks(externalLinks: "new-tab" | "disabled"): void {
    if (this.#externalLinks === externalLinks) return;
    this.#externalLinks = externalLinks;
    this.markChanged("externalLinks");
    this.publish();
  }
}
