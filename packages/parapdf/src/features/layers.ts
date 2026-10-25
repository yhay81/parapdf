import type { Viewer } from "../view/viewer.ts";

/**
 * Show or hide one of the layers of `viewer`'s document (its `layers`), in
 * every viewer of the document. Showing one of a set of exclusive layers
 * hides the others. Pages keep their pixels until they are drawn again.
 */
export function setLayerVisible(viewer: Viewer, id: string, visible: boolean): void {
  viewer.layers?.setVisible(id, visible);
}
