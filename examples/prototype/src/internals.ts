/**
 * The runtime's own internal modules that the Playwright checks inspect or
 * drive directly (`window.__search`, `window.__history`,
 * `window.__annotations`, `getSelection`, `showWith`, `attachViewport`): not
 * part of the package's public surface, which is React-first.
 */
import {
  type PdfSession,
  PdfSessionController,
} from "../../../packages/parapdf/src/document/pdf-session.ts";
import type { PdfjsLoader } from "../../../packages/parapdf/src/document/registry.ts";
import type { PdfSource } from "../../../packages/parapdf/src/document/session.ts";
import type { ReadableStore } from "../../../packages/parapdf/src/document/store.ts";
import { annotationSlot } from "../../../packages/parapdf/src/features/annotation-slot.ts";
import type { AnnotationEditing } from "../../../packages/parapdf/src/features/annotations.ts";
import {
  type DownloadOptions,
  download,
  type SaveOptions,
  save,
} from "../../../packages/parapdf/src/features/download.ts";
import { type HistoryControls, historyOf } from "../../../packages/parapdf/src/features/history.ts";
import { type PrintOptions, print } from "../../../packages/parapdf/src/features/print/index.ts";
import {
  type SearchControls,
  searchOf,
} from "../../../packages/parapdf/src/features/search/index.ts";
import { getSelection } from "../../../packages/parapdf/src/features/selection.ts";
import {
  controllerOf,
  type Viewer,
  type ViewerController,
} from "../../../packages/parapdf/src/view/viewer.ts";

export type HistoryStore = ReadableStore<HistoryControls>;
export type SearchStore = ReadableStore<SearchControls>;

export {
  type AnnotationEditing,
  controllerOf,
  type DownloadOptions,
  download,
  getSelection,
  historyOf,
  type PdfSession,
  type PrintOptions,
  print,
  type SaveOptions,
  save,
  searchOf,
  type Viewer,
  type ViewerController,
};

/** Current `AnnotationEditing` instance attached to `viewer`, or null when unmounted. */
export function annotationEditingOf(viewer: ViewerController): AnnotationEditing | null {
  return annotationSlot(viewer).editing;
}

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
  const session = new PdfSessionController(source, { pdfjs });
  const close = session.connect();
  viewer.open(session);
  return close;
}
