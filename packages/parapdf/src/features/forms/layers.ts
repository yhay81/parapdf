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
  /**
   * Run the document's scripts in the fields, or stop running them
   * (`formScripts`): calculations, validation, formatting, and actions.
   */
  setScripts(scripts: boolean): void;
  /** Draw the fields again instead of showing them, and stop reporting changes. */
  detach(): void;
}

/**
 * Show `viewer`'s form fields as HTML the reader fills in, where the
 * document permits filling them in (`enforcePermissions()`), and, with
 * `scripts`, run the document's scripts in them; `detach()` draws them
 * again.
 */
export function attachFormLayers(viewer: Viewer, { scripts = false } = {}): FormLayers {
  const listeners = new Set<(change: FormChange) => void>();
  let open: { session: DocumentSession; signal: AbortSignal } | null = null;
  /** The session whose scripts the fields run, and how to stop, once they do. */
  let scripting: { session: DocumentSession; leave: (() => void) | null } | null = null;

  /** Tell the listeners the new value of the field `id`. */
  const report = (session: DocumentSession, signal: AbortSignal, id: string): void => {
    formsOf(session)
      .formChange(id)
      .then(
        (change) => {
          if (!change || signal.aborted) return;
          for (const listener of listeners) listener(change);
        },
        (error: unknown) => console.error("reading a form change failed", error),
      );
  };

  /**
   * Run the scripts of the open document, if it has any: their module and
   * pdf.js's sandbox load only then. They keep running while the viewport
   * detaches, since the sandbox keeps the fields' values, until the
   * document closes or scripts are turned off.
   */
  const startScripts = (): void => {
    if (!scripts || !open || scripting?.session === open.session) return;
    stopScripts();
    const { session } = open;
    const current = { session, leave: null as (() => void) | null };
    scripting = current;
    session.proxy
      .hasJSActions()
      .then((has) => (has ? import("./scripts.ts") : null))
      .then(
        (module) => {
          if (!module || scripting !== current) return;
          const joined = module.joinScripting(session, {
            viewer,
            changed: (id) => {
              if (open?.session === session) report(session, open.signal, id);
            },
          });
          current.leave = joined.leave;
          viewer.setFormScripting(joined.layer);
        },
        (error: unknown) => console.error("starting the document's scripts failed", error),
      );
  };

  const stopScripts = (): void => {
    if (!scripting) return;
    scripting.leave?.();
    scripting = null;
    viewer.setFormScripting(null);
  };

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
    report(open.session, signal, id);
  };

  const detachExtension = viewer.extend({
    prepare() {
      viewer.setFormLayers(permits(viewer, "fillForms"));
    },
    ready(session, signal) {
      open = { session, signal };
      startScripts();
    },
    closed() {
      stopScripts();
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
    setScripts(next) {
      scripts = next;
      if (next) startScripts();
      else stopScripts();
    },
    detach() {
      stopScripts();
      detachExtension();
      listeners.clear();
      viewer.content?.removeEventListener("input", onInput);
      viewer.content?.removeEventListener("change", onInput);
      viewer.setFormLayers(false);
      open = null;
    },
  };
}
