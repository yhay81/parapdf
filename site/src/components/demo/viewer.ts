import type { Viewer } from "parapdf";
import { createContext, use } from "react";

/** The demo's one viewer, which its toolbars and panels act through. */
export const ViewerContext = createContext<Viewer | null>(null);

export function useDemoViewer(): Viewer {
  const viewer = use(ViewerContext);
  if (!viewer) throw new Error("useDemoViewer must be used inside the demo");
  return viewer;
}
