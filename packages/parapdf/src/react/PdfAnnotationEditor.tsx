"use client";

import { memo, useLayoutEffect, useReducer, useRef } from "react";
import {
  type AnnotationEditorControlBinding,
  type AnnotationToolBinding,
  annotationSlot,
} from "../features/annotation-slot.ts";
import { attachAnnotationEditing } from "../features/annotations.ts";
import type { AnnotationLabels, AnnotationTool } from "../pdfjs/editor-types.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";
import { EDITOR_CSS } from "./editor-styles.ts";

export interface PdfAnnotationEditorProps {
  /**
   * The viewer on whose pages the reader creates and edits annotations;
   * without it, `<PdfAnnotationEditor>` uses `useViewer()`.
   */
  viewer?: Viewer;
  /** The accessible names of the annotation editor's controls, by default in English. */
  labels?: Partial<AnnotationLabels>;
  /**
   * The active annotation tool, controlled ("none", "highlight", "freetext",
   * "ink", "stamp", or "signature"). Tool changes initiated by the editor
   * (such as `addImage()` switching to `"stamp"` or Escape returning to
   * `"none"`) report through `onToolChange` and revert to `tool` unless the
   * application updates it.
   */
  tool?: AnnotationTool;
  /**
   * The annotation tool each opened document starts with while `tool` is not
   * controlled (default "none").
   */
  defaultTool?: AnnotationTool;
  /** Hears the active annotation tool change. */
  onToolChange?: (tool: AnnotationTool) => void;
}

/**
 * Enable annotation editing on the viewer's pages: highlights, text, drawings,
 * images, and signatures (`useAnnotations()`). `save()` and `print()` include
 * them along with those other viewers of the same document create.
 */
export const PdfAnnotationEditor = /*#__PURE__*/ memo(function PdfAnnotationEditor({
  viewer: externalViewer,
  labels,
  tool,
  defaultTool,
  onToolChange,
}: PdfAnnotationEditorProps) {
  const viewer = useOptionalViewer(externalViewer);
  const slot = annotationSlot(viewer);
  const initialRef = useRef<{
    labels: Partial<AnnotationLabels> | undefined;
    binding: AnnotationToolBinding;
  }>({ labels, binding: { tool, defaultTool, onToolChange } });
  initialRef.current = { labels, binding: { tool, defaultTool, onToolChange } };
  const controlRef = useRef<AnnotationEditorControlBinding | null>(null);
  const justBoundRef = useRef(false);
  const [reconcileCount, reconcile] = useReducer((count: number) => count + 1, 0);

  useLayoutEffect(() => {
    justBoundRef.current = true;
    const control = slot.bindControls(
      attachAnnotationEditing,
      initialRef.current.labels,
      initialRef.current.binding,
      reconcile,
    );
    controlRef.current = control;
    return () => {
      controlRef.current = null;
      control.disconnect();
    };
  }, [slot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcileCount intentionally re-runs sync when a controlled tool change was rejected by the application.
  useLayoutEffect(() => {
    if (justBoundRef.current) {
      justBoundRef.current = false;
      return;
    }
    controlRef.current?.sync(labels, { tool, defaultTool, onToolChange });
  }, [slot, reconcileCount, labels, tool, defaultTool, onToolChange]);

  return (
    <style href="parapdf-editor" precedence="parapdf">
      {EDITOR_CSS}
    </style>
  );
});
