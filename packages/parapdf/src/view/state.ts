import { type ReadableStore, Store } from "../document/store.ts";
import type { ViewerState } from "./viewer.ts";

export type HotViewState = Pick<
  ViewerState,
  "layout" | "first" | "last" | "currentPage" | "scale" | "zoomMode"
>;
export type ColdViewState = Pick<ViewerState, "rotation" | "spread" | "scrollMode" | "tool">;

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
    } = initial;
    this.hot = this.#hot = new Store({ layout, first, last, currentPage, scale, zoomMode });
    this.cold = this.#cold = new Store({ rotation, spread, scrollMode, tool });
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
