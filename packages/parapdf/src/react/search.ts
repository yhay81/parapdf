"use client";

import type { ReadableStore } from "../document/store.ts";
import { type Search, type SearchState, searchOf } from "../features/search/index.ts";
import type { SearchOptions } from "../features/search/text-search.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export interface SearchControls extends SearchState {
  search(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
}

const slots = new WeakMap<Search, ReadableStore<SearchControls>>();

export function searchControlsStore(search: Search): ReadableStore<SearchControls> {
  let store = slots.get(search);
  if (store) return store;
  const methods = {
    search: (query: string, options?: SearchOptions) => search.search(query, options),
    next: () => search.next(),
    previous: () => search.previous(),
    clear: () => search.clear(),
  };
  let raw = search.store.get();
  let current: SearchControls = { ...raw, ...methods };
  store = {
    get() {
      const next = search.store.get();
      if (!Object.is(next, raw)) {
        raw = next;
        current = { ...next, ...methods };
      }
      return current;
    },
    subscribe: search.store.subscribe,
  };
  slots.set(search, store);
  return store;
}

/**
 * Whole-document search in `viewer`, or in the viewer of the nearest
 * `<PdfView>` or `<PdfDocument>`, with progressive results, match navigation,
 * and referentially stable actions. Called without a selector, it tracks the
 * fields read during rendering so components reading only actions never
 * re-render on match updates; called with `selector`, it compares the
 * selected value shallowly.
 */
export function useSearch(viewer?: Viewer): SearchControls;
export function useSearch<T>(selector: (state: SearchControls) => T, viewer?: Viewer): T;
export function useSearch<T>(
  selectorOrViewer?: ((state: SearchControls) => T) | Viewer,
  maybeViewer?: Viewer,
): SearchControls | T {
  const isSelector = typeof selectorOrViewer === "function";
  const resolved = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const store = searchControlsStore(searchOf(resolved));
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(store, store.get, selector);
}
