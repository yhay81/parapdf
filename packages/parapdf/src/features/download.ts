"use client";

import { downloadBytes } from "../view/files.ts";
import type { Viewer } from "../view/viewer.ts";

/**
 * The bytes of `viewer`'s document, with what was typed into its form
 * fields and the annotations created in any of its viewers saved in them;
 * null while no document is open. The document's scripts hear `WillSave`
 * before, and what they change saves, and `DidSave` after.
 */
export async function save(viewer: Viewer): Promise<Uint8Array | null> {
  const { session } = viewer;
  if (!session) return null;
  // The text being typed counts, in every viewer, as it would once the
  // reader clicks away.
  session.commit();
  await session.output("WillSave");
  const bytes = await session.save();
  await session.output("DidSave");
  return bytes;
}

/**
 * Save `viewer`'s document as `save()` does and hand it to the browser as a
 * download, named `filename`, by default as the server names the file, or
 * else after the document's URL.
 */
export async function download(viewer: Viewer, filename?: string): Promise<void> {
  const { session } = viewer;
  const sourceName = viewer.sourceName;
  const bytes = await save(viewer);
  if (!bytes) return;
  // A document whose metadata fails to read still downloads, under its URL.
  const served = filename ? null : await session?.metadata().catch(() => null);
  const name = filename ?? served?.filename ?? sourceName;
  downloadBytes(bytes, name ?? "document.pdf", "application/pdf");
}
