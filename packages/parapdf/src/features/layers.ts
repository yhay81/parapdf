import { type PdfSession, sessionControllerOf } from "../document/pdf-session.ts";

/**
 * Show or hide one of the layers of `session`'s document (its `layers`), in
 * every viewer of the document. Showing one of a set of exclusive layers
 * hides the others. Pages keep their pixels until they are drawn again.
 */
export function setLayerVisible(session: PdfSession, id: string, visible: boolean): void {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  const work = controller.signal;
  if (!doc || work.aborted) return;
  if (doc.loadedLayers) {
    doc.loadedLayers.setVisible(id, visible);
    return;
  }
  void doc
    .layers()
    .then((layers) => {
      if (!work.aborted) layers.setVisible(id, visible);
    })
    .catch(() => {});
}
