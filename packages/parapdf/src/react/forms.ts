"use client";

import { useEffect, useEffectEvent } from "react";
import type { FormChange } from "../pdfjs/forms.ts";
import { usePdfViewer } from "./context.ts";

/**
 * Call `listener` with each value the reader enters into a form field of
 * the viewer, as they type (see `onFormChange()`). It needs `forms`.
 */
export function usePdfFormChange(listener: (change: FormChange) => void): void {
  const viewer = usePdfViewer();
  const onChange = useEffectEvent(listener);
  useEffect(() => viewer.onFormChange((change) => onChange(change)), [viewer]);
}
