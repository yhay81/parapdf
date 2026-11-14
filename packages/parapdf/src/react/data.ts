"use client";

import { use, useSyncExternalStore } from "react";
import type {
  OutlineNode,
  PdfAttachment,
  PdfComment,
  PdfInitialView,
  PdfMetadata,
} from "../document/session.ts";
import type { PdfLayer } from "../pdfjs/layers.ts";
import { useSessionData } from "./context.ts";

/**
 * The outline (bookmarks) of the nearest `<PdfDocument>`'s document, empty
 * when it has none. Suspends until it is read: render it under a Suspense
 * boundary of the application's own, apart from the viewer. The server
 * reads no document, so there it throws, and the boundary renders its
 * fallback until the browser renders what it holds.
 */
export function useOutline(): readonly OutlineNode[] {
  return use(useSessionData("useOutline").read("outline", (session) => session.outline(), []));
}

/** Each page's label, such as "iv" or "A-3"; null when the document defines none. Suspends as `useOutline()` does. */
export function usePageLabels(): readonly string[] | null {
  return use(
    useSessionData("usePageLabels").read("pageLabels", (session) => session.pageLabels(), null),
  );
}

/** The document's title, author, dates, and so on; null when they cannot be read. Suspends as `useOutline()` does. */
export function useMetadata(): PdfMetadata | null {
  return use(useSessionData("useMetadata").read("metadata", (session) => session.metadata(), null));
}

/** Files embedded in the document; empty when it has none. Suspends as `useOutline()` does. */
export function useAttachments(): readonly PdfAttachment[] {
  return use(
    useSessionData("useAttachments").read("attachments", (session) => session.attachments(), []),
  );
}

/**
 * The file's comments, in page order: its markup annotations that carry one
 * (a note's text, another markup's popup note); empty when it has none.
 * Those the viewers' editors add are `useAnnotations()`'s. Suspends
 * as `useOutline()` does.
 */
export function useComments(): readonly PdfComment[] {
  return use(useSessionData("useComments").read("comments", (session) => session.comments(), []));
}

/**
 * How the document asks to be shown when it opens: where, how its pages are
 * arranged, and which panel shows beside them (`pageMode`), which the
 * application may open; null when it cannot be read. Suspends as
 * `useOutline()` does.
 */
export function useInitialView(): PdfInitialView | null {
  return use(
    useSessionData("useInitialView").read("initialView", (session) => session.initialView(), null),
  );
}

const EMPTY_LAYERS: readonly PdfLayer[] = [];
const noopSubscribe = (): (() => void) => () => {};
const getEmptyLayers = (): readonly PdfLayer[] => EMPTY_LAYERS;

/**
 * The document's layers (optional content) in its own order, and which
 * show, as `setLayerVisible()` shows or hides them across every viewer of
 * the document; empty when it has none. Suspends as `useOutline()` does.
 */
export function useLayers(): readonly PdfLayer[] {
  const state = use(
    useSessionData("useLayers").read("layers", (session) => session.layers(), null),
  );
  return useSyncExternalStore(
    state ? state.subscribe : noopSubscribe,
    state ? state.layers : getEmptyLayers,
    getEmptyLayers,
  );
}
