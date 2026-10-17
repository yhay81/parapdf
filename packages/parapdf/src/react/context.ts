import { createContext, useContext, useSyncExternalStore } from "react";
import type { PdfViewerRuntime, ViewerState } from "../runtime/viewer.ts";

export const RuntimeContext = createContext<PdfViewerRuntime | null>(null);

/** The viewer runtime of the nearest `<PdfDocument>`. */
export function usePdfViewer(): PdfViewerRuntime {
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
