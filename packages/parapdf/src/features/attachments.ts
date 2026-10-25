import type { PdfAttachment } from "../document/session.ts";
import type { Viewer } from "../view/viewer.ts";

/** The content of the file `id` embedded in `viewer`'s document (its `attachments`); null when there is none. */
export async function getAttachmentContent(viewer: Viewer, id: string): Promise<Uint8Array | null> {
  return (await viewer.session?.proxy.getAttachmentContent(id)) ?? null;
}

/** Open an embedded file the way activating its annotation does: by default, download it. */
export async function openAttachment(viewer: Viewer, attachment: PdfAttachment): Promise<void> {
  const content = await getAttachmentContent(viewer, attachment.id);
  if (content) viewer.openFile({ filename: attachment.filename, content });
}
