"use client";

import { useLayoutEffect } from "react";
import { attachAutoLinks } from "../features/auto-links.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

export interface PdfAutoLinksProps {
  /**
   * The viewer whose pages' text URLs and e-mail addresses become links;
   * without it, `<PdfAutoLinks>` uses `useViewer()`.
   */
  viewer?: Viewer;
}

/**
 * Turn the URLs and e-mail addresses in the viewer's pages' text into links of
 * their annotation layers, as pdf.js's viewer does, leaving out those the file
 * already links. Needs `textLayer` and `annotationLayer` on `<PdfViewer>`, and
 * follows its `externalLinks` policy.
 */
export function PdfAutoLinks({ viewer: externalViewer }: PdfAutoLinksProps): null {
  const viewer = useOptionalViewer(externalViewer);
  useLayoutEffect(() => attachAutoLinks(viewer), [viewer]);
  return null;
}
