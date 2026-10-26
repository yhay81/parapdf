import { type ReadableStore, Store } from "../document/store.ts";
import type { ViewerPosition } from "../view/navigation.ts";
import type { Viewer } from "../view/viewer.ts";

export interface HistoryState {
  /** Whether `back()` can return to a position before a link or outline jump. */
  canGoBack: boolean;
  /** Whether `forward()` can return to a position `back()` left. */
  canGoForward: boolean;
}

/** Back and forward through the positions a viewer's links and outline jumped from. */
export interface History {
  readonly store: ReadableStore<HistoryState>;
  /** Return to the position, and the zoom, before the most recent link or outline jump. */
  back(): void;
  /** Return to the position the most recent `back()` left. */
  forward(): void;
  /** Forget the positions; the viewer's jumps are no longer kept. */
  detach(): void;
}

/** Jumps kept for `back()`. */
export const HISTORY_LIMIT = 50;

/**
 * The positions before jumps, latest last, and those `back()` left, for
 * `forward()`; a new jump forgets those.
 */
export class Positions<T> {
  #past: T[] = [];
  #future: T[] = [];

  get canGoBack(): boolean {
    return this.#past.length > 0;
  }

  get canGoForward(): boolean {
    return this.#future.length > 0;
  }

  /** Keep `position`, the one before a jump. */
  push(position: T): void {
    this.#past.push(position);
    if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    this.#future = [];
  }

  /** The position to go back to from `current`, which `forward()` then returns to. */
  back(current: T | null): T | null {
    const entry = this.#past.pop() ?? null;
    if (entry && current) this.#future.push(current);
    return entry;
  }

  /** The position `back()` left, going forward from `current`. */
  forward(current: T | null): T | null {
    const entry = this.#future.pop() ?? null;
    if (entry && current) this.#past.push(current);
    return entry;
  }

  clear(): void {
    this.#past = [];
    this.#future = [];
  }
}

/** Keep where `viewer`'s links, outline, and named actions jumped from; `detach()` undoes it. */
export function attachHistory(viewer: Viewer): History {
  const positions = new Positions<ViewerPosition>();
  const store = new Store<HistoryState>({ canGoBack: false, canGoForward: false });
  const publish = () =>
    store.set({ canGoBack: positions.canGoBack, canGoForward: positions.canGoForward });
  const back = () => {
    const entry = positions.back(viewer.position());
    publish();
    if (entry) viewer.restorePosition(entry);
  };
  const forward = () => {
    const entry = positions.forward(viewer.position());
    publish();
    if (entry) viewer.restorePosition(entry);
  };
  const detachExtension = viewer.extend({
    jumping() {
      const position = viewer.position();
      if (!position) return;
      positions.push(position);
      publish();
    },
    namedAction(action) {
      if (action === "GoBack") back();
      else if (action === "GoForward") forward();
    },
    closed() {
      positions.clear();
      publish();
    },
  });
  return {
    store,
    back,
    forward,
    detach() {
      detachExtension();
      positions.clear();
      publish();
    },
  };
}

/** Each viewer's own history, which `useHistory()` shows. */
const shared = new WeakMap<Viewer, History>();

/**
 * `viewer`'s own history, which `useHistory()` shows: attached at the
 * first call, and kept until its `detach()`.
 */
export function historyOf(viewer: Viewer): History {
  let history = shared.get(viewer);
  if (!history) {
    const attached = attachHistory(viewer);
    const own: History = {
      ...attached,
      detach() {
        attached.detach();
        if (shared.get(viewer) === own) shared.delete(viewer);
      },
    };
    shared.set(viewer, own);
    history = own;
  }
  return history;
}
