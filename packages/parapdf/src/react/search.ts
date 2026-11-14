"use client";

import { type SearchControls, searchOf } from "../features/search/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { SearchControls } from "../features/search/index.ts";

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
  const { store } = searchOf(resolved);
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(store, store.get, selector);
}
