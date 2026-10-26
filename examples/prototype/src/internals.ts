/**
 * The runtime's own modules that scripts/check-options.ts drives with a
 * pdf.js of its own: not part of the package's surface, which opens
 * sessions only through `<PdfDocument>`.
 */
import { connectSession, PdfSession } from "../../../packages/parapdf/src/document/pdf-session.ts";
import type { PdfjsLoader } from "../../../packages/parapdf/src/document/registry.ts";
import type { PdfSource } from "../../../packages/parapdf/src/document/session.ts";
import {
  attachViewport,
  openViewer,
  type Viewer,
} from "../../../packages/parapdf/src/view/viewer.ts";

export { attachViewport };

/** Show `source`, opened with `pdfjs`, in `viewer`; returns what closes it. */
export function showWith(viewer: Viewer, source: PdfSource, pdfjs: PdfjsLoader): () => void {
  const session = new PdfSession(source);
  const close = connectSession(session, pdfjs);
  openViewer(viewer, session);
  return close;
}
