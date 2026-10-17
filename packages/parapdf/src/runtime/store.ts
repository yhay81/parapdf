/**
 * A minimal external store for `useSyncExternalStore`.
 *
 * `set` publishes only when a top-level field actually changes, which is what
 * keeps React out of the hot path: scrolling recomputes the window every frame
 * but commits only when the result differs.
 */
export class Store<T extends object> {
  #state: T;
  #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#state = initial;
  }

  get = (): T => this.#state;

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.#state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}
