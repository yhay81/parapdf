"use client";

import { type ReactNode, type Ref, useImperativeHandle, useLayoutEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { controllerOf, type Viewer, ViewerController } from "../view/viewer.ts";
import { LazyViewerHolder, useOptionalViewer, ViewerContext } from "./context.ts";

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
  const [holder] = useState(() => new LazyViewerHolder());
  const contextViewer: ViewerController | LazyViewerHolder = externalViewer
    ? controllerOf(externalViewer)
    : holder;
  useLayoutEffect(() => (externalViewer ? undefined : holder.connect()), [externalViewer, holder]);
  useImperativeHandle(ref, () => (externalViewer ? controllerOf(externalViewer) : holder.get()), [
    externalViewer,
    holder,
  ]);
  return jsx(ViewerContext, { value: contextViewer, children });
}

/**
 * The `Viewer` of the nearest `<PdfView>` or `<PdfDocument>`: one viewport's
 * controller and state. Use `useCreateViewer()` when a component above
 * `<PdfDocument>` or outside a `<PdfView>` needs to own and control a viewer.
 */
export function useViewer(): Viewer {
  return useOptionalViewer();
}

/**
 * Create a `Viewer` for the life of the calling component, to pass to
 * `<PdfDocument viewer={...}>`, `<PdfView viewer={...}>`, or
 * `<PdfViewer viewer={...}>` when a component outside those scopes acts
 * through it. It keeps its view and edits while its viewport unmounts and
 * while React hides the calling component (`<Activity>`), and goes when the
 * calling component unmounts.
 */
export function useCreateViewer(): Viewer {
  const [viewer] = useState(() => new ViewerController());
  // React cleans up alike for a component it hides and for one it removes,
  // and says nothing more of one it removes while hidden: the viewer lets go
  // of the document, and what it keeps goes with the component's state.
  useLayoutEffect(() => viewer.hold(), [viewer]);
  return viewer;
}
