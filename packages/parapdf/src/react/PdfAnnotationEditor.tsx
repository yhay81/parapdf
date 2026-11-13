"use client";

import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { attachAnnotationEditing } from "../features/annotations.ts";
import type { AnnotationLabels, AnnotationTool } from "../pdfjs/editor-types.ts";
import type { Viewer } from "../view/viewer.ts";
import { type AnnotationToolBinding, annotationSlot, bindAnnotationTool } from "./annotations.ts";
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
export function PdfAnnotationEditor({
  viewer: externalViewer,
  labels,
  tool,
  defaultTool,
  onToolChange,
}: PdfAnnotationEditorProps) {
  const viewer = useOptionalViewer(externalViewer);
  const slot = annotationSlot(viewer);
  const initialLabels = useRef(labels);
  initialLabels.current = labels;
  const bindingRef = useRef<AnnotationToolBinding>({ tool, defaultTool, onToolChange });
  const controllerRef = useRef<ReturnType<typeof bindAnnotationTool> | null>(null);
  const [, reconcile] = useReducer((count: number) => count + 1, 0);

  useLayoutEffect(() => slot.mount(attachAnnotationEditing, initialLabels.current), [slot]);

  useLayoutEffect(() => {
    slot.updateLabels(labels);
    bindingRef.current = { tool, defaultTool, onToolChange };
    controllerRef.current?.applyControlled(tool);
  });

  useEffect(() => {
    const controller = bindAnnotationTool(viewer, slot, () => bindingRef.current, reconcile);
    controllerRef.current = controller;
    controller.applyControlled(bindingRef.current.tool);
    return () => {
      controllerRef.current = null;
      controller.disconnect();
    };
  }, [slot, viewer]);

  return (
    <style href="parapdf-editor" precedence="parapdf">
      {EDITOR_CSS}
    </style>
  );
}
