"use client";

import type { DocumentPermissions } from "../document/session.ts";
import type { Viewer } from "../view/viewer.ts";

/** What a viewer that follows permissions asks the document for. */
export type Permission = "print" | "copy" | "annotate" | "fillForms";

/**
 * Whether `permissions` permit `what`; everything while they are unknown.
 * Form fields can also be filled in with permission to annotate (PDF
 * 32000-1, Table 22).
 */
export function permitted(permissions: DocumentPermissions | null, what: Permission): boolean {
  if (!permissions) return true;
  return what === "fillForms" ? permissions.fillForms || permissions.annotate : permissions[what];
}

interface Enforcement {
  holders: number;
  stopCopyProtection?: () => void;
  listeners: Set<() => void>;
}

const policies = new WeakMap<Viewer, Enforcement>();

function policyOf(viewer: Viewer): Enforcement {
  let policy = policies.get(viewer);
  if (!policy) {
    policy = { holders: 0, listeners: new Set() };
    policies.set(viewer, policy);
  }
  return policy;
}

/** Tell a feature when the application starts or stops enforcing permissions. */
export function onEnforcementChange(viewer: Viewer, listener: () => void): () => void {
  const { listeners } = policyOf(viewer);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether `viewer`'s document permits `what`, or the viewer does not follow
 * permissions (`enforcePermissions()`).
 */
export function permits(viewer: Viewer, what: Permission): boolean {
  return !policies.get(viewer)?.holders || permitted(viewer.permissions, what);
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
  const policy = policyOf(viewer);
  if (++policy.holders === 1) {
    policy.stopCopyProtection = protectCopy(viewer);
    for (const listener of policy.listeners) listener();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--policy.holders !== 0) return;
    policy.stopCopyProtection?.();
    delete policy.stopCopyProtection;
    for (const listener of policy.listeners) listener();
  };
}

function protectCopy(viewer: Viewer): () => void {
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
    detachExtension();
    content?.removeEventListener("copy", onCopy);
    content?.removeEventListener("cut", onCopy);
    content?.classList.remove("parapdf-no-copy");
    content = null;
  };
}
