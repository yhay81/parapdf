"use client";

import { useMemo } from "react";
import type { AnnotationEditing, AnnotationEditingStore } from "../features/annotations.ts";
import type {
  AnnotationAltText,
  AnnotationStyles,
  AnnotationTool,
  SavedAnnotation,
  SignatureInput,
} from "../pdfjs/editor-types.ts";
import type { Viewer } from "../view/viewer.ts";
import { useStore } from "./context.ts";
import { useLoadedFeature } from "./features.ts";

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
const STOPPED_STORE = { get: () => STOPPED, subscribe: () => () => {} };

/**
 * `viewer`'s annotation editing, whose store reads its state as it is;
 * null until its code loads, and without the `annotationEditing` option.
 */
export function useAnnotationEditing(viewer: Viewer): AnnotationEditing | null {
  return useLoadedFeature(viewer, "annotations");
}

/**
 * The annotations the reader creates in `viewer`, and their tools; null
 * until the editing code loads, and without the `annotationEditing` option.
 */
export function useAnnotations(viewer: Viewer): AnnotationControls | null {
  const editing = useAnnotationEditing(viewer);
  const state = useStore(editing?.store ?? STOPPED_STORE);
  return useMemo(
    () =>
      editing
        ? {
            ...state,
            setTool: (tool) => editing.setTool(tool),
            setStyle: (tool, style) => editing.setStyle(tool, style),
            undo: () => editing.undo(),
            redo: () => editing.redo(),
            deleteSelected: () => editing.deleteSelected(),
            selectAll: () => editing.selectAll(),
            setComment: (comment) => editing.setComment(comment),
            setAltText: (altText) => editing.setAltText(altText),
            addImage: (image, options) => editing.addImage(image, options),
            addSignature: (signature, options) => editing.addSignature(signature, options),
            export: () => editing.export(),
            import: (annotations) => editing.import(annotations),
          }
        : null,
    [editing, state],
  );
}
