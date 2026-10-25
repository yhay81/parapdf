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

/**
 * An immutable snapshot and its listeners: the viewer's state, and that of
 * each feature with state of its own.
 */
export class Store<T extends object> implements ReadableStore<T> {
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

  /** Apply `patch` and notify the listeners, unless it changes nothing. */
  set(patch: Partial<T>): void {
    if (this.update(patch)) this.publish();
  }
}

/**
 * View state publishes separately from the document's state. The combined
 * snapshot keeps the document's state until M6 moves it to the session.
 * Patches are atomic across all three subscription surfaces.
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
