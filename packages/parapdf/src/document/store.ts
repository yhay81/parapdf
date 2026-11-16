/** Listener notified when a store publishes; receives changed keys when known. */
export type StoreListener = (changedKeys?: ReadonlySet<PropertyKey>) => void;

/** Typed symbol key for feature-owned state stored directly on a controller or session. */
export type SlotKey<T> = symbol & { readonly __slot?: T };

export function createSlotKey<T>(description: string): SlotKey<T> {
  return Symbol(description) as SlotKey<T>;
}

/** An immutable snapshot and its subscriptions, without a public writer. */
export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: StoreListener): () => void;
}

/**
 * An immutable snapshot and its listeners: a session's document state, a
 * viewer's view state, and that of each feature with state of its own.
 */
export class Store<T extends object> implements ReadableStore<T> {
  #value: T;
  readonly #listeners = new Set<StoreListener>();
  #pendingKeys = new Set<PropertyKey>();
  #publishingKeys = new Set<PropertyKey>();
  #publishing = false;
  #batchDepth = 0;
  #batchBase: T | null = null;

  constructor(value: T) {
    this.#value = value;
  }

  get = (): T => this.#value;

  get batching(): boolean {
    return this.#batchDepth > 0;
  }

  subscribe = (listener: StoreListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Install all related snapshots before notifying any of their readers. */
  update(patch: Partial<T>): boolean {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.#value[key], patch[key])) {
        this.#pendingKeys.add(key);
        changed = true;
      }
    }
    if (!changed) return false;
    this.#value = { ...this.#value, ...patch };
    return true;
  }

  markChanged(key: PropertyKey): void {
    this.#pendingKeys.add(key);
  }

  unmarkChanged(key: PropertyKey): void {
    this.#pendingKeys.delete(key);
  }

  protected finalizeBatch(_base: T): void {}

  /**
   * Coalesce synchronous `set()` updates into at most one `publish()` when the
   * outermost `batch()` exits, pruning keys that reverted to their pre-batch values.
   */
  batch<R>(fn: () => R): R {
    if (this.#batchDepth === 0) {
      this.#batchBase = this.#value;
    }
    this.#batchDepth++;
    try {
      return fn();
    } finally {
      if (--this.#batchDepth === 0) {
        const base = this.#batchBase;
        this.#batchBase = null;
        if (base && this.#pendingKeys.size > 0) {
          let anyOwnDiff = false;
          for (const key of this.#pendingKeys) {
            if (Object.hasOwn(base, key) || Object.hasOwn(this.#value, key)) {
              const k = key as keyof T;
              if (Object.is(base[k], this.#value[k])) {
                this.#pendingKeys.delete(key);
              } else {
                anyOwnDiff = true;
              }
            }
          }
          if (!anyOwnDiff && base !== this.#value) {
            this.#value = base;
          }
          this.finalizeBatch(base);
        }
        if (this.#pendingKeys.size > 0) {
          this.publish();
        }
      }
    }
  }

  publish(): void {
    if (this.#listeners.size === 0) {
      this.#pendingKeys.clear();
      return;
    }
    if (this.#pendingKeys.size === 0) {
      this.#notifyListeners(undefined);
      return;
    }
    if (this.#publishing) {
      const changedKeys = new Set(this.#pendingKeys);
      this.#pendingKeys.clear();
      this.#notifyListeners(changedKeys);
      return;
    }
    const changedKeys = this.#pendingKeys;
    this.#pendingKeys = this.#publishingKeys;
    this.#publishingKeys = changedKeys;
    this.#publishing = true;
    try {
      this.#notifyListeners(changedKeys);
    } finally {
      changedKeys.clear();
      this.#publishing = false;
    }
  }

  #notifyListeners(changedKeys: ReadonlySet<PropertyKey> | undefined): void {
    if (this.#listeners.size === 1) {
      for (const listener of this.#listeners) {
        listener(changedKeys);
        break;
      }
      return;
    }
    for (const listener of [...this.#listeners]) listener(changedKeys);
  }

  /** Apply `patch` and notify the listeners (or queue for the enclosing `batch()`), unless it changes nothing. */
  set(patch: Partial<T>): void {
    if (this.update(patch) && !this.batching) this.publish();
  }
}

/** Subscribe a listener that runs only when `changedKeys` is unknown or intersects `keys`. */
export function subscribeKeys(
  store: ReadableStore<unknown>,
  keys: readonly PropertyKey[],
  listener: () => void,
): () => void {
  return store.subscribe((changedKeys) => {
    if (changedKeys) {
      let hit = false;
      for (let index = 0; index < keys.length; index++) {
        if (changedKeys.has(keys[index] as PropertyKey)) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
    }
    listener();
  });
}
