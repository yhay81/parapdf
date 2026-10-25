"use client";

import { downloadBytes } from "../runtime/files.ts";
import type { Viewer } from "../view/viewer.ts";

/**
 * The bytes of `viewer`'s document, with what was typed into its form
 * fields and the annotations created in any of its viewers saved in them;
 * null while no document is open.
 */
export async function save(viewer: Viewer): Promise<Uint8Array | null> {
  // The text being typed counts, in every viewer, as it would once the
  // reader clicks away.
  viewer.session?.commit();
  return (await viewer.session?.save()) ?? null;
}

/**
 * Save `viewer`'s document as `save()` does and hand it to the browser as a
 * download, named `filename`, by default after the document's URL.
 */
export async function download(viewer: Viewer, filename?: string): Promise<void> {
  const bytes = await save(viewer);
  if (!bytes) return;
  downloadBytes(bytes, filename ?? viewer.sourceName ?? "document.pdf", "application/pdf");
}
