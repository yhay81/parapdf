"use client";

import { useLayoutEffect } from "react";
import { enforcePermissions } from "../features/permissions.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

export interface PdfPermissionsProps {
  /**
   * The viewer whose document permissions are enforced; without it,
   * `<PdfPermissions>` uses `useViewer()`.
   */
  viewer?: Viewer;
}

/**
 * Follow what the document permits in the viewer (off by default, as in
 * pdf.js): without permission to copy, its text cannot be selected or copied,
 * though it stays readable by assistive technology and `getText()`; without
 * permission to print, `print()` fails; without permission to annotate,
 * annotations cannot be created, and form fields can be filled in only with
 * permission to fill forms. `useDocumentState()` always reports permissions.
 */
export function PdfPermissions({ viewer: externalViewer }: PdfPermissionsProps): null {
  const viewer = useOptionalViewer(externalViewer);
  useLayoutEffect(() => enforcePermissions(viewer), [viewer]);
  return null;
}
