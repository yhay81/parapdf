import { type ReactNode, useEffect, useState } from "react";
import type { PdfEngine, PdfSource } from "../engine/types.ts";
import { PdfViewerRuntime, type ViewerOptions } from "../runtime/viewer.ts";
import { RuntimeContext } from "./context.ts";

export interface PdfDocumentProps {
  engine: PdfEngine;
  /** Keep the object stable (memoize it); a new object reopens the document. */
  source: PdfSource;
  options?: ViewerOptions;
  children?: ReactNode;
}

/** Opens `source` with `engine` and provides the viewer to its children. */
export function PdfDocument({ engine, source, options, children }: PdfDocumentProps) {
  // The runtime lives as long as the component; options apply at creation.
  const [runtime] = useState(() => new PdfViewerRuntime(engine, options));
  // One effect owns the document, so StrictMode's mount-unmount-mount cycle
  // closes the first load instead of leaking it.
  useEffect(() => runtime.open(source), [runtime, source]);
  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}
