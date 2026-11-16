"use client";

import {
  createContext,
  use,
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
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
  if (viewer) return controllerOf(viewer);
  const contextValue = use(ViewerContext);
  if (!contextValue) {
    throw new Error(
      "useViewer must be used inside <PdfDocument> or <PdfView>, or pass a Viewer from useCreateViewer()",
    );
  }
  return contextValue instanceof ViewerController ? contextValue : contextValue.get();
}

interface KeyedSliceState<T, S> {
  readonly store: ReadableStore<T>;
  readonly keys: readonly PropertyKey[];
  readonly subscribe: (onStoreChange: () => void) => () => void;
  dirty: boolean;
  passiveActive: boolean;
  layoutUnsub: (() => void) | null;
  shown: S | undefined;
  hasShown: boolean;
  client: SelectedCache<T, S> | null;
  server: SelectedCache<T, S> | null;
}

/** Read a derived slice of `store`, waking React only when one of `keys` changed. */
export function useStoreKeys<T, S>(
  store: ReadableStore<T>,
  keys: readonly PropertyKey[],
  selector: (state: T) => S,
): S {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const ref = useRef<KeyedSliceState<T, S> | null>(null);
  const ensure = (): KeyedSliceState<T, S> => {
    let state = ref.current;
    if (!state || state.store !== store || state.keys !== keys) {
      state?.layoutUnsub?.();
      const created: KeyedSliceState<T, S> = {
        store,
        keys,
        subscribe: (onStoreChange) => {
          created.passiveActive = true;
          created.layoutUnsub?.();
          created.layoutUnsub = null;
          const unsubscribe = subscribeKeys(store, keys, () => {
            created.dirty = true;
            onStoreChange();
          });
          return () => {
            created.passiveActive = false;
            unsubscribe();
          };
        },
        dirty: false,
        passiveActive: false,
        layoutUnsub: null,
        shown: undefined,
        hasShown: false,
        client: null,
        server: null,
      };
      state = created;
      ref.current = state;
    }
    return state;
  };
  const sliceState = ensure();
  const snapshot = useSyncExternalStore(
    sliceState.subscribe,
    () => {
      const state = ensure();
      const dirty = state.dirty;
      state.dirty = false;
      state.client = selectCached(state.client, store.get(), selector, dirty);
      state.shown = state.client.value;
      state.hasShown = true;
      return state.client.value;
    },
    () => {
      const state = ensure();
      state.server = selectCached(state.server, store.get(), selector);
      state.shown = state.server.value;
      state.hasShown = true;
      return state.server.value;
    },
  );
  // Bridge the gap before React 19's passive `useSyncExternalStore` subscription
  // mounts (and on `<Activity>` reconnect) so layout-phase store updates flush
  // into the same pre-paint commit.
  useLayoutEffect(() => {
    if (sliceState.passiveActive) return;
    const check = () => {
      if (sliceState.passiveActive || !sliceState.hasShown) return;
      const next = selectCached(
        sliceState.client,
        sliceState.store.get(),
        selectorRef.current,
        sliceState.dirty,
      );
      if (!Object.is(sliceState.shown, next.value)) {
        rerender();
      } else {
        sliceState.dirty = false;
        sliceState.client = next;
      }
    };
    sliceState.layoutUnsub?.();
    sliceState.layoutUnsub = subscribeKeys(sliceState.store, sliceState.keys, () => {
      sliceState.dirty = true;
      check();
    });
    check();
    return () => {
      sliceState.layoutUnsub?.();
      sliceState.layoutUnsub = null;
    };
  }, [sliceState]);
  return snapshot;
}

/**
 * Subscribe in `useLayoutEffect` so synchronous layout-phase producers (warm
 * session opening, declarative overlays) flush into the same commit before paint.
 */
export function useLayoutSnapshot<S>(
  subscribe: ((onStoreChange: () => void) => () => void) | null,
  getSnapshot: () => S,
  getServerSnapshot: () => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const snapshot =
    typeof window === "undefined" || !subscribe ? getServerSnapshot() : getSnapshot();
  const shownRef = useRef<S>(snapshot);
  shownRef.current = snapshot;
  useLayoutEffect(() => {
    if (!subscribe) return;
    const check = () => {
      if (!isEqual(shownRef.current, getSnapshot())) rerender();
    };
    const unsubscribe = subscribe(check);
    check();
    return unsubscribe;
  }, [subscribe, getSnapshot, isEqual]);
  return snapshot;
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
  passiveActive: boolean;
  layoutUnsub: (() => void) | null;
  shownSelected: S | undefined;
  hasShownSelected: boolean;
  shownTracked: TrackedSnapshot<T> | null;
  trackedClient: TrackedSnapshot<T> | null;
  trackedServer: TrackedSnapshot<T> | null;
  selectedClient: SelectedCache<T, S> | null;
  selectedServer: SelectedCache<T, S> | null;
}

const TRACKED_PROXY_HANDLER: ProxyHandler<TrackedSnapshot<object>> = {
  get(target, property) {
    target.tracked.add(property);
    return Reflect.get(target.raw, property, target.raw);
  },
  has(target, property) {
    target.tracked.add(property);
    return Reflect.has(target.raw, property);
  },
  ownKeys(target) {
    const keys = Reflect.ownKeys(target.raw);
    for (const key of keys) target.tracked.add(key);
    return keys;
  },
  getOwnPropertyDescriptor(target, property) {
    target.tracked.add(property);
    const descriptor = Reflect.getOwnPropertyDescriptor(target.raw, property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  getPrototypeOf(target) {
    return Reflect.getPrototypeOf(target.raw);
  },
};

export function createTrackedSnapshot<T extends object>(
  raw: T,
  fallback: ReadonlySet<PropertyKey> | null = null,
): TrackedSnapshot<T> {
  const snapshot: TrackedSnapshot<T> = {
    raw,
    proxy: undefined as unknown as T,
    tracked: new Set<PropertyKey>(),
    fallback,
  };
  (snapshot as { proxy: T }).proxy = new Proxy(
    snapshot as unknown as TrackedSnapshot<object>,
    TRACKED_PROXY_HANDLER,
  ) as unknown as T;
  return snapshot;
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
  force = false,
): SelectedCache<T, S> {
  if (!force && previous && Object.is(previous.raw, raw) && previous.selector === selector) {
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
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const ref = useRef<SliceState<T, S> | null>(null);
  const ensure = (): SliceState<T, S> => {
    let state = ref.current;
    if (!state || state.store !== store) {
      state?.layoutUnsub?.();
      const created: SliceState<T, S> = {
        store,
        subscribe: (onStoreChange) => {
          created.passiveActive = true;
          created.layoutUnsub?.();
          created.layoutUnsub = null;
          const unsubscribe = store.subscribe((changedKeys) => {
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
          });
          return () => {
            created.passiveActive = false;
            unsubscribe();
          };
        },
        hasSelector: Boolean(selector),
        pendingNotify: false,
        passiveActive: false,
        layoutUnsub: null,
        shownSelected: undefined,
        hasShownSelected: false,
        shownTracked: null,
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
  const snapshot = useSyncExternalStore(
    sliceState.subscribe,
    () => {
      const state = ensure();
      state.pendingNotify = false;
      const raw = store.get();
      if (selector) {
        state.selectedClient = selectCached(state.selectedClient, raw, selector);
        state.shownSelected = state.selectedClient.value;
        state.hasShownSelected = true;
        state.shownTracked = null;
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
      state.shownTracked = state.trackedClient;
      state.hasShownSelected = false;
      return state.trackedClient.proxy;
    },
    () => {
      const state = ensure();
      const raw = serverState();
      if (selector) {
        state.selectedServer = selectCached(state.selectedServer, raw, selector);
        state.shownSelected = state.selectedServer.value;
        state.hasShownSelected = true;
        state.shownTracked = null;
        return state.selectedServer.value;
      }
      if (!state.trackedServer || !Object.is(state.trackedServer.raw, raw)) {
        state.trackedServer = createTrackedSnapshot(
          raw,
          state.trackedServer ? activeTracked(state.trackedServer) : null,
        );
      }
      state.shownTracked = state.trackedServer;
      state.hasShownSelected = false;
      return state.trackedServer.proxy;
    },
  );
  useLayoutEffect(() => {
    if (sliceState.passiveActive) return;
    const check = (changedKeys?: ReadonlySet<PropertyKey>) => {
      if (sliceState.passiveActive) return;
      const raw = sliceState.store.get();
      const currentSelector = selectorRef.current;
      if (currentSelector) {
        if (!sliceState.hasShownSelected) return;
        if (sliceState.selectedClient && Object.is(sliceState.selectedClient.raw, raw)) return;
        const next = selectCached(sliceState.selectedClient, raw, currentSelector);
        if (!Object.is(sliceState.shownSelected, next.value)) {
          rerender();
        } else {
          sliceState.selectedClient = next;
        }
        return;
      }
      const shown = sliceState.shownTracked;
      if (!shown || Object.is(shown.raw, raw)) return;
      const tracked = activeTracked(shown);
      if (changedKeys && tracked) {
        let hit = false;
        for (const key of changedKeys) {
          if (tracked.has(key)) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          if (shown === sliceState.trackedClient) shown.raw = raw;
          return;
        }
      }
      if (hasTrackedChange(shown.raw, raw, tracked)) {
        rerender();
      } else if (shown === sliceState.trackedClient) {
        shown.raw = raw;
      }
    };
    sliceState.layoutUnsub?.();
    sliceState.layoutUnsub = sliceState.store.subscribe(check);
    check();
    return () => {
      sliceState.layoutUnsub?.();
      sliceState.layoutUnsub = null;
    };
  }, [sliceState]);
  return snapshot;
}

/**
 * The session of the nearest `<PdfDocument>`: its document state snapshot,
 * the answer to its password request, pdf.js's document, and its signal.
 */
export function useSession(): PdfSession {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  return session;
}

/** `session` when given, otherwise the session of the nearest `<PdfDocument>`. */
export function useOptionalSession(session?: PdfSession): PdfSessionController {
  if (session) return sessionControllerOf(session);
  const contextSession = use(SessionContext);
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
const getOpeningState = (): DocumentState => OPENING;

export function useSessionData(hook: string): PdfSessionController {
  const session = use(SessionContext);
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
export function useDocumentState<T>(selector: (state: DocumentState) => T): T;
export function useDocumentState(): DocumentState;
export function useDocumentState<T>(selector?: (state: DocumentState) => T): DocumentState | T {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  // The server opened no document. A later root may hydrate after another
  // root already opened the same source; its first snapshot must match the HTML.
  return useStoreSlice(session.stateStore, getOpeningState, selector);
}

/**
 * The view state of `viewer`, or of the nearest `<PdfView>` or
 * `<PdfDocument>`: its layout, page count, mounted window, current page,
 * zoom, rotation, spread, scroll mode, direction, and tool. Called without a
 * selector, it tracks the fields read during rendering and renders again only
 * when one of them changes; called with `selector`, it compares the selected
 * value shallowly.
 */
export function useViewState<T>(selector: (state: ViewerState) => T, viewer?: Viewer): T;
export function useViewState(viewer?: Viewer): ViewerState;
export function useViewState<T>(
  selectorOrViewer?: ((state: ViewerState) => T) | Viewer,
  maybeViewer?: Viewer,
): ViewerState | T {
  const isSelector = typeof selectorOrViewer === "function";
  const viewer = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(viewer.store, viewer.store.get, selector);
}
