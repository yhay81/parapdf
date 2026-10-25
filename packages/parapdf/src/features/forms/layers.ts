"use client";

import type { DocumentSession } from "../../document/session.ts";
import type { Viewer } from "../../view/viewer.ts";
import { permits } from "../permissions.ts";
import type { FormChange } from "./fields.ts";
import { formsOf } from "./index.ts";

/** Form fields the reader fills in on `viewer`'s pages (`forms`). */
export interface FormLayers {
  /**
   * Call `listener` with each value the reader enters into a form field, as
   * they type; returns the function that stops it. `setFormValues()` does
   * not call it.
   */
  onFormChange(listener: (change: FormChange) => void): () => void;
  /** Draw the fields again instead of showing them, and stop reporting changes. */
  detach(): void;
}

/**
 * Show `viewer`'s form fields as HTML the reader fills in, where the
 * document permits filling them in (`enforcePermissions()`); `detach()`
 * draws them again.
 */
export function attachFormLayers(viewer: Viewer): FormLayers {
  const listeners = new Set<(change: FormChange) => void>();
  let open: { session: DocumentSession; signal: AbortSignal } | null = null;

  /**
   * Form elements in annotation layers change the document's storage, then
   * bubble here: text fields and lists at each input, boxes and radio
   * buttons at their change, which comes after an input that changed nothing yet.
   */
  const onInput = (event: Event): void => {
    const target = event.target;
    if (!open || open.signal.aborted || listeners.size === 0 || !(target instanceof Element)) {
      return;
    }
    const { signal } = open;
    const toggle =
      target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio");
    if (toggle !== (event.type === "change")) return;
    const id = target
      .closest(".parapdf-annotation-layer [data-element-id]")
      ?.getAttribute("data-element-id");
    if (!id) return;
    formsOf(open.session)
      .formChange(id)
      .then(
        (change) => {
          if (!change || signal.aborted) return;
          for (const listener of listeners) listener(change);
        },
        (error: unknown) => console.error("reading a form change failed", error),
      );
  };

  const detachExtension = viewer.extend({
    prepare() {
      viewer.setFormLayers(permits(viewer, "fillForms"));
    },
    ready(session, signal) {
      open = { session, signal };
    },
    viewport(_scroller, content, signal) {
      content.addEventListener("input", onInput, { signal });
      content.addEventListener("change", onInput, { signal });
    },
  });

  return {
    onFormChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    detach() {
      detachExtension();
      listeners.clear();
      viewer.content?.removeEventListener("input", onInput);
      viewer.content?.removeEventListener("change", onInput);
      viewer.setFormLayers(false);
      open = null;
    },
  };
}
