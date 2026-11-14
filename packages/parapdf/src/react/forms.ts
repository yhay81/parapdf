"use client";

import { use, useEffect, useEffectEvent } from "react";
import type { FormChange, FormField } from "../features/forms/fields.ts";
import { initialFormFields, onViewerFormChange } from "../features/forms/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useSessionData } from "./context.ts";

/**
 * Call `listener` with each value the reader enters into a form field in
 * `viewer`, or in the viewer of the nearest `<PdfView>` or `<PdfDocument>`,
 * as they type. Needs `<PdfForms>` on that viewer.
 */
export function useFormChange(listener: (change: FormChange) => void, viewer?: Viewer): void {
  const resolved = useOptionalViewer(viewer);
  const onChange = useEffectEvent(listener);
  useEffect(() => onViewerFormChange(resolved, (change) => onChange(change)), [resolved]);
}

/**
 * The form fields of the nearest `<PdfDocument>`'s document with their
 * values as first read, empty when it has none; `getFormFields()` reads the
 * values again. Suspends until they are read, and throws on the server, as
 * `useOutline()` does: render it under a Suspense boundary of the
 * application's own, apart from the viewer.
 */
export function useFormFields(): readonly FormField[] {
  const session = useSessionData("useFormFields");
  return use(initialFormFields(session));
}
