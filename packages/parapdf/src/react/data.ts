"use client";

import { use, useSyncExternalStore } from "react";
import type {
  OutlineNode,
  PdfAttachment,
  PdfComment,
  PdfInitialView,
  PdfMetadata,
} from "../document/session.ts";
import type { ReadableStore } from "../document/store.ts";
import type { LayerState, PdfLayer } from "../pdfjs/layers.ts";
import { useSessionData } from "./context.ts";

/**
 * The outline (bookmarks) of the nearest `<PdfDocument>`'s document, empty
 * when it has none. Suspends until it is read: render it under a Suspense
 * boundary of the application's own, apart from the viewer. The server
 * reads no document, so there it throws, and the boundary renders its
 * fallback until the browser renders what it holds.
 */
export function useOutline(): readonly OutlineNode[] {
  return use(useSessionData("useOutline").outline());
}

/** Each page's label, such as "iv" or "A-3"; null when the document defines none. Suspends as `useOutline()` does. */
export function usePageLabels(): readonly string[] | null {
  return use(useSessionData("usePageLabels").pageLabels());
}

/** The document's title, author, dates, and so on; null when they cannot be read. Suspends as `useOutline()` does. */
export function useMetadata(): PdfMetadata | null {
  return use(useSessionData("useMetadata").metadata());
}

/** Files embedded in the document; empty when it has none. Suspends as `useOutline()` does. */
export function useAttachments(): readonly PdfAttachment[] {
  return use(useSessionData("useAttachments").attachments());
}

/**
 * The file's comments, in page order: its markup annotations that carry one
 * (a note's text, another markup's popup note); empty when it has none.
 * Those the viewers' editors add are `useAnnotationEditing()`'s. Suspends
 * as `useOutline()` does.
 */
export function useComments(): readonly PdfComment[] {
  return use(useSessionData("useComments").comments());
}

/**
 * How the document asks to be shown when it opens: where, how its pages are
 * arranged, and which panel shows beside them (`pageMode`), which the
 * application may open; null when it cannot be read. Suspends as
 * `useOutline()` does.
 */
export function useInitialView(): PdfInitialView | null {
  return use(useSessionData("useInitialView").initialView());
}

/** The layers a session's read gave, as a store: null until read. */
interface LayerStore extends ReadableStore<readonly PdfLayer[] | null> {
  readonly read: Promise<readonly PdfLayer[]>;
}

/** Each read of a session's layers as a store, which every component reading them shares. */
const layerStores = new WeakMap<Promise<LayerState | null>, LayerStore>();

function layerStore(reading: Promise<LayerState | null>): LayerStore {
  let store = layerStores.get(reading);
  if (!store) {
    let layers: readonly PdfLayer[] | null = null;
    const listeners = new Set<() => void>();
    const publish = (next: readonly PdfLayer[]) => {
      layers = next;
      for (const listener of [...listeners]) listener();
    };
    const read = reading.then((state) => {
      // The layers live as long as their document, and so does this.
      state?.subscribe(() => publish(state.layers()), new AbortController().signal);
      publish(state?.layers() ?? []);
      return layers ?? [];
    });
    store = {
      read,
      get: () => layers,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    layerStores.set(reading, store);
  }
  return store;
}

/**
 * The document's layers (optional content) in its own order, and which
 * show, as any viewer of it shows or hides them (`setLayerVisible()`);
 * empty when it has none. Suspends as `useOutline()` does.
 */
export function useLayers(): readonly PdfLayer[] {
  const store = layerStore(useSessionData("useLayers").layers());
  const layers = useSyncExternalStore(store.subscribe, store.get, store.get);
  // Read at every render, so that React finds the same promise at the same
  // place each time it renders this again; it suspends until the first read.
  const read = use(store.read);
  return layers ?? read;
}
