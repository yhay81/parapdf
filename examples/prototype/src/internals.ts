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
import { controllerOf, type ViewerController } from "../../../packages/parapdf/src/view/viewer.ts";

export {
  type AnnotationEditing,
  controllerOf,
  getSelection,
  type History,
  historyOf,
  type Search,
  searchOf,
  useAnnotationEditing,
  type ViewerController,
};

/** Bind `viewer` to `scroller` and `content`, for `check-options.ts`. */
export function attachViewport(
  viewer: ViewerController,
  scroller: HTMLElement,
  content: HTMLElement,
): () => void {
  return viewer.attachViewport(scroller, content);
}

/** Show `source`, opened with `pdfjs`, in `viewer`; returns what closes it. */
export function showWith(
  viewer: ViewerController,
  source: PdfSource,
  pdfjs: PdfjsLoader,
): () => void {
  const session = new PdfSession(source, { pdfjs });
  const close = connectSession(session);
  viewer.open(session);
  return close;
}
