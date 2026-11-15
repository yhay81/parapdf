"use client";

import type { DocumentSession } from "../../document/session.ts";
import type { ViewerController } from "../../view/viewer.ts";
import { onEnforcementChange, permits } from "../permissions.ts";
import type { FormChange } from "./fields.ts";
import {
  formsOf,
  hasViewerFormListeners,
  notifyViewerFormChange,
  onViewerFormChange,
} from "./index.ts";

/** Form fields the reader fills in on `viewer`'s pages (`forms`). */
export interface FormLayers {
  /**
   * Run the document's scripts in the fields, or stop running them
   * (`formScripts`): calculations, validation, formatting, and actions.
   */
  setScripts(scripts: boolean): void;
  /** Synchronize `scripts` and optional `onChange` listener from `<PdfForms>`. */
  sync(scripts: boolean, onChange?: (change: FormChange) => void): void;
  /** Draw the fields again instead of showing them, and stop reporting changes. */
  detach(): void;
}

/**
 * Show `viewer`'s form fields as HTML the reader fills in, where the
 * document permits filling them in (`enforcePermissions()`), and, with
 * `scripts`, run the document's scripts in them; `detach()` draws them
 * again.
 */
export function attachFormLayers(viewer: ViewerController, { scripts = false } = {}): FormLayers {
  let open: { session: DocumentSession; signal: AbortSignal } | null = null;
  /** The session whose scripts the fields run, and how to stop, once they do. */
  let scripting: { session: DocumentSession; leave: (() => void) | null } | null = null;
  /** Whether the open document's pages showed pixels, which the scripts wait for. */
  let painted = false;

  /** Tell the viewer's listeners the new value of the field `id`. */
  const report = (session: DocumentSession, signal: AbortSignal, id: string): void => {
    formsOf(session)
      .formChange(id)
      .then(
        (change) => {
          if (!change || signal.aborted) return;
          notifyViewerFormChange(viewer, change);
        },
        (error: unknown) => console.error("reading a form change failed", error),
      );
  };

  /**
   * Run the scripts of the open document, if it has any: their module and
   * pdf.js's sandbox load only then, and only once its pages show pixels,
   * since reading its fields keeps pdf.js's worker from the first page and
   * QuickJS takes the network and the main thread. They keep running while the viewport
   * detaches, since the sandbox keeps the fields' values, until the
   * document closes or scripts are turned off.
   */
  const startScripts = (): void => {
    if (!scripts || !open || !painted || scripting?.session === open.session) return;
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
              if (open?.session === session && hasViewerFormListeners(viewer)) {
                report(session, open.signal, id);
              }
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
    if (
      !open ||
      open.signal.aborted ||
      !hasViewerFormListeners(viewer) ||
      !(target instanceof Element)
    ) {
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

  const applyPermissions = () => viewer.setFormLayers(permits(viewer, "fillForms"));
  const unsubscribePermissions = onEnforcementChange(viewer, applyPermissions);
  const detachExtension = viewer.extend({
    prepare: applyPermissions,
    ready(session, signal) {
      open = { session, signal };
      startScripts();
    },
    painted() {
      painted = true;
      startScripts();
    },
    closed() {
      open = null;
      painted = false;
      stopScripts();
    },
    viewport(_scroller, content, signal) {
      content.addEventListener("input", onInput, { signal });
      content.addEventListener("change", onInput, { signal });
    },
  });

  let currentOnChange: ((change: FormChange) => void) | undefined;
  let unsubscribeChange: (() => void) | null = null;
  const setScripts = (next: boolean) => {
    if (scripts === next) return;
    scripts = next;
    if (next) startScripts();
    else stopScripts();
  };

  return {
    setScripts,
    sync(nextScripts, onChange) {
      setScripts(nextScripts);
      currentOnChange = onChange;
      if (onChange) {
        unsubscribeChange ??= onViewerFormChange(viewer, (change) => currentOnChange?.(change));
      } else if (unsubscribeChange) {
        unsubscribeChange();
        unsubscribeChange = null;
      }
    },
    detach() {
      currentOnChange = undefined;
      unsubscribeChange?.();
      unsubscribeChange = null;
      unsubscribePermissions();
      stopScripts();
      detachExtension();
      viewer.content?.removeEventListener("input", onInput);
      viewer.content?.removeEventListener("change", onInput);
      viewer.setFormLayers(false);
      open = null;
    },
  };
}
