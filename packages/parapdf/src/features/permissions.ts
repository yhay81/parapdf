"use client";

import type { PdfPermissions } from "../document/session.ts";
import type { Viewer } from "../view/viewer.ts";

/** What a viewer that follows permissions asks the document for. */
export type Permission = "print" | "copy" | "annotate" | "fillForms";

/**
 * Whether `permissions` permit `what`; everything while they are unknown.
 * Form fields can also be filled in with permission to annotate (PDF
 * 32000-1, Table 22).
 */
export function permitted(permissions: PdfPermissions | null, what: Permission): boolean {
  if (!permissions) return true;
  return what === "fillForms" ? permissions.fillForms || permissions.annotate : permissions[what];
}

/** Viewers that follow what their documents permit. */
const enforcing = new WeakSet<Viewer>();

/**
 * Whether `viewer`'s document permits `what`, or the viewer does not follow
 * permissions (`enforcePermissions()`).
 */
export function permits(viewer: Viewer, what: Permission): boolean {
  return !enforcing.has(viewer) || permitted(viewer.permissions, what);
}

/**
 * Follow what `viewer`'s documents permit, as pdf.js does not by default:
 * without permission to copy, their text cannot be selected or copied,
 * though it stays readable by assistive technology and `getText()`; without
 * permission to print, `print()` fails; without permission to annotate,
 * annotations cannot be created, and form fields can be filled in only with
 * permission to fill forms. Returns the function that stops following them.
 */
export function enforcePermissions(viewer: Viewer): () => void {
  enforcing.add(viewer);
  let content: HTMLElement | null = null;
  const apply = () => content?.classList.toggle("parapdf-no-copy", !permits(viewer, "copy"));
  const onCopy = (event: ClipboardEvent) => {
    if (!permits(viewer, "copy")) event.preventDefault();
  };
  const detachExtension = viewer.extend({
    // Each document's permissions are known before its pages are laid out.
    prepare: apply,
    viewport(_scroller, pages, signal) {
      content = pages;
      pages.addEventListener("copy", onCopy, { signal });
      pages.addEventListener("cut", onCopy, { signal });
      apply();
      signal.addEventListener(
        "abort",
        () => {
          pages.classList.remove("parapdf-no-copy");
          if (content === pages) content = null;
        },
        { once: true },
      );
    },
  });
  return () => {
    enforcing.delete(viewer);
    detachExtension();
    content?.removeEventListener("copy", onCopy);
    content?.removeEventListener("cut", onCopy);
    content?.classList.remove("parapdf-no-copy");
    content = null;
  };
}
