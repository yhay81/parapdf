"use client";

import { useEffect, useEffectEvent } from "react";
import type { FormChange } from "../features/forms/fields.ts";
import { usePdfViewer } from "./context.ts";
import { useLoadedFeature } from "./features.ts";

/**
 * Call `listener` with each value the reader enters into a form field of
 * the viewer, as they type. It needs the `forms` option.
 */
export function usePdfFormChange(listener: (change: FormChange) => void): void {
  const formLayers = useLoadedFeature(usePdfViewer(), "formLayers");
  const onChange = useEffectEvent(listener);
  useEffect(() => formLayers?.onFormChange((change) => onChange(change)), [formLayers]);
}
