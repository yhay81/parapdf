"use client";

import { downloadBytes } from "../view/files.ts";
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
 * download, named `filename`, by default as the server names the file, or
 * else after the document's URL.
 */
export async function download(viewer: Viewer, filename?: string): Promise<void> {
  const { session } = viewer;
  const bytes = await save(viewer);
  if (!bytes) return;
  // A document whose metadata fails to read still downloads, under its URL.
  const served = filename ? null : await session?.metadata().catch(() => null);
  const name = filename ?? served?.filename ?? viewer.sourceName;
  downloadBytes(bytes, name ?? "document.pdf", "application/pdf");
}
