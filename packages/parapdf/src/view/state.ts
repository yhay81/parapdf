import type { ViewerState } from "./viewer.ts";

export type HotViewState = Pick<
  ViewerState,
  "layout" | "first" | "last" | "currentPage" | "scale" | "zoomMode"
>;
export type ColdViewState = Pick<ViewerState, "rotation" | "spread" | "scrollMode" | "tool">;

/** An immutable snapshot and its subscriptions, without a public writer. */
export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

class Snapshot<T extends object> implements ReadableStore<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get = (): T => this.#value;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Install all related snapshots before notifying any of their readers. */
  update(patch: Partial<T>): boolean {
    const keys = Object.keys(patch) as (keyof T)[];
    if (!keys.some((key) => !Object.is(this.#value[key], patch[key]))) return false;
    this.#value = { ...this.#value, ...patch };
    return true;
  }

  publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

/**
 * View state publishes separately from document/feature state. The combined
 * snapshot is the temporary feature facade until M4/M6 move those states to
 * their owners. Patches are atomic across all three subscription surfaces.
 */
export class ViewerStore implements ReadableStore<ViewerState> {
  readonly #all: Snapshot<ViewerState>;
  readonly #hot: Snapshot<HotViewState>;
  readonly #cold: Snapshot<ColdViewState>;
  readonly hot: ReadableStore<HotViewState>;
  readonly cold: ReadableStore<ColdViewState>;

  constructor(initial: ViewerState) {
    this.#all = new Snapshot(initial);
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
    this.hot = this.#hot = new Snapshot({ layout, first, last, currentPage, scale, zoomMode });
    this.cold = this.#cold = new Snapshot({ rotation, spread, scrollMode, tool });
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
