"use client";

import { createContext, use, useContext, useRef, useSyncExternalStore } from "react";
import { browser } from "react-dom";
import { type PdfSession, readsOf } from "../document/pdf-session.ts";
import { type DocumentState, OPENING } from "../document/registry.ts";
import type { ReadableStore } from "../document/store.ts";
import type { ViewerState } from "../view/state.ts";
import type { Viewer } from "../view/viewer.ts";

export const SessionContext = createContext<PdfSession | null>(null);

/** The viewer of the nearest `<PdfView>` or `<PdfDocument>`. */
export const ViewerContext = createContext<Viewer | null>(null);

/** The viewer of the `<PdfViewer>` and the page an overlay is rendered in. */
export const PageContext = createContext<{ viewer: Viewer; pageIndex: number } | null>(null);

/**
 * `viewer` when given, otherwise the viewer of the nearest `<PdfView>` or
 * `<PdfDocument>`.
 */
export function useOptionalViewer(viewer?: Viewer): Viewer {
  const contextViewer = useContext(ViewerContext);
  const resolved = viewer ?? contextViewer;
  if (!resolved) {
    throw new Error(
      "useViewer must be used inside <PdfDocument> or <PdfView>, or pass a Viewer from useCreateViewer()",
    );
  }
  return resolved;
}

/** One slice of a store; the component renders again only when it changes. */
export function useSelected<T, S>(store: ReadableStore<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/** A store's whole state, re-rendering on every change. */
export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
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

function useStoreSlice<T extends object, S>(
  store: ReadableStore<T>,
  serverState: () => T,
  selector: ((state: T) => S) | undefined,
): T | S {
  const ref = useRef<SliceState<T, S> | null>(null);
  const ensure = (): SliceState<T, S> => {
    let state = ref.current;
    if (!state || state.store !== store) {
      state = {
        store,
        trackedClient: null,
        trackedServer: null,
        selectedClient: null,
        selectedServer: null,
      };
      ref.current = state;
    }
    return state;
  };
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const state = ensure();
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
 * The session of the nearest `<PdfDocument>`: its document state, the
 * answer to its password request, pdf.js's document, and its secondary data.
 */
export function useSession(): PdfSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  return session;
}

/**
 * The session, for a hook that reads the document's secondary data. The
 * server opens no document, so `browser()` throws there instead of the hook
 * suspending on a read that never settles: the nearest Suspense boundary
 * renders its fallback, and React renders the hook's component in the
 * browser without reporting an error.
 */
export function useSessionData(hook: string): PdfSession {
  const session = useSession();
  use(browser(() => `${hook} reads the document, which only the browser opens`));
  // What settled empty while the document waited for a password is read
  // anew once it is answered, and so is everything once the provider holds
  // the document opened again: render again to read it.
  useSelected(session.state, () => readsOf(session));
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
  const { state } = useSession();
  // The server opened no document. A later root may hydrate after another
  // root already opened the same source; its first snapshot must match the HTML.
  return useStoreSlice(state, () => OPENING, selector);
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
