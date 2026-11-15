"use client";

import {
  type PdfSession,
  type PdfSessionController,
  sessionControllerOf,
} from "../document/pdf-session.ts";
import type { PdfPageSelection } from "../document/session.ts";
import { createSlotKey, type ReadableStore, Store } from "../document/store.ts";
import { downloadBytes, filenameFromUrl } from "../view/files.ts";

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

export interface SaveControls {
  /** Save the document's bytes, including form values and created annotations. */
  save(options?: SaveOptions): Promise<Uint8Array | null>;
  /** Save the document and hand it to the browser as a download. */
  download(options?: DownloadOptions): Promise<void>;
  /** True while `save()` or `download()` is running on this session. */
  saving: boolean;
}

export interface SaveSlot {
  readonly store: ReadableStore<SaveControls>;
  readonly initialControls: SaveControls;
  run<T>(work: () => Promise<T>): Promise<T>;
}

const SAVE_SLOT = createSlotKey<SaveSlot>("parapdf.save");

export function saveOf(controller: PdfSessionController): SaveSlot {
  return controller.slot(SAVE_SLOT, () => {
    let pending = 0;
    const initialControls: SaveControls = {
      saving: false,
      save: (options) => save(controller, options),
      download: (options) => download(controller, options),
    };
    const store = new Store<SaveControls>(initialControls);
    return {
      store,
      initialControls,
      async run<T>(work: () => Promise<T>): Promise<T> {
        if (++pending === 1) store.set({ saving: true });
        try {
          return await work();
        } finally {
          if (--pending === 0) store.set({ saving: false });
        }
      },
    };
  });
}

/**
 * The bytes of `session`'s document, or of the `pages` chosen, with what was
 * typed into its form fields and the annotations created in any of its
 * viewers saved in them; null while no document is open. The document's
 * scripts hear `WillSave` before, and what they change saves, and `DidSave`
 * after.
 */
export async function save(
  session: PdfSession,
  { pages }: SaveOptions = {},
): Promise<Uint8Array | null> {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  if (!doc) return null;
  return saveOf(controller).run(async () => {
    // The text being typed counts, in every viewer, as it would once the
    // reader clicks away.
    await doc.commit();
    await doc.output("WillSave");
    const bytes = await doc.save(pages);
    await doc.output("DidSave");
    return bytes;
  });
}

/**
 * Save `session`'s document as `save()` does and hand it to the browser as a
 * download, named `filename`, by default (or when empty) as the server
 * names the file, or else after the document's URL.
 */
export async function download(
  session: PdfSession,
  { filename, pages }: DownloadOptions = {},
): Promise<void> {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  if (!doc) return;
  const sourceName = "url" in controller.source ? filenameFromUrl(controller.source.url) : null;
  await saveOf(controller).run(async () => {
    const bytes = await save(controller, { pages });
    if (!bytes) return;
    // A document whose metadata fails to read still downloads, under its URL.
    // An empty name is none.
    const served = filename ? null : await doc.metadata().catch(() => null);
    const name = filename || served?.filename || sourceName || "document.pdf";
    downloadBytes(bytes, name, "application/pdf");
  });
}
