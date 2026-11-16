"use client";

import type { PdfSession } from "../document/pdf-session.ts";
import { type SaveControls, saveOf } from "../features/download.ts";
import { useOptionalSession, useStoreSlice } from "./context.ts";

export type { SaveControls } from "../features/download.ts";

/**
 * Save or download the document of `session`, or of the nearest
 * `<PdfDocument>`, with reactive `saving` state shared across every `useSave()`
 * consumer of that session. Called without a selector, it tracks the fields
 * read during rendering so components reading only `save` or `download` never
 * re-render while saving; called with `selector`, it compares the selected
 * value shallowly.
 */
export function useSave<T>(selector: (state: SaveControls) => T, session?: PdfSession): T;
export function useSave(session?: PdfSession): SaveControls;
export function useSave<T>(
  selectorOrSession?: ((state: SaveControls) => T) | PdfSession,
  maybeSession?: PdfSession,
): SaveControls | T {
  const isSelector = typeof selectorOrSession === "function";
  const resolved = useOptionalSession(isSelector ? maybeSession : selectorOrSession);
  const slot = saveOf(resolved);
  const selector = isSelector ? selectorOrSession : undefined;
  return useStoreSlice(slot.store, () => slot.initialControls, selector);
}
