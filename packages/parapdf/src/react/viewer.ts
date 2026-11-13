"use client";

import { useEffect, useState } from "react";
import { type Viewer, ViewerController } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

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
  useEffect(() => viewer.hold(), [viewer]);
  return viewer;
}
