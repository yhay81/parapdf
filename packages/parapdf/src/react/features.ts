"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type ReadableStore, Store } from "../document/store.ts";
import type { AnnotationEditing } from "../features/annotations.ts";
import type { FormLayers } from "../features/forms/layers.ts";
import { enforcePermissions } from "../features/permissions.ts";
import type { AnnotationLabels } from "../pdfjs/editor.ts";
import { closeViewer, Viewer } from "../view/viewer.ts";

/**
 * The features `<PdfViewer>` loads for options that change how pages are
 * drawn, null until they load and when the option is off.
 */
export interface LoadedFeatures {
  formLayers: FormLayers | null;
  annotations: AnnotationEditing | null;
}

/** The options of `<PdfViewer>` that attach features to its viewer. */
export interface FeatureOptions {
  forms: boolean;
  annotationEditing: boolean;
  annotationLabels: Partial<AnnotationLabels> | undefined;
  enforcePermissions: boolean;
}

const OFF: FeatureOptions = {
  forms: false,
  annotationEditing: false,
  annotationLabels: undefined,
  enforcePermissions: false,
};

/** What each viewer's feature options attached, and how to take it off. */
interface Attached {
  readonly loaded: Store<LoadedFeatures>;
  options: FeatureOptions;
  /** Stops following permissions. */
  unenforce: (() => void) | null;
  /** Each option's attachment, bumped when it is turned off or on again. */
  formsTurn: number;
  annotationsTurn: number;
}

const attached = new WeakMap<Viewer, Attached>();

function attachedTo(viewer: Viewer): Attached {
  let entry = attached.get(viewer);
  if (!entry) {
    entry = {
      loaded: new Store<LoadedFeatures>({ formLayers: null, annotations: null }),
      options: OFF,
      unenforce: null,
      formsTurn: 0,
      annotationsTurn: 0,
    };
    attached.set(viewer, entry);
  }
  return entry;
}

/** The features loaded for `viewer`'s options. */
export function loadedFeatures(viewer: Viewer): ReadableStore<LoadedFeatures> {
  return attachedTo(viewer).loaded;
}

/**
 * Attach and detach the features `options` ask of `viewer`, as they change.
 * Those that change how pages are drawn load first; while they load, the
 * next document's first layout waits for them. They stay while the
 * viewer's viewport unmounts, and go with the viewer (`useViewer()`).
 */
export function setFeatureOptions(viewer: Viewer, options: FeatureOptions): void {
  const entry = attachedTo(viewer);
  const previous = entry.options;
  entry.options = options;
  // Before the others, which follow permissions as they start.
  if (options.enforcePermissions !== previous.enforcePermissions) {
    entry.unenforce?.();
    entry.unenforce = options.enforcePermissions ? enforcePermissions(viewer) : null;
  }
  if (options.forms !== previous.forms) {
    const turn = ++entry.formsTurn;
    entry.loaded.get().formLayers?.detach();
    entry.loaded.set({ formLayers: null });
    if (options.forms) {
      viewer.defer(
        import("../features/forms/layers.ts").then(({ attachFormLayers }) => {
          if (entry.formsTurn === turn) entry.loaded.set({ formLayers: attachFormLayers(viewer) });
        }),
      );
    }
  }
  if (options.annotationEditing !== previous.annotationEditing) {
    const turn = ++entry.annotationsTurn;
    entry.loaded.get().annotations?.detach();
    entry.loaded.set({ annotations: null });
    if (options.annotationEditing) {
      viewer.defer(
        import("../features/annotations.ts").then(({ attachAnnotationEditing }) => {
          if (entry.annotationsTurn !== turn) return;
          const labels = entry.options.annotationLabels;
          entry.loaded.set({
            annotations: attachAnnotationEditing(viewer, labels ? { labels } : {}),
          });
        }),
      );
    }
  } else if (options.annotationLabels !== previous.annotationLabels) {
    entry.loaded.get().annotations?.setLabels(options.annotationLabels ?? {});
  }
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

/** Components holding each viewer, and the release waiting to run once none does. */
const holders = new WeakMap<Viewer, { count: number; timer: ReturnType<typeof setTimeout> }>();

/**
 * Hold `viewer` for a mounted component; returns the release. Once no
 * component holds it, after StrictMode's unmount and mount have had their
 * turn, its features detach and its document closes.
 */
function holdViewer(viewer: Viewer): () => void {
  let holder = holders.get(viewer);
  if (!holder) {
    holder = { count: 0, timer: setTimeout(() => {}, 0) };
    holders.set(viewer, holder);
  }
  const held = holder;
  held.count++;
  clearTimeout(held.timer);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--held.count > 0) return;
    held.timer = setTimeout(() => {
      if (held.count > 0) return;
      setFeatureOptions(viewer, OFF);
      closeViewer(viewer);
    }, 0);
  };
}

/**
 * A viewer, one viewport's controller and state, for the life of the
 * calling component: give it to a `<PdfViewer>` to show that viewer's
 * document, and to the hooks and functions that act through it. It keeps
 * its view and edits while its `<PdfViewer>` unmounts, and closes the
 * document once the component that created it unmounts.
 */
export function useViewer(): Viewer {
  const [viewer] = useState(() => new Viewer());
  useEffect(() => holdViewer(viewer), [viewer]);
  return viewer;
}
