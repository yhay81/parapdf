import {
  type PdfSession,
  type PdfSessionController,
  sessionControllerOf,
} from "../../document/pdf-session.ts";
import type { DocumentSession } from "../../document/session.ts";
import { createSlotKey } from "../../document/store.ts";
import type { ViewerController } from "../../view/viewer.ts";
import { createFormAccess, type FormChange, type FormField, type FormValue } from "./fields.ts";

export type { FormChange, FormField, FormFieldType, FormValue } from "./fields.ts";

/** Each session's form fields, read once for every viewer of it. */
const FORM_ACCESS_SLOT = createSlotKey<ReturnType<typeof createFormAccess>>("parapdf.formAccess");

/** Listeners subscribed to form field edits per viewer (`<PdfForms onChange>`, `useFormChange()`). */
const FORM_LISTENERS_SLOT =
  createSlotKey<Set<(change: FormChange) => void>>("parapdf.formListeners");

export function onViewerFormChange(
  viewer: ViewerController,
  listener: (change: FormChange) => void,
): () => void {
  const set = viewer.slot(FORM_LISTENERS_SLOT, () => new Set());
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function hasViewerFormListeners(viewer: ViewerController): boolean {
  return (viewer.peekSlot(FORM_LISTENERS_SLOT)?.size ?? 0) > 0;
}

export function notifyViewerFormChange(viewer: ViewerController, change: FormChange): void {
  const set = viewer.peekSlot(FORM_LISTENERS_SLOT);
  if (!set) return;
  for (const listener of [...set]) listener(change);
}

/** The form fields of `session`, read and set through pdf.js's annotation storage. */
export function formsOf(session: DocumentSession): ReturnType<typeof createFormAccess> {
  return session.slot(FORM_ACCESS_SLOT, () =>
    createFormAccess(session.proxy, (index) => session.page(index)),
  );
}

/** The fields as first read by this provider, or an empty list when opening failed. */
export function initialFormFields(provider: PdfSessionController): Promise<readonly FormField[]> {
  return provider.read("formFields", (session) => formsOf(session).getFormFields(), []);
}

/**
 * The form fields of `session`'s document with their values, those the
 * reader entered and those `setFormValues()` set included; empty when it
 * has none or no document is open.
 */
export async function getFormFields(session: PdfSession): Promise<readonly FormField[]> {
  const doc = sessionControllerOf(session).openDocument();
  return doc ? formsOf(doc).getFormFields() : [];
}

/**
 * Set form fields of `session`'s document by name: text for text fields, the
 * export value of the box or radio button to check ("Off" for none, or true
 * for the first box and false for none), and an option's export value, or
 * several for a list box that takes several. Returns the names it set;
 * other names are ignored. Form fields shown (`<PdfForms>`) in any viewer of
 * the document show the values, and `save()` and `print()` include them.
 */
export async function setFormValues(
  session: PdfSession,
  values: Readonly<Record<string, FormValue | boolean>>,
): Promise<string[]> {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  const signal = controller.signal;
  if (!doc || signal.aborted) return [];
  const set = await formsOf(doc).setFormValues(values);
  // Form layers read the values as they are built.
  if (set.length > 0 && !signal.aborted) doc.invalidateContent();
  return set;
}
