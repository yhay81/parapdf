"use client";

import { type ReactNode, useEffect, useState } from "react";
import { preload } from "react-dom";
import { sourceKey } from "../document/registry.ts";
import type { PdfSource } from "../document/session.ts";
import { type InitialViewOptions, initialViewOpening } from "../features/initial-view.ts";
import { enforcePermissions } from "../features/permissions.ts";
import type { AnnotationLabels } from "../pdfjs/editor.ts";
import { documentRequestMode, preloadPdfjs } from "../pdfjs/loader.ts";
import { Viewer, type ViewerOptions } from "../view/viewer.ts";
import { AnnotationEditingContext, RuntimeContext } from "./context.ts";
import { loadedFeatures } from "./features.ts";

export interface PdfDocumentOptions extends Omit<ViewerOptions, "opening">, InitialViewOptions {
  /**
   * Follow what the document permits (default false, as in pdf.js): without
   * permission to copy, its text cannot be selected or copied, though it
   * stays readable by assistive technology and `getText()`; without
   * permission to print, `print()` fails; without permission to annotate,
   * annotations cannot be created, and form fields can be filled in only
   * with permission to fill forms. `permissions` tells the application.
   */
  enforcePermissions?: boolean;
  /**
   * Show form fields as HTML that the reader can fill in (default false: the
   * drawing shows them as they are). Typed values belong to the document,
   * which `save()` writes them into. Needs `annotationLayer`.
   * `usePdfFormChange()` hears what the reader enters. Its code loads only
   * when set, before the first page is drawn.
   */
  forms?: boolean;
  /**
   * Let the reader create highlights, text, drawings, images, and
   * signatures on the pages (default false); see `usePdfAnnotations()`.
   * `save()` writes them into the document, with those other viewers of it
   * create. Its code loads only when set, before the first page is drawn.
   */
  annotationEditing?: boolean;
  /** The accessible names of the editor's controls, by default in English. */
  annotationLabels?: Partial<AnnotationLabels>;
}

export interface PdfDocumentProps {
  /**
   * The document to show: its URL, `{ url }`, or `{ data }` with its bytes.
   * It reopens when its URL, request headers, or password change or, for
   * data, when the bytes are another object or the password changes; a new
   * object for the same URL keeps the open document.
   */
  source: string | PdfSource;
  /** Read once, when the component mounts; give it a new `key` to change them. */
  options?: PdfDocumentOptions;
  children?: ReactNode;
}

/** Opens `source` and provides the viewer to its children. */
export function PdfDocument({ source, options, children }: PdfDocumentProps) {
  // The runtime lives as long as the component; the options apply at creation.
  const [initial] = useState(() => options ?? {});
  const [runtime] = useState(() => {
    const opening = initialViewOpening(initial);
    return new Viewer(opening ? { ...initial, opening } : initial);
  });
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  if ("url" in resolved) {
    // The download starts now, and with server rendering as soon as the
    // browser reads the page's head, not once pdf.js has loaded: pdf.js's
    // request has this CORS mode and takes the preloaded response.
    const mode = documentRequestMode();
    if (mode) preload(resolved.url, { as: "fetch", crossOrigin: mode });
  }
  // pdf.js and its worker load while React renders and commits.
  preloadPdfjs();
  // Features the options ask for attach before the document opens; those
  // that change how pages are drawn load first, and the viewer waits for them.
  useEffect(() => {
    let active = true;
    const undo: (() => void)[] = [];
    const loaded = loadedFeatures(runtime);
    if (initial.enforcePermissions) undo.push(enforcePermissions(runtime));
    if (initial.forms) {
      runtime.defer(
        import("../features/forms/layers.ts").then(({ attachFormLayers }) => {
          if (!active) return;
          const formLayers = attachFormLayers(runtime);
          loaded.set({ formLayers });
          undo.push(() => {
            formLayers.detach();
            loaded.set({ formLayers: null });
          });
        }),
      );
    }
    if (initial.annotationEditing) {
      runtime.defer(
        import("../features/annotations.ts").then(({ attachAnnotationEditing }) => {
          if (!active) return;
          const annotations = attachAnnotationEditing(runtime, {
            ...(initial.annotationLabels ? { labels: initial.annotationLabels } : {}),
          });
          loaded.set({ annotations });
          undo.push(() => {
            annotations.detach();
            loaded.set({ annotations: null });
          });
        }),
      );
    }
    return () => {
      active = false;
      for (const detach of undo.splice(0).reverse()) detach();
    };
  }, [runtime, initial]);
  // One effect owns the document. StrictMode's mount-unmount-mount cycle and
  // quick remounts reuse the loaded document instead of loading it again.
  const key = sourceKey(resolved);
  // Viewers share a document whatever password opened it, but a new password
  // tries again, say after a wrong one failed it.
  const password = resolved.password;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the source, so an inline `{ url }` does not reopen the document at every render.
  useEffect(() => runtime.open(resolved), [runtime, key, password]);
  return (
    <RuntimeContext value={runtime}>
      <AnnotationEditingContext value={initial.annotationEditing ?? false}>
        {children}
      </AnnotationEditingContext>
    </RuntimeContext>
  );
}
