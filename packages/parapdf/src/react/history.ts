"use client";

import type { ReadableStore } from "../document/store.ts";
import { type History, historyOf } from "../features/history.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export interface HistoryControls {
  canGoBack: boolean;
  back(): void;
  canGoForward: boolean;
  forward(): void;
}

const slots = new WeakMap<History, ReadableStore<HistoryControls>>();

export function historyControlsStore(history: History): ReadableStore<HistoryControls> {
  let store = slots.get(history);
  if (store) return store;
  const methods = {
    back: () => history.back(),
    forward: () => history.forward(),
  };
  let raw = history.store.get();
  let current: HistoryControls = { ...raw, ...methods };
  store = {
    get() {
      const next = history.store.get();
      if (!Object.is(next, raw)) {
        raw = next;
        current = { ...next, ...methods };
      }
      return current;
    },
    subscribe: history.store.subscribe,
  };
  slots.set(history, store);
  return store;
}

/**
 * Back and forward stacks for link and outline jumps in `viewer`, or in the
 * viewer of the nearest `<PdfView>` or `<PdfDocument>`, with referentially
 * stable actions. Called without a selector, it tracks the fields read during
 * rendering; called with `selector`, it compares the selected value shallowly.
 */
export function useHistory(viewer?: Viewer): HistoryControls;
export function useHistory<T>(selector: (state: HistoryControls) => T, viewer?: Viewer): T;
export function useHistory<T>(
  selectorOrViewer?: ((state: HistoryControls) => T) | Viewer,
  maybeViewer?: Viewer,
): HistoryControls | T {
  const isSelector = typeof selectorOrViewer === "function";
  const resolved = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const store = historyControlsStore(historyOf(resolved));
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(store, store.get, selector);
}
