"use client";

import {
  openAttachmentHandlerOf,
  openDocumentOf,
  type PdfSession,
} from "../document/pdf-session.ts";
import type { PdfAttachment } from "../document/session.ts";
import { downloadBytes } from "../view/files.ts";

/** The content of the file `id` embedded in `session`'s document; null when there is none. */
export async function getAttachmentContent(
  session: PdfSession,
  id: string,
): Promise<Uint8Array | null> {
  return (await openDocumentOf(session)?.proxy.getAttachmentContent(id)) ?? null;
}

/**
 * Open an embedded file the way activating its annotation does: through
 * `<PdfDocument onOpenAttachment>`, or by downloading it in the browser.
 */
export async function openAttachment(
  session: PdfSession,
  attachment: PdfAttachment,
): Promise<void> {
  const work = session.signal;
  const content = await getAttachmentContent(session, attachment.id);
  if (!content || work.aborted) return;
  const file = { filename: attachment.filename, content };
  const handler = openAttachmentHandlerOf(session);
  if (handler) handler(file);
  else downloadBytes(file.content, file.filename);
}
