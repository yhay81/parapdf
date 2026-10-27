import { type ReadableStore, Store } from "../document/store.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Direction, Layout, ScrollMode, SpreadMode } from "./layout.ts";

/**
 * What a viewer shows: its view of the document, which its store publishes.
 * The document's own state is its session's (`PdfSession.state`).
 */
export interface ViewerState {
  /** The pages laid out at the current zoom; null until a document shows. */
  layout: Layout | null;
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
   * resizes or the view turns, "fit-page" all of that page; "custom" keeps
   * `scale`.
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

export type ZoomMode = "fit-width" | "fit-page" | "custom";

export type PointerTool = "select" | "hand";

export type HotViewState = Pick<
  ViewerState,
  "layout" | "first" | "last" | "currentPage" | "scale" | "zoomMode"
>;
export type ColdViewState = Pick<
  ViewerState,
  "rotation" | "spread" | "scrollMode" | "tool" | "direction"
>;

/**
 * A viewer's view state: its hot and cold parts, published apart, and the
 * two together. Patches are atomic across all three subscription surfaces.
 */
export class ViewerStore implements ReadableStore<ViewerState> {
  readonly #all: Store<ViewerState>;
  readonly #hot: Store<HotViewState>;
  readonly #cold: Store<ColdViewState>;
  readonly hot: ReadableStore<HotViewState>;
  readonly cold: ReadableStore<ColdViewState>;

  constructor(initial: ViewerState) {
    this.#all = new Store(initial);
    const {
      layout,
      first,
      last,
      currentPage,
      scale,
      zoomMode,
      rotation,
      spread,
      scrollMode,
      tool,
      direction,
    } = initial;
    this.hot = this.#hot = new Store({ layout, first, last, currentPage, scale, zoomMode });
    this.cold = this.#cold = new Store({ rotation, spread, scrollMode, tool, direction });
  }

  get = (): ViewerState => this.#all.get();
  subscribe = (listener: () => void): (() => void) => this.#all.subscribe(listener);

  set(patch: Partial<ViewerState>): void {
    if (!this.#all.update(patch)) return;
    const hot: Partial<HotViewState> = {};
    const cold: Partial<ColdViewState> = {};
    for (const key of Object.keys(patch) as (keyof ViewerState)[]) {
      if (key in this.#hot.get()) Object.assign(hot, { [key]: patch[key] });
      else if (key in this.#cold.get()) Object.assign(cold, { [key]: patch[key] });
    }
    const hotChanged = this.#hot.update(hot);
    const coldChanged = this.#cold.update(cold);
    this.#all.publish();
    if (hotChanged) this.#hot.publish();
    if (coldChanged) this.#cold.publish();
  }
}
