"use client";

import { type AnnotationControls, annotationSlot } from "../features/annotation-slot.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { AnnotationControls } from "../features/annotation-slot.ts";

/**
 * The annotations the reader creates in `viewer`, or in the viewer of the
 * nearest `<PdfView>` or `<PdfDocument>`, and their tools. Always returns an
 * `AnnotationControls` object (whose `state` and `styles` are null until
 * `<PdfAnnotationEditor>` starts editing an open document) and tracks which
 * fields the component reads so components reading only methods never
 * re-render on annotation changes.
 */
export function useAnnotations(viewer?: Viewer): AnnotationControls {
  const slot = annotationSlot(useOptionalViewer(viewer));
  return useStoreSlice(slot.store, () => slot.initialControls);
}
