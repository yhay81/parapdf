"use client";

import { useLayoutEffect } from "react";
import { type PrintControls, printOf } from "../features/print/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { PrintControls, PrintProgress } from "../features/print/index.ts";

/**
 * Print the document of `viewer`, or of the nearest `<PdfView>` or
 * `<PdfDocument>`, with reactive `printing` and `progress` state and a
 * `cancel()` action shared across every `usePrint()` consumer of that viewer.
 * Called without a selector, it tracks the fields read during rendering so
 * components reading only `print` or `cancel` never re-render on progress;
 * called with `selector`, it compares the selected value shallowly.
 */
export function usePrint<T>(selector: (state: PrintControls) => T, viewer?: Viewer): T;
export function usePrint(viewer?: Viewer): PrintControls;
export function usePrint<T>(
  selectorOrViewer?: ((state: PrintControls) => T) | Viewer,
  maybeViewer?: Viewer,
): PrintControls | T {
  const isSelector = typeof selectorOrViewer === "function";
  const resolved = useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer);
  const slot = printOf(resolved);
  useLayoutEffect(() => slot.hold(), [slot]);
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(slot.store, () => slot.initialControls, selector);
}
