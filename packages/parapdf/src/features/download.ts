"use client";

import type { PdfPageSelection } from "../document/session.ts";
import { downloadBytes } from "../view/files.ts";
import type { Viewer } from "../view/viewer.ts";

export interface SaveOptions {
  /**
   * The pages to save instead of the whole document, as pdf.js's
   * `extractPages()` takes them: ranges of its pages, pages of other
   * documents, and images as pages.
   */
  pages?: PdfPageSelection;
}

export interface DownloadOptions extends SaveOptions {
  /**
   * The file's name; by default, or when empty, as the server names the
   * file, or else after the document's URL.
   */
  filename?: string;
}

/**
 * The bytes of `viewer`'s document, or of the `pages` chosen, with what was
 * typed into its form fields and the annotations created in any of its
 * viewers saved in them; null while no document is open. The document's scripts hear `WillSave`
 * before, and what they change saves, and `DidSave` after.
 */
export async function save(
  viewer: Viewer,
  { pages }: SaveOptions = {},
): Promise<Uint8Array | null> {
  const { session } = viewer;
  if (!session) return null;
  // The text being typed counts, in every viewer, as it would once the
  // reader clicks away.
  session.commit();
  await session.output("WillSave");
  const bytes = await session.save(pages);
  await session.output("DidSave");
  return bytes;
}

/**
 * Save `viewer`'s document as `save()` does and hand it to the browser as a
 * download, named `filename`, by default (or when empty) as the server
 * names the file, or else after the document's URL.
 */
export async function download(
  viewer: Viewer,
  { filename, pages }: DownloadOptions = {},
): Promise<void> {
  const { session } = viewer;
  const sourceName = viewer.sourceName;
  const bytes = await save(viewer, { pages });
  if (!bytes) return;
  // A document whose metadata fails to read still downloads, under its URL.
  // An empty name is none.
  const served = filename ? null : await session?.metadata().catch(() => null);
  const name = filename || served?.filename || sourceName || "document.pdf";
  downloadBytes(bytes, name, "application/pdf");
}
