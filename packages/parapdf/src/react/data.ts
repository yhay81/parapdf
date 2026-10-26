"use client";

import { use, useSyncExternalStore } from "react";
import type {
  OutlineNode,
  PdfAttachment,
  PdfInitialView,
  PdfMetadata,
} from "../document/session.ts";
import type { ReadableStore } from "../document/store.ts";
import type { LayerState, PdfLayer } from "../pdfjs/layers.ts";
import { useSession } from "./context.ts";

/**
 * The outline (bookmarks) of the nearest `<PdfDocument>`'s document, empty
 * when it has none. Suspends until it is read: render it under a Suspense
 * boundary of the application's own, apart from the viewer.
 */
export function useOutline(): readonly OutlineNode[] {
  return use(useSession().outline());
}

/** Each page's label, such as "iv" or "A-3"; null when the document defines none. Suspends as `useOutline()` does. */
export function usePageLabels(): readonly string[] | null {
  return use(useSession().pageLabels());
}

/** The document's title, author, dates, and so on; null when they cannot be read. Suspends as `useOutline()` does. */
export function useMetadata(): PdfMetadata | null {
  return use(useSession().metadata());
}

/** Files embedded in the document; empty when it has none. Suspends as `useOutline()` does. */
export function useAttachments(): readonly PdfAttachment[] {
  return use(useSession().attachments());
}

/**
 * How the document asks to be shown when it opens: where, how its pages are
 * arranged, and which panel shows beside them (`pageMode`), which the
 * application may open; null when it cannot be read. Suspends as
 * `useOutline()` does.
 */
export function useInitialView(): PdfInitialView | null {
  return use(useSession().initialView());
}

const NO_LAYERS: ReadableStore<readonly PdfLayer[]> = {
  get: () => [],
  subscribe: () => () => {},
};

/** Each document's layers as a store, which every component reading them shares. */
const layerStores = new WeakMap<LayerState, ReadableStore<readonly PdfLayer[]>>();

function layerStore(state: LayerState): ReadableStore<readonly PdfLayer[]> {
  let store = layerStores.get(state);
  if (!store) {
    let layers = state.layers();
    const listeners = new Set<() => void>();
    // The layers live as long as their document, and so does this.
    state.subscribe(() => {
      layers = state.layers();
      for (const listener of [...listeners]) listener();
    }, new AbortController().signal);
    store = {
      get: () => layers,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    layerStores.set(state, store);
  }
  return store;
}

/**
 * The document's layers (optional content) in its own order, and which
 * show, as any viewer of it shows or hides them (`setLayerVisible()`);
 * empty when it has none. Suspends as `useOutline()` does.
 */
export function useLayers(): readonly PdfLayer[] {
  const state = use(useSession().layers());
  const store = state ? layerStore(state) : NO_LAYERS;
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
