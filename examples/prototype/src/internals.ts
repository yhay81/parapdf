/**
 * The runtime's own internal modules that the Playwright checks inspect or
 * drive directly (`window.__search`, `window.__history`,
 * `window.__annotations`, `getSelection`, `showWith`, `attachViewport`): not
 * part of the package's public surface, which is React-first.
 */
import { connectSession, PdfSession } from "../../../packages/parapdf/src/document/pdf-session.ts";
import type { PdfjsLoader } from "../../../packages/parapdf/src/document/registry.ts";
import type { PdfSource } from "../../../packages/parapdf/src/document/session.ts";
import type { AnnotationEditing } from "../../../packages/parapdf/src/features/annotations.ts";
import { type History, historyOf } from "../../../packages/parapdf/src/features/history.ts";
import { type Search, searchOf } from "../../../packages/parapdf/src/features/search/index.ts";
import { getSelection } from "../../../packages/parapdf/src/features/selection.ts";
import { useAnnotationEditing } from "../../../packages/parapdf/src/react/annotations.ts";
import {
  attachViewport,
  openViewer,
  type Viewer,
} from "../../../packages/parapdf/src/view/viewer.ts";

export {
  type AnnotationEditing,
  attachViewport,
  getSelection,
  type History,
  historyOf,
  type Search,
  searchOf,
  useAnnotationEditing,
};

/** Show `source`, opened with `pdfjs`, in `viewer`; returns what closes it. */
export function showWith(viewer: Viewer, source: PdfSource, pdfjs: PdfjsLoader): () => void {
  const session = new PdfSession(source, { pdfjs });
  const close = connectSession(session);
  openViewer(viewer, session);
  return close;
}
