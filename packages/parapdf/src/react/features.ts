"use client";

import { useSyncExternalStore } from "react";
import { type ReadableStore, Store } from "../document/store.ts";
import type { AnnotationEditing } from "../features/annotations.ts";
import type { FormLayers } from "../features/forms/layers.ts";
import { enforcePermissions } from "../features/permissions.ts";
import type { AnnotationLabels } from "../pdfjs/editor-types.ts";
import type { Viewer } from "../view/viewer.ts";

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
  /** Run the document's scripts in the form fields, with `forms`. */
  formScripts: boolean;
  annotationEditing: boolean;
  annotationLabels: Partial<AnnotationLabels> | undefined;
  enforcePermissions: boolean;
}

const OFF: FeatureOptions = {
  forms: false,
  formScripts: false,
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

/** Whether two `annotationLabels` name the controls alike: applications pass them inline. */
function sameLabels(
  a: Partial<AnnotationLabels> | undefined,
  b: Partial<AnnotationLabels> | undefined,
): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every(
    (key) => a?.[key as keyof AnnotationLabels] === b?.[key as keyof AnnotationLabels],
  );
}

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

/** Detach every feature `viewer`'s options attached, as the viewer closes. */
export function detachFeatures(viewer: Viewer): void {
  setFeatureOptions(viewer, OFF);
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
          if (entry.formsTurn !== turn) return;
          const scripts = entry.options.formScripts;
          entry.loaded.set({ formLayers: attachFormLayers(viewer, { scripts }) });
        }),
      );
    }
  } else if (options.formScripts !== previous.formScripts) {
    entry.loaded.get().formLayers?.setScripts(options.formScripts);
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
  } else if (!sameLabels(options.annotationLabels, previous.annotationLabels)) {
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
