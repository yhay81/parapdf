"use client";

import { type AnnotationControls, annotationSlot } from "../features/annotation-slot.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { AnnotationControls } from "../features/annotation-slot.ts";

/**
 * The annotations the reader creates in `viewer`, or in the viewer of the
 * nearest `<PdfView>` or `<PdfDocument>`, and their tools. Always returns an
 * `AnnotationControls` object (whose `state` and `styles` are null until
 * `<PdfAnnotationEditor>` starts editing an open document). Called without a
 * selector, it tracks which fields the component reads so components reading
 * only methods never re-render on annotation changes; called with `selector`,
 * it compares the selected value shallowly.
 */
export function useAnnotations<T>(selector: (state: AnnotationControls) => T, viewer?: Viewer): T;
export function useAnnotations(viewer?: Viewer): AnnotationControls;
export function useAnnotations<T>(
  selectorOrViewer?: ((state: AnnotationControls) => T) | Viewer,
  maybeViewer?: Viewer,
): AnnotationControls | T {
  const isSelector = typeof selectorOrViewer === "function";
  const slot = annotationSlot(useOptionalViewer(isSelector ? maybeViewer : selectorOrViewer));
  const selector = isSelector ? selectorOrViewer : undefined;
  return useStoreSlice(slot.store, () => slot.initialControls, selector);
}
