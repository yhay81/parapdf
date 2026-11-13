"use client";

import { Store } from "../document/store.ts";
import type {
  AnnotationEditing,
  AnnotationEditingOptions,
  AnnotationEditingStore,
} from "../features/annotations.ts";
import type {
  AnnotationAltText,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
  SavedAnnotation,
  SignatureInput,
} from "../pdfjs/editor-types.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { useOptionalViewer, useStore, useStoreSlice } from "./context.ts";

export interface AnnotationControls extends AnnotationEditingStore {
  setTool(tool: AnnotationTool): Promise<void>;
  setStyle<T extends keyof AnnotationStyles>(tool: T, style: Partial<AnnotationStyles[T]>): void;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  selectAll(): void;
  setComment(comment: string | null): boolean;
  setAltText(altText: AnnotationAltText): boolean;
  addImage(
    image: Blob | string,
    options?: { pageIndex?: number; altText?: string },
  ): Promise<boolean>;
  addSignature(
    signature: SignatureInput,
    options?: { pageIndex?: number; description?: string },
  ): Promise<boolean>;
  export(): SavedAnnotation[];
  import(annotations: readonly SavedAnnotation[]): Promise<number>;
}

const STOPPED: AnnotationEditingStore = { tool: "none", state: null, styles: null };

/** Whether two `labels` objects name the controls alike: applications pass them inline. */
export function sameAnnotationLabels(
  a: Partial<AnnotationLabels> | undefined,
  b: Partial<AnnotationLabels> | undefined,
): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every(
    (key) => a?.[key as keyof AnnotationLabels] === b?.[key as keyof AnnotationLabels],
  );
}

export interface AnnotationSlot {
  readonly editingStore: Store<{ editing: AnnotationEditing | null }>;
  readonly controlsStore: Store<AnnotationControls>;
  readonly initialControls: AnnotationControls;
  mounts: number;
  labels: Partial<AnnotationLabels> | undefined;
  editing: AnnotationEditing | null;
  unsubscribeEditing: (() => void) | null;
  removeViewportGuard: (() => void) | null;
  mount(
    attach: (viewer: ViewerController, options?: AnnotationEditingOptions) => AnnotationEditing,
    labels: Partial<AnnotationLabels> | undefined,
  ): () => void;
  updateLabels(labels: Partial<AnnotationLabels> | undefined): void;
  detachNow(): void;
}

const slots = new WeakMap<ViewerController, AnnotationSlot>();

export function annotationSlot(viewer: ViewerController): AnnotationSlot {
  const existing = slots.get(viewer);
  if (existing) return existing;
  const editingStore = new Store<{ editing: AnnotationEditing | null }>({ editing: null });
  const methods: Omit<AnnotationControls, keyof AnnotationEditingStore> = {
    setTool: (tool) => (slot.editing ? slot.editing.setTool(tool) : Promise.resolve()),
    setStyle: (tool, style) => slot.editing?.setStyle(tool, style),
    undo: () => slot.editing?.undo(),
    redo: () => slot.editing?.redo(),
    deleteSelected: () => slot.editing?.deleteSelected(),
    selectAll: () => slot.editing?.selectAll(),
    setComment: (comment) => slot.editing?.setComment(comment) ?? false,
    setAltText: (altText) => slot.editing?.setAltText(altText) ?? false,
    addImage: (image, options) =>
      slot.editing ? slot.editing.addImage(image, options) : Promise.resolve(false),
    addSignature: (signature, options) =>
      slot.editing ? slot.editing.addSignature(signature, options) : Promise.resolve(false),
    export: () => slot.editing?.export() ?? [],
    import: (annotations) => (slot.editing ? slot.editing.import(annotations) : Promise.resolve(0)),
  };
  const initialControls: AnnotationControls = { ...STOPPED, ...methods };
  const controlsStore = new Store<AnnotationControls>(initialControls);

  const detachNow = () => {
    if (!slot.editing) return;
    slot.unsubscribeEditing?.();
    slot.unsubscribeEditing = null;
    slot.removeViewportGuard?.();
    slot.removeViewportGuard = null;
    const current = slot.editing;
    slot.editing = null;
    slot.labels = undefined;
    current.detach();
    editingStore.set({ editing: null });
    controlsStore.set(initialControls);
  };

  const detachIfUnmounted = () => {
    if (slot.mounts === 0 && viewer.scroller !== null) detachNow();
  };

  const slot: AnnotationSlot = {
    editingStore,
    controlsStore,
    initialControls,
    mounts: 0,
    labels: undefined,
    editing: null,
    unsubscribeEditing: null,
    removeViewportGuard: null,
    mount(attach, labels) {
      slot.mounts++;
      if (!slot.editing) {
        // A sibling editor can mount after the viewport in the same commit.
        // Wait for its layout effect before discarding the kept annotations.
        slot.removeViewportGuard = viewer.extend({
          viewport() {
            if (slot.mounts === 0) queueMicrotask(detachIfUnmounted);
          },
        });
        slot.labels = labels;
        const created = attach(viewer, labels ? { labels } : {});
        slot.editing = created;
        const sync = () => {
          const { tool, state, styles } = created.store.get();
          controlsStore.set({ tool, state, styles });
        };
        sync();
        slot.unsubscribeEditing = created.store.subscribe(sync);
        editingStore.set({ editing: created });
      } else if (!sameAnnotationLabels(labels, slot.labels)) {
        slot.labels = labels;
        slot.editing.setLabels(labels ?? {});
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        slot.mounts--;
        if (slot.mounts > 0) return;
        // Defer past the commit so StrictMode remounts and simultaneous
        // viewport hides (<Activity> or unmounting <PdfViewer>) keep the
        // editor's snapshot on the viewer, while removing <PdfAnnotationEditor>
        // from an attached viewport detaches editing immediately.
        queueMicrotask(detachIfUnmounted);
      };
    },
    updateLabels(labels) {
      if (!slot.editing || sameAnnotationLabels(labels, slot.labels)) return;
      slot.labels = labels;
      slot.editing.setLabels(labels ?? {});
    },
    detachNow,
  };
  slots.set(viewer, slot);
  return slot;
}

/**
 * Annotation editing in `viewer`, or in the viewer of the nearest
 * `<PdfView>` or `<PdfDocument>`, whose store reads its state as it is; null
 * without `<PdfAnnotationEditor>`.
 */
export function useAnnotationEditing(viewer?: Viewer): AnnotationEditing | null {
  return useStore(annotationSlot(useOptionalViewer(viewer)).editingStore).editing;
}

/**
 * The annotations the reader creates in `viewer`, or in the viewer of the
 * nearest `<PdfView>` or `<PdfDocument>`, and their tools. Always returns an
 * `AnnotationControls` object (whose `state` and `styles` are null until
 * `<PdfAnnotationEditor>` starts editing an open document) and tracks which
 * fields the component reads so components reading only methods never
 * re-render on annotation changes.
 */
export function useAnnotations(viewer?: Viewer): AnnotationControls {
  const slot = annotationSlot(useOptionalViewer(viewer));
  return useStoreSlice(slot.controlsStore, () => slot.initialControls);
}

export interface AnnotationToolBinding {
  tool?: AnnotationTool | undefined;
  defaultTool?: AnnotationTool | undefined;
  onToolChange?: ((tool: AnnotationTool) => void) | undefined;
}

/**
 * Keep `slot`'s active tool synchronized with `<PdfAnnotationEditor>`'s
 * controlled `tool`, per-session `defaultTool`, and `onToolChange`.
 */
export function bindAnnotationTool(
  viewer: ViewerController,
  slot: AnnotationSlot,
  getBinding: () => AnnotationToolBinding,
  onDiverge: () => void,
): { applyControlled(tool: AnnotationTool | undefined): void; disconnect(): void } {
  let reported: AnnotationTool | null = null;
  let appliedDefaultSession: unknown = null;
  let wasOpen = slot.controlsStore.get().state !== null;

  const sync = (initializing: boolean) => {
    const current = slot.controlsStore.get();
    const { tool: controlled, defaultTool: initial, onToolChange } = getBinding();
    if (current.state === null) {
      wasOpen = false;
      if (!viewer.session) appliedDefaultSession = null;
      return;
    }
    const justOpened = !wasOpen;
    wasOpen = true;
    if (controlled !== undefined) {
      if (justOpened) {
        reported = controlled;
        if (current.tool !== controlled) void slot.editing?.setTool(controlled);
        return;
      }
      const last = reported ?? current.tool;
      if (!initializing && current.tool !== last) {
        reported = current.tool;
        onToolChange?.(current.tool);
      } else {
        reported = current.tool;
      }
      if (current.tool !== controlled) onDiverge();
      return;
    }
    if (
      initial !== undefined &&
      initial !== "none" &&
      viewer.session !== null &&
      appliedDefaultSession !== viewer.session
    ) {
      appliedDefaultSession = viewer.session;
      reported = initial;
      void slot.editing?.setTool(initial);
      return;
    }
    const last = reported ?? "none";
    if (current.tool !== last) {
      reported = current.tool;
      if (!initializing) onToolChange?.(current.tool);
    }
  };

  sync(true);
  const unsubscribe = slot.controlsStore.subscribe(() => sync(false));

  return {
    applyControlled(tool) {
      if (tool === undefined) return;
      reported = tool;
      const current = slot.editing?.store.get();
      if (current && current.state !== null && current.tool !== tool) {
        void slot.editing?.setTool(tool);
      }
    },
    disconnect: unsubscribe,
  };
}
