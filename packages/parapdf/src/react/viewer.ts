"use client";

import { useEffect, useState } from "react";
import { holdViewer, Viewer } from "../view/viewer.ts";

/**
 * A viewer, one viewport's controller and state, for the life of the
 * calling component: give it to a `<PdfViewer>` to show that viewer's
 * document, and to the hooks and functions that act through it. It keeps
 * its view and edits while its `<PdfViewer>` unmounts, and while React
 * hides the calling component (`<Activity>`): shown again, it shows the
 * document where the reader left it. Once the component is gone, so is
 * the viewer.
 */
export function useViewer(): Viewer {
  const [viewer] = useState(() => new Viewer());
  // React cleans up alike for a component it hides and for one it removes,
  // and says nothing more of one it removes while hidden: the viewer lets go
  // of the document, and what it keeps goes with the component's state.
  useEffect(() => holdViewer(viewer), [viewer]);
  return viewer;
}
