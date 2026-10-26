"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { PdfSession } from "../document/pdf-session.ts";
import type { DocumentState } from "../document/registry.ts";
import type { ReadableStore } from "../document/store.ts";
import type { ViewerState } from "../view/state.ts";
import type { Viewer } from "../view/viewer.ts";

export const SessionContext = createContext<PdfSession | null>(null);

/** The viewer of the `<PdfViewer>` and the page an overlay is rendered in. */
export const PageContext = createContext<{ viewer: Viewer; pageIndex: number } | null>(null);

/** One slice of a store; the component renders again only when it changes. */
export function useSelected<T, S>(store: ReadableStore<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/**
 * The session of the nearest `<PdfDocument>`: its document state, the
 * answer to its password request, pdf.js's document, and its secondary data.
 */
export function useSession(): PdfSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <PdfDocument>");
  return session;
}

/**
 * One slice of the nearest `<PdfDocument>`'s document state: status,
 * error, password request, progress, page count, and permissions. The
 * selector must return a primitive or an existing reference so equal states
 * compare equal; the component then renders again only when that slice changes.
 */
export function useDocumentState<T>(selector: (state: DocumentState) => T): T {
  return useSelected(useSession().state, selector);
}

/**
 * One slice of `viewer`'s view state: its layout, mounted window, current
 * page, zoom, rotation, spread, scroll mode, and tool. The selector must
 * return a primitive or an existing reference, as for `useDocumentState()`;
 * scrolling then renders the component again only when that slice changes.
 */
export function useViewState<T>(viewer: Viewer, selector: (state: ViewerState) => T): T {
  return useSelected(viewer.store, selector);
}
