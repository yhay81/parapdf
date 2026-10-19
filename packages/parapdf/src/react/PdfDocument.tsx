"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { PdfEngine, PdfSource } from "../engine/types.ts";
import { sourceKey } from "../runtime/documents.ts";
import { PdfViewerRuntime, type ViewerOptions } from "../runtime/viewer.ts";
import { RuntimeContext } from "./context.ts";

export interface PdfDocumentProps {
  /** The engine that opens the document; read once, when the component mounts. */
  engine: PdfEngine;
  /**
   * The document to show. It reopens when its URL changes or, for data, when
   * the bytes are another object; a new object for the same URL keeps the
   * open document.
   */
  source: PdfSource;
  /** Read once, when the component mounts; give it a new `key` to change them. */
  options?: ViewerOptions;
  children?: ReactNode;
}

/** Opens `source` with `engine` and provides the viewer to its children. */
export function PdfDocument({ engine, source, options, children }: PdfDocumentProps) {
  // The runtime lives as long as the component; the engine and options apply at creation.
  const [runtime] = useState(() => new PdfViewerRuntime(engine, options));
  // One effect owns the document. StrictMode's mount-unmount-mount cycle and
  // quick remounts reuse the loaded document instead of loading it again.
  const key = sourceKey(source);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the source, so an inline `{ url }` does not reopen the document at every render.
  useEffect(() => runtime.open(source), [runtime, key]);
  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}
