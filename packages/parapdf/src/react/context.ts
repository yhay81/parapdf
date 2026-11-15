"use client";

import { createContext, use, useCallback, useContext, useRef, useSyncExternalStore } from "react";
import { browser } from "react-dom";
import {
  type PdfSession,
  type PdfSessionController,
  sessionControllerOf,
} from "../document/pdf-session.ts";
import { type DocumentState, OPENING } from "../document/registry.ts";
import type { PageSize } from "../document/session.ts";
import { type ReadableStore, subscribeKeys } from "../document/store.ts";
import type { ViewerState } from "../view/state.ts";
import { controllerOf, type Viewer, ViewerController } from "../view/viewer.ts";

export const SessionContext = createContext<PdfSessionController | null>(null);

/**
 * Holds `<PdfDocument>`'s default `ViewerController` lazily so document-only
 * subtrees (`useSession()`, `useDocumentState()`, `useOutline()`, `getText()`,
 * `save()`) and `<PdfView>` panes allocate no unused `ViewerController`.
 */
export class LazyViewerHolder {
  #viewer: ViewerController | null = null;
  #release: (() => void) | null = null;
  #connected = false;

  get(): ViewerController {
    let viewer = this.#viewer;
    if (!viewer) {
      viewer = new ViewerController();
      this.#viewer = viewer;
      if (this.#connected) this.#release = viewer.hold();
    }
    return viewer;
  }

  get peek(): ViewerController | null {
    return this.#viewer;
  }

  connect(): () => void {
    this.#connected = true;
    if (this.#viewer && !this.#release) {
      this.#release = this.#viewer.hold();
    }
    return () => {
      this.#connected = false;
      const release = this.#release;
      this.#release = null;
      release?.();
    };
  }
}

/** The viewer (or lazy default viewer holder) of the nearest `<PdfView>` or `<PdfDocument>`. */
export const ViewerContext = createContext<ViewerController | LazyViewerHolder | null>(null);

/** The page index and unturned PDF size of the `<PdfPageOverlay>` or `<PdfPageOverlays>` subtree. */
export const PageContext = createContext<{
  pageIndex: number;
  size: PageSize | undefined;
} | null>(null);

/**
 * `viewer` when given, otherwise the viewer of the nearest `<PdfView>` or
 * `<PdfDocument>`, instantiating `<PdfDocument>`'s default viewer on first use.
 */
export function useOptionalViewer(viewer?: Viewer): ViewerController {
  const contextValue = useContext(ViewerContext);
  if (viewer) return controllerOf(viewer);
  if (!contextValue) {
    throw new Error(
      "useViewer must be used inside <PdfDocument> or <PdfView>, or pass a Viewer from useCreateViewer()",
    );
  }
  return contextValue instanceof ViewerController ? contextValue : contextValue.get();
}

/** Read a derived slice of `store`, waking React only when one of `keys` changed. */
export function useStoreKeys<T, S>(
  store: ReadableStore<T>,
  keys: readonly PropertyKey[],
  selector: (state: T) => S,
): S {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeKeys(store, keys, onStoreChange),
    [store, keys],
  );
  return useSyncExternalStore(
    subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * Whether two selected values are equal: `Object.is`, elements of arrays, or
 * own properties of plain objects, so selectors returning `{ page, scale }`
 * or `[page, scale]` keep their snapshot while their fields stay equal.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
      if (!Object.is(a[index], b[index])) return false;
    }
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (
      !Object.hasOwn(b, key) ||
      !Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }
  return true;
}

interface SelectedCache<T, S> {
  raw: T;
  selector: (state: T) => S;
  value: S;
}

export interface TrackedSnapshot<T extends object> {
  raw: T;
  readonly proxy: T;
  readonly tracked: Set<PropertyKey>;
  readonly fallback: ReadonlySet<PropertyKey> | null;
}

interface SliceState<T extends object, S> {
  readonly store: ReadableStore<T>;
  readonly subscribe: (onStoreChange: () => void) => () => void;
  hasSelector: boolean;
  pendingNotify: boolean;
  trackedClient: TrackedSnapshot<T> | null;
  trackedServer: TrackedSnapshot<T> | null;
  selectedClient: SelectedCache<T, S> | null;
  selectedServer: SelectedCache<T, S> | null;
}

export function createTrackedSnapshot<T extends object>(
  raw: T,
  fallback: ReadonlySet<PropertyKey> | null = null,
): TrackedSnapshot<T> {
  const tracked = new Set<PropertyKey>();
  const snapshot: {
    raw: T;
    proxy?: T;
    readonly tracked: Set<PropertyKey>;
    readonly fallback: ReadonlySet<PropertyKey> | null;
  } = { raw, tracked, fallback };
  const proxy = new Proxy({} as T, {
    get(_target, property) {
      tracked.add(property);
      return Reflect.get(snapshot.raw, property, snapshot.raw);
    },
    has(_target, property) {
      tracked.add(property);
      return Reflect.has(snapshot.raw, property);
    },
    ownKeys() {
      const keys = Reflect.ownKeys(snapshot.raw);
      for (const key of keys) tracked.add(key);
      return keys;
    },
    getOwnPropertyDescriptor(_target, property) {
      tracked.add(property);
      const descriptor = Reflect.getOwnPropertyDescriptor(snapshot.raw, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
  snapshot.proxy = proxy;
  return snapshot as TrackedSnapshot<T>;
}

export function activeTracked<T extends object>(
  snapshot: TrackedSnapshot<T>,
): ReadonlySet<PropertyKey> | null {
  return snapshot.tracked.size > 0 ? snapshot.tracked : snapshot.fallback;
}

export function hasTrackedChange<T extends object>(
  previous: T,
  next: T,
  tracked: ReadonlySet<PropertyKey> | null,
): boolean {
  if (!tracked || Object.is(previous, next)) return false;
  for (const key of tracked) {
    if (!Object.is(Reflect.get(previous, key, previous), Reflect.get(next, key, next))) {
      return true;
    }
  }
  return false;
}

export function selectCached<T, S>(
  previous: SelectedCache<T, S> | null,
  raw: T,
  selector: (state: T) => S,
): SelectedCache<T, S> {
  if (previous && Object.is(previous.raw, raw) && previous.selector === selector) {
    return previous;
  }
  const next = selector(raw);
  if (previous && shallowEqual(previous.value, next)) {
    previous.raw = raw;
    previous.selector = selector;
    return previous;
  }
  return { raw, selector, value: next };
}

export function useStoreSlice<T extends object>(store: ReadableStore<T>, serverState: () => T): T;
export function useStoreSlice<T extends object, S>(
  store: ReadableStore<T>,
  serverState: () => T,
  selector: ((state: T) => S) | undefined,
): T | S;
export function useStoreSlice<T extends object, S>(
  store: ReadableStore<T>,
  serverState: () => T,
  selector?: ((state: T) => S) | undefined,
): T | S {
  const ref = useRef<SliceState<T, S> | null>(null);
  const ensure = (): SliceState<T, S> => {
    let state = ref.current;
    if (!state || state.store !== store) {
      const created: SliceState<T, S> = {
        store,
        subscribe: (onStoreChange) =>
          store.subscribe((changedKeys) => {
            if (!created.pendingNotify) {
              if (
                created.hasSelector &&
                created.selectedClient &&
                Object.is(created.selectedClient.raw, store.get())
              ) {
                return;
              }
              if (!created.hasSelector && changedKeys && created.trackedClient) {
                const tracked = activeTracked(created.trackedClient);
                let hit = false;
                if (tracked) {
                  for (const key of changedKeys) {
                    if (tracked.has(key)) {
                      hit = true;
                      break;
                    }
                  }
                }
                if (!hit) {
                  created.trackedClient.raw = store.get();
                  return;
                }
              }
            }
            created.pendingNotify = true;
            onStoreChange();
          }),
        hasSelector: Boolean(selector),
        pendingNotify: false,
        trackedClient: null,
        trackedServer: null,
        selectedClient: null,
        selectedServer: null,
      };
      state = created;
      ref.current = state;
    }
    state.hasSelector = Boolean(selector);
    return state;
  };
  const sliceState = ensure();
  return useSyncExternalStore(
    sliceState.subscribe,
    () => {
      const state = ensure();
      state.pendingNotify = false;
      const raw = store.get();
      if (selector) {
        state.selectedClient = selectCached(state.selectedClient, raw, selector);
        return state.selectedClient.value;
      }
      if (!state.trackedClient) {
        state.trackedClient =
          state.trackedServer && Object.is(state.trackedServer.raw, raw)
            ? state.trackedServer
            : createTrackedSnapshot(
                raw,
                state.trackedServer ? activeTracked(state.trackedServer) : null,
              );
      } else if (
        hasTrackedChange(state.trackedClient.raw, raw, activeTracked(state.trackedClient))
      ) {
        state.trackedClient = createTrackedSnapshot(raw, activeTracked(state.trackedClient));
      } else {
        state.trackedClient.raw = raw;
      }
      return state.trackedClient.proxy;
    },
    () => {
      const state = ensure();
      const raw = serverState();
      if (selector) {
        state.selectedServer = selectCached(state.selectedServer, raw, selector);
        return state.selectedServer.value;
      }
      if (!state.trackedServer || !Object.is(state.trackedServer.raw, raw)) {
        state.trackedServer = createTrackedSnapshot(
          raw,
          state.trackedServer ? activeTracked(state.trackedServer) : null,
        );
      }
      return state.trackedServer.proxy;
    },
  );
}

/**
 * The session of the nearest `<PdfDocument>`: its document state snapshot,
 * the answer to its password request, pdf.js's document, and its signal.
 */
export function useSession(): PdfSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  return session;
}

/** `session` when given, otherwise the session of the nearest `<PdfDocument>`. */
export function useOptionalSession(session?: PdfSession): PdfSessionController {
  const contextSession = useContext(SessionContext);
  if (session) return sessionControllerOf(session);
  if (!contextSession) {
    throw new Error("useSession must be used inside <PdfDocument>, or pass a PdfSession");
  }
  return contextSession;
}

/**
 * The session controller, for a hook that reads the document's secondary data.
 * The server opens no document, so `browser()` throws there instead of the hook
 * suspending on a read that never settles: the nearest Suspense boundary
 * renders its fallback, and React renders the hook's component in the
 * browser without reporting an error.
 */
const SESSION_READS_KEYS: readonly PropertyKey[] = ["status", "passwordReason"];

export function useSessionData(hook: string): PdfSessionController {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  use(browser(() => `${hook} reads the document, which only the browser opens`));
  // What settled empty while the document waited for a password is read
  // anew once it is answered, and so is everything once the provider holds
  // the document opened again: render again to read it.
  useStoreKeys(session.stateStore, SESSION_READS_KEYS, () => session.reads);
  return session;
}

/**
 * The nearest `<PdfDocument>`'s document state: status, error, password
 * request, progress, page count, and permissions. Called without a selector,
 * it tracks the fields read during rendering and renders again only when one
 * of them changes; called with `selector`, it compares the selected value
 * shallowly.
 */
export function useDocumentState(): DocumentState;
export function useDocumentState<T>(selector: (state: DocumentState) => T): T;
export function useDocumentState<T>(selector?: (state: DocumentState) => T): DocumentState | T {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  // The server opened no document. A later root may hydrate after another
  // root already opened the same source; its first snapshot must match the HTML.
  return useStoreSlice(session.stateStore, () => OPENING, selector);
}

/**
 * The view state of `viewer`, or of the nearest `<PdfView>` or
 * `<PdfDocument>`: its layout, page count, mounted window, current page,
 * zoom, rotation, spread, scroll mode, direction, and tool. Called without a
 * selector, it tracks the fields read during rendering and renders again only
 * when one of them changes; called with `selector`, it compares the selected
 * value shallowly.
 */
export function useViewState(viewer?: Viewer): ViewerState;
export function useViewState<T>(selector: (state: ViewerState) => T, viewer?: Viewer): T;
export function useViewState<T>(
  selectorOrViewer?: ((state: ViewerState) => T) | Viewer,
  maybeViewer?: Viewer,
): ViewerState | T {
  const isSelector = typeof selectorOrViewer === "function";
  const viewer = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(viewer.store, viewer.store.get, selector);
}
