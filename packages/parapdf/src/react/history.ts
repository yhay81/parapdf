"use client";

import { type HistoryControls, historyOf } from "../features/history.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { HistoryControls } from "../features/history.ts";

/**
 * Back and forward stacks for link and outline jumps in `viewer`, or in the
 * viewer of the nearest `<PdfView>` or `<PdfDocument>`, with referentially
 * stable actions. Called without a selector, it tracks the fields read during
 * rendering; called with `selector`, it compares the selected value shallowly.
 */
export function useHistory<T>(selector: (state: HistoryControls) => T, viewer?: Viewer): T;
export function useHistory(viewer?: Viewer): HistoryControls;
export function useHistory<T>(
  selectorOrViewer?: ((state: HistoryControls) => T) | Viewer,
  maybeViewer?: Viewer,
): HistoryControls | T {
  const isSelector = typeof selectorOrViewer === "function";
  const resolved = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const store = historyOf(resolved);
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(store, store.get, selector);
}
