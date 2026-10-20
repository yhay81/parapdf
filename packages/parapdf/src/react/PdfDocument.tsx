"use client";

import { type ReactNode, useEffect, useState } from "react";
import { preload } from "react-dom";
import { documentRequestMode, pdfjsEngine, preloadPdfjs } from "../engine/bundled.ts";
import type { PdfSource } from "../engine/types.ts";
import { sourceKey } from "../runtime/documents.ts";
import { PdfViewerRuntime, type ViewerOptions } from "../runtime/viewer.ts";
import { RuntimeContext } from "./context.ts";

export interface PdfDocumentProps {
  /**
   * The document to show: its URL, `{ url }`, or `{ data }` with its bytes.
   * It reopens when its URL changes or, for data, when the bytes are another
   * object; a new object for the same URL keeps the open document.
   */
  source: string | PdfSource;
  /** Read once, when the component mounts; give it a new `key` to change them. */
  options?: ViewerOptions;
  children?: ReactNode;
}

/** Opens `source` and provides the viewer to its children. */
export function PdfDocument({ source, options, children }: PdfDocumentProps) {
  // The runtime lives as long as the component; the options apply at creation.
  const [runtime] = useState(() => new PdfViewerRuntime(pdfjsEngine, options));
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  if ("url" in resolved) {
    // The download starts now, and with server rendering as soon as the
    // browser reads the page's head, not once pdf.js has loaded: pdf.js's
    // request has this CORS mode and takes the preloaded response.
    const mode = documentRequestMode();
    if (mode) preload(resolved.url, { as: "fetch", crossOrigin: mode });
  }
  // pdf.js and its worker load while React renders and commits.
  preloadPdfjs();
  // One effect owns the document. StrictMode's mount-unmount-mount cycle and
  // quick remounts reuse the loaded document instead of loading it again.
  const key = sourceKey(resolved);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the source, so an inline `{ url }` does not reopen the document at every render.
  useEffect(() => runtime.open(resolved), [runtime, key]);
  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}
