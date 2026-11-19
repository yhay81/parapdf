import { createSlotKey, type ReadableStore, Store } from "../document/store.ts";
import type { ViewerPosition } from "../view/navigation.ts";
import type { ViewerController } from "../view/viewer.ts";

export interface HistoryControls {
  /** Whether `back()` can return to a position before a link or outline jump. */
  canGoBack: boolean;
  /** Whether `forward()` can return to a position `back()` left. */
  canGoForward: boolean;
  /** Return to the position, and the zoom, before the most recent link or outline jump. */
  back(): void;
  /** Return to the position the most recent `back()` left. */
  forward(): void;
}

export type HistoryState = Pick<HistoryControls, "canGoBack" | "canGoForward">;

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

/** Each viewer's own navigation history store, which `useHistory()` shows. */
const HISTORY_SLOT = createSlotKey<ReadableStore<HistoryControls>>("parapdf.history");

/** `viewer`'s own navigation history store, attached at first use for the lifetime of `viewer`. */
export function historyOf(viewer: ViewerController): ReadableStore<HistoryControls> {
  return viewer.slot(HISTORY_SLOT, () => createHistoryStore(viewer));
}

function createHistoryStore(viewer: ViewerController): ReadableStore<HistoryControls> {
  const positions = new Positions<ViewerPosition>();
  const publish = () =>
    store.set({ canGoBack: positions.canGoBack, canGoForward: positions.canGoForward });
  // A viewer with no viewport has no position to leave, nor one to show:
  // the positions stay.
  const back = () => {
    const from = viewer.position();
    const entry = from && positions.back(from);
    publish();
    if (entry) viewer.restorePosition(entry);
  };
  const forward = () => {
    const from = viewer.position();
    const entry = from && positions.forward(from);
    publish();
    if (entry) viewer.restorePosition(entry);
  };
  const store = new Store<HistoryControls>({
    canGoBack: false,
    canGoForward: false,
    back,
    forward,
  });
  viewer.extend({
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
    closed(kept) {
      // Positions hold for the session, whichever pdf.js document shows it next.
      if (kept) return;
      positions.clear();
      publish();
    },
  });
  return store;
}
