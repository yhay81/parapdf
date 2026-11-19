"use client";

import type { DocumentPermissions } from "../document/session.ts";
import { createSlotKey, type ReadableStore, Store } from "../document/store.ts";
import { controllerOf, type Viewer, type ViewerController } from "../view/viewer.ts";

/** What a viewer that follows permissions asks the document for. */
export type Permission = "print" | "copy" | "annotate" | "fillForms";

/** Effective permission flags of a viewer (`true` unless `<PdfPermissions />` restricts them). */
export interface PermitsState {
  readonly print: boolean;
  readonly copy: boolean;
  readonly annotate: boolean;
  readonly fillForms: boolean;
}

export const ALL_PERMITTED: PermitsState = {
  print: true,
  copy: true,
  annotate: true,
  fillForms: true,
};

function computePermitsState(permissions: DocumentPermissions | null): PermitsState {
  if (!permissions) return ALL_PERMITTED;
  return {
    print: permissions.print,
    copy: permissions.copy,
    annotate: permissions.annotate,
    fillForms: permissions.fillForms || permissions.annotate,
  };
}

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
  readonly listeners: Set<() => void>;
  readonly store: Store<PermitsState>;
  sync(permissions: DocumentPermissions | null): void;
}

const PERMISSIONS_SLOT = createSlotKey<Enforcement>("parapdf.permissions");

function policyOf(viewer: ViewerController): Enforcement {
  return viewer.slot(PERMISSIONS_SLOT, () => {
    const store = new Store<PermitsState>(ALL_PERMITTED);
    const entry: Enforcement = {
      holders: 0,
      listeners: new Set(),
      store,
      sync(permissions) {
        store.set(entry.holders > 0 ? computePermitsState(permissions) : ALL_PERMITTED);
      },
    };
    viewer.extend({
      prepare() {
        entry.sync(viewer.permissions);
      },
      closed() {
        entry.sync(null);
      },
    });
    return entry;
  });
}

export function permitsStoreOf(viewer: ViewerController): ReadableStore<PermitsState> {
  return policyOf(viewer).store;
}

/** Tell a feature when the application starts or stops enforcing permissions. */
export function onEnforcementChange(viewer: ViewerController, listener: () => void): () => void {
  const { listeners } = policyOf(viewer);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether `viewer`'s document permits `what`, or the viewer does not follow
 * permissions (`<PdfPermissions>`).
 */
export function permits(viewer: Viewer, what: Permission): boolean {
  const controller = controllerOf(viewer);
  return !controller.peekSlot(PERMISSIONS_SLOT)?.holders || permitted(controller.permissions, what);
}

/**
 * Follow what `viewer`'s documents permit, as pdf.js does not by default:
 * without permission to copy, their text cannot be selected or copied,
 * though it stays readable by assistive technology and `getText()`; without
 * permission to print, `usePrint()`'s `print()` fails; without permission to
 * annotate, annotations cannot be created, and form fields can be filled in
 * only with permission to fill forms. Returns the function that stops following them.
 */
export function enforcePermissions(viewer: ViewerController): () => void {
  const policy = policyOf(viewer);
  if (++policy.holders === 1) {
    policy.sync(viewer.permissions);
    policy.stopCopyProtection = protectCopy(viewer);
    for (const listener of [...policy.listeners]) listener();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--policy.holders !== 0) return;
    policy.sync(null);
    policy.stopCopyProtection?.();
    delete policy.stopCopyProtection;
    for (const listener of [...policy.listeners]) listener();
  };
}

function protectCopy(viewer: ViewerController): () => void {
  let scroller: HTMLElement | null = null;
  let content: HTMLElement | null = null;
  const apply = () => content?.classList.toggle("parapdf-no-copy", !permits(viewer, "copy"));
  const onCopy = (event: ClipboardEvent) => {
    if (permits(viewer, "copy")) return;
    const target = event.target;
    if (
      target === scroller ||
      target === content ||
      (target instanceof Node && content?.contains(target))
    ) {
      event.preventDefault();
    }
  };
  const detachExtension = viewer.extend({
    // Each document's permissions are known before its pages are laid out.
    prepare: apply,
    closed() {
      content?.classList.remove("parapdf-no-copy");
    },
    viewport(nextScroller, pages, signal) {
      scroller = nextScroller;
      content = pages;
      nextScroller.addEventListener("copy", onCopy, { signal });
      nextScroller.addEventListener("cut", onCopy, { signal });
      apply();
      signal.addEventListener(
        "abort",
        () => {
          pages.classList.remove("parapdf-no-copy");
          if (scroller === nextScroller) scroller = null;
          if (content === pages) content = null;
        },
        { once: true },
      );
    },
  });
  return () => {
    detachExtension();
    scroller?.removeEventListener("copy", onCopy);
    scroller?.removeEventListener("cut", onCopy);
    content?.classList.remove("parapdf-no-copy");
    scroller = null;
    content = null;
  };
}
