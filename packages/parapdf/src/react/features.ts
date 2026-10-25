"use client";

import { useSyncExternalStore } from "react";
import type { AnnotationEditing } from "../features/annotations.ts";
import type { FormLayers } from "../features/forms/layers.ts";
import { type ReadableStore, Store } from "../view/state.ts";
import type { Viewer } from "../view/viewer.ts";

/**
 * The features `PdfDocument` loads for options that change how pages are
 * drawn, null until they load and when the option is off.
 */
export interface LoadedFeatures {
  formLayers: FormLayers | null;
  annotations: AnnotationEditing | null;
}

const loaded = new WeakMap<Viewer, Store<LoadedFeatures>>();

/** The features loaded for `viewer`'s options. */
export function loadedFeatures(viewer: Viewer): Store<LoadedFeatures> {
  let store = loaded.get(viewer);
  if (!store) {
    store = new Store<LoadedFeatures>({ formLayers: null, annotations: null });
    loaded.set(viewer, store);
  }
  return store;
}

/** One loaded feature of `viewer`; the component renders again once it loads. */
export function useLoadedFeature<K extends keyof LoadedFeatures>(
  viewer: Viewer,
  name: K,
): LoadedFeatures[K] {
  const store = loadedFeatures(viewer);
  return useSyncExternalStore(
    store.subscribe,
    () => store.get()[name],
    () => store.get()[name],
  );
}

/** A store's whole state, re-rendering on every change. */
export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
