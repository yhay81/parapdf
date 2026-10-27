"use client";

import { use, useEffect, useEffectEvent } from "react";
import { documentOf, type PdfSession } from "../document/pdf-session.ts";
import type { FormChange, FormField } from "../features/forms/fields.ts";
import { formsOf } from "../features/forms/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useSessionData } from "./context.ts";
import { useLoadedFeature } from "./features.ts";

/**
 * Call `listener` with each value the reader enters into a form field in
 * `viewer`, as they type. It needs the `forms` option.
 */
export function useFormChange(viewer: Viewer, listener: (change: FormChange) => void): void {
  const formLayers = useLoadedFeature(viewer, "formLayers");
  const onChange = useEffectEvent(listener);
  useEffect(() => formLayers?.onFormChange((change) => onChange(change)), [formLayers]);
}

/** Each session's form fields, read once. */
const fields = new WeakMap<PdfSession, Promise<readonly FormField[]>>();

/**
 * The form fields of the nearest `<PdfDocument>`'s document with their
 * values as first read, empty when it has none; `getFormFields()` reads the
 * values again. Suspends until they are read, and throws on the server, as
 * `useOutline()` does: render it under a Suspense boundary of the
 * application's own, apart from the viewer.
 */
export function useFormFields(): readonly FormField[] {
  const session = useSessionData("useFormFields");
  let read = fields.get(session);
  if (!read) {
    read = documentOf(session)
      .then((document) => formsOf(document).getFormFields())
      .catch(() => []);
    fields.set(session, read);
  }
  return use(read);
}
