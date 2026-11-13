import { openDocumentOf, type PdfSession, readSessionData } from "../../document/pdf-session.ts";
import type { DocumentSession } from "../../document/session.ts";
import { createFormAccess, type FormField, type FormValue } from "./fields.ts";

export type { FormChange, FormField, FormFieldType, FormValue } from "./fields.ts";

/** Each session's form fields, read once for every viewer of it. */
const access = new WeakMap<DocumentSession, ReturnType<typeof createFormAccess>>();

/** The form fields of `session`, read and set through pdf.js's annotation storage. */
export function formsOf(session: DocumentSession): ReturnType<typeof createFormAccess> {
  let forms = access.get(session);
  if (!forms) {
    forms = createFormAccess(session.proxy, (index) => session.page(index));
    access.set(session, forms);
  }
  return forms;
}

/** The fields as first read by this provider, or an empty list when opening failed. */
export function initialFormFields(provider: PdfSession): Promise<readonly FormField[]> {
  return readSessionData(provider, "formFields", (session) => formsOf(session).getFormFields(), []);
}

/**
 * The form fields of `session`'s document with their values, those the
 * reader entered and those `setFormValues()` set included; empty when it
 * has none or no document is open.
 */
export async function getFormFields(session: PdfSession): Promise<readonly FormField[]> {
  const doc = openDocumentOf(session);
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
  const doc = openDocumentOf(session);
  const signal = session.signal;
  if (!doc || signal.aborted) return [];
  const set = await formsOf(doc).setFormValues(values);
  // Form layers read the values as they are built.
  if (set.length > 0 && !signal.aborted) doc.invalidateContent();
  return set;
}
