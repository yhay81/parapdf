"use client";

import { type ReactNode, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { holdViewer, Viewer } from "../view/viewer.ts";
import { ViewerContext } from "./context.ts";

export interface PdfViewProps {
  /**
   * The viewer this scope gives its children through `useViewer()`, from
   * `useCreateViewer()`; without it, `<PdfView>` creates one of its own.
   */
  viewer?: Viewer;
  /** Receives this scope's `Viewer` while mounted. */
  ref?: Ref<Viewer>;
  children?: ReactNode;
}

/**
 * An independent `Viewer` scope inside `<PdfDocument>`, for split views or
 * secondary panes whose `<PdfViewer>`, toolbar, and hooks share a viewer
 * apart from sibling views of the same document.
 */
export function PdfView({ viewer: externalViewer, ref, children }: PdfViewProps) {
  const [ownViewer, setOwnViewer] = useState<Viewer | null>(() =>
    externalViewer ? null : new Viewer(),
  );
  let activeViewer = externalViewer ?? ownViewer;
  if (!activeViewer) {
    activeViewer = new Viewer();
    setOwnViewer(activeViewer);
  }
  useEffect(
    () => (externalViewer || !ownViewer ? undefined : holdViewer(ownViewer)),
    [externalViewer, ownViewer],
  );
  useImperativeHandle(ref, () => activeViewer, [activeViewer]);
  return <ViewerContext value={activeViewer}>{children}</ViewerContext>;
}
