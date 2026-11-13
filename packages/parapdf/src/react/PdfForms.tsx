"use client";

import { useEffectEvent, useLayoutEffect, useRef } from "react";
import type { FormChange } from "../features/forms/fields.ts";
import { attachFormLayers, type FormLayers } from "../features/forms/layers.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";
import { notifyFormChange } from "./forms.ts";

export interface PdfFormsProps {
  /**
   * The viewer whose form fields become interactive HTML; without it,
   * `<PdfForms>` uses `useViewer()`.
   */
  viewer?: Viewer;
  /**
   * Run the document's scripts in its form fields (default false):
   * calculations, validation, formatting, and the actions of buttons, as in
   * pdf.js. They run in pdf.js's QuickJS WebAssembly sandbox, which loads only
   * for a document that has scripts.
   */
  scripts?: boolean;
  /** Called with each value the reader enters into a form field, or a script changes. */
  onChange?: (change: FormChange) => void;
}

/**
 * Show form fields as HTML that the reader can fill in (without `<PdfForms>`,
 * the canvas drawing shows them as they are). Typed values belong to the
 * document, which `save()` writes them into; needs `annotationLayer` on
 * `<PdfViewer>`.
 */
export function PdfForms({
  viewer: externalViewer,
  scripts = false,
  onChange,
}: PdfFormsProps): null {
  const viewer = useOptionalViewer(externalViewer);
  const layersRef = useRef<FormLayers | null>(null);
  const initialScripts = useRef(scripts);
  initialScripts.current = scripts;
  const appliedScripts = useRef(scripts);
  const handleChange = useEffectEvent((change: FormChange) => {
    onChange?.(change);
    notifyFormChange(viewer, change);
  });

  useLayoutEffect(() => {
    const startScripts = initialScripts.current;
    appliedScripts.current = startScripts;
    const layers = attachFormLayers(viewer, { scripts: startScripts });
    layersRef.current = layers;
    const off = layers.onFormChange((change) => handleChange(change));
    return () => {
      off();
      layersRef.current = null;
      layers.detach();
    };
  }, [viewer]);

  useLayoutEffect(() => {
    if (scripts === appliedScripts.current) return;
    appliedScripts.current = scripts;
    layersRef.current?.setScripts(scripts);
  }, [scripts]);

  return null;
}
