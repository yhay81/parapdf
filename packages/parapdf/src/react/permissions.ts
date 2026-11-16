"use client";

import {
  ALL_PERMITTED,
  type Permission,
  type PermitsState,
  permitsStoreOf,
} from "../features/permissions.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreSlice } from "./context.ts";

export type { Permission, PermitsState } from "../features/permissions.ts";

const getAllPermitted = (): PermitsState => ALL_PERMITTED;

const PERMISSION_SELECTORS: {
  readonly [K in Permission]: (state: PermitsState) => boolean;
} = {
  print: (state) => state.print,
  copy: (state) => state.copy,
  annotate: (state) => state.annotate,
  fillForms: (state) => state.fillForms,
};

/**
 * Whether `viewer` (or the nearest `<PdfView>` or `<PdfDocument>`'s viewer)
 * permits `what` (`"print"`, `"copy"`, `"annotate"`, or `"fillForms"`), or all
 * four permissions as a field-tracked `PermitsState` when `what` is omitted.
 * Always `true` while `<PdfPermissions />` is not mounted or before the
 * document's permissions load, updating reactively as documents open or close
 * and as `<PdfPermissions />` mounts or unmounts.
 */
export function usePermits(what: Permission, viewer?: Viewer): boolean;
export function usePermits(viewer?: Viewer): PermitsState;
export function usePermits(
  whatOrViewer?: Permission | Viewer,
  maybeViewer?: Viewer,
): boolean | PermitsState {
  const isPermission = typeof whatOrViewer === "string";
  const resolved = useOptionalViewer(isPermission ? maybeViewer : whatOrViewer);
  const selector = isPermission ? PERMISSION_SELECTORS[whatOrViewer] : undefined;
  return useStoreSlice(permitsStoreOf(resolved), getAllPermitted, selector);
}
