"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { HotViewState } from "../view/state.ts";
import type { Viewer, ViewerState } from "../view/viewer.ts";

export const RuntimeContext = createContext<Viewer | null>(null);

/** The viewer runtime of the nearest `<PdfDocument>`. */
export function usePdfViewer(): Viewer {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("usePdfViewer must be used inside <PdfDocument>");
  return runtime;
}

/**
 * Subscribe to one slice of the viewer state. The selector must return a
 * primitive or an existing reference so equal states compare equal; the
 * component then re-renders only when that slice changes.
 */
export function usePdfState<T>(selector: (state: ViewerState) => T): T {
  const runtime = usePdfViewer();
  return useSyncExternalStore(
    runtime.store.subscribe,
    () => selector(runtime.store.get()),
    () => selector(runtime.store.get()),
  );
}

/**
 * pdf.js's own document, null until it loads: an escape hatch to pdf.js's
 * APIs that ParaPDF does not wrap, such as metadata or attachments.
 */
export function usePdfDocument(): PDFDocumentProxy | null {
  return usePdfState((state) => state.document?.proxy ?? null);
}

/** Internal view subscription; document and feature updates do not reach it. */
export function usePdfHotState<T>(selector: (state: HotViewState) => T): T {
  const { hot } = usePdfViewer().store;
  return useSyncExternalStore(
    hot.subscribe,
    () => selector(hot.get()),
    () => selector(hot.get()),
  );
}
