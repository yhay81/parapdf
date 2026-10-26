/** An immutable snapshot and its subscriptions, without a public writer. */
export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * An immutable snapshot and its listeners: a session's document state, a
 * viewer's view state, and that of each feature with state of its own.
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
