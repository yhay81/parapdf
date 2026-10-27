"use client";

import type { DocumentSession } from "../document/session.ts";
import { type ReadableStore, Store } from "../document/store.ts";
import {
  type AnnotationEditingState,
  type AnnotationEditor,
  type AnnotationLabels,
  type AnnotationStyles,
  type AnnotationTool,
  createPdfjsAnnotationEditor,
  type SavedAnnotation,
  type SignatureInput,
} from "../pdfjs/editor.ts";
import { linked } from "../view/signals.ts";
import type { Viewer } from "../view/viewer.ts";
import { permits } from "./permissions.ts";

export interface AnnotationEditingOptions {
  /** The accessible names of the editor's controls, by default in English. */
  labels?: Partial<AnnotationLabels>;
}

export interface AnnotationEditingStore {
  /** What a pointer does on the pages; see `setTool()`. */
  tool: AnnotationTool;
  /** Undo, redo, and the selection of the annotations edited; null until editing starts. */
  state: AnnotationEditingState | null;
  /** The style of each tool; null until editing starts. */
  styles: AnnotationStyles | null;
}

/**
 * The annotations the reader creates in one viewer: highlights, text,
 * drawings, images, and signatures. `save()` and `print()` include them, and
 * those every other viewer of the document creates; each viewer shows its own.
 */
export interface AnnotationEditing {
  readonly store: ReadableStore<AnnotationEditingStore>;
  /**
   * Choose what a pointer does on the pages: "highlight" highlights the
   * text the reader selects, or, dragged outside text, draws a highlight
   * freehand; "freetext" adds text where the reader clicks; "ink" draws;
   * "stamp" and "signature" select and move images and signatures, which
   * `addImage()` and `addSignature()` add. With any of them, the reader can
   * select, move, resize, and delete the annotations created, and keys undo
   * and redo. "none" leaves them shown but out of reach.
   */
  setTool(tool: AnnotationTool): Promise<void>;
  /**
   * Restyle the selected annotations, or, with none selected, the next
   * ones `tool` creates, as pdf.js's toolbar of that tool does. The store's
   * `styles` shows the result.
   */
  setStyle<T extends keyof AnnotationStyles>(tool: T, style: Partial<AnnotationStyles[T]>): void;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  selectAll(): void;
  /**
   * Add an image, from a Blob or a URL the page may fetch, to page
   * `pageIndex` (default: the current page), in the middle of its visible
   * part, selected so that the reader can move and resize it. `altText`
   * describes it to assistive technology, in the PDF too. Switches to the
   * "stamp" tool. Resolves false when the image cannot be added or a newer
   * tool choice cancels it while its image loads.
   */
  addImage(
    image: Blob | string,
    options?: { pageIndex?: number; altText?: string },
  ): Promise<boolean>;
  /**
   * Add a signature to page `pageIndex` (default: the current page) as
   * `addImage()` adds an image: typed text, an image, or drawn strokes, as
   * outlines. `description` names it for assistive technology. Switches to
   * the "signature" tool. Resolves false for empty or untraceable signatures,
   * or when a newer tool choice cancels it while it loads.
   */
  addSignature(
    signature: SignatureInput,
    options?: { pageIndex?: number; description?: string },
  ): Promise<boolean>;
  /**
   * Every annotation the reader created in this viewer, on any page, mounted
   * or not, as JSON-compatible data to keep and give back to `import()`. The
   * text being typed counts once the reader commits it. Empty until editing
   * starts.
   */
  export(): SavedAnnotation[];
  /**
   * Add annotations `export()` gave, where they were, without an undo step:
   * say, after the same document opens again. Resolves with how many were
   * added; 0 until editing starts.
   */
  import(annotations: readonly SavedAnnotation[]): Promise<number>;
  /**
   * Name the editor's controls with `labels` from now on: an editor already
   * started starts again with them, keeping the annotations created.
   */
  setLabels(labels: Partial<AnnotationLabels>): void;
  /** Stop editing: the annotations created go, and the pages get no editor layers. */
  detach(): void;
}

/** The editor's controls and annotations as pdf.js's English strings name them. */
export const ANNOTATION_LABELS: AnnotationLabels = {
  highlight: "Highlight editor",
  freeText: "Text Editor",
  freeTextPlaceholder: "Start typing…",
  ink: "Drawing editor",
  stamp: "Image editor",
  signature: "Signature editor",
  removeHighlight: "Remove highlight",
  removeFreeText: "Remove text",
  removeInk: "Remove drawing",
  removeStamp: "Remove image",
  removeSignature: "Remove signature",
  color: "Change color",
  colors: "Color choices",
  textColor: "Change text color",
  inkColor: "Change drawing color",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  red: "Red",
  resizeTopLeft: "Top left corner — resize",
  resizeTopMiddle: "Top middle — resize",
  resizeTopRight: "Top right corner — resize",
  resizeMiddleRight: "Middle right — resize",
  resizeBottomRight: "Bottom right corner — resize",
  resizeBottomMiddle: "Bottom middle — resize",
  resizeBottomLeft: "Bottom left corner — resize",
  resizeMiddleLeft: "Middle left — resize",
};

const STOPPED: AnnotationEditingStore = { tool: "none", state: null, styles: null };

/**
 * Let the reader create annotations on `viewer`'s pages, once its document
 * is open in an attached viewport and permits annotating
 * (`enforcePermissions()`). A viewport that detaches keeps them for the
 * next one; closing the document removes them from it. `detach()` undoes it.
 */
export function attachAnnotationEditing(
  viewer: Viewer,
  options: AnnotationEditingOptions = {},
): AnnotationEditing {
  let labels = { ...ANNOTATION_LABELS, ...options.labels };
  const store = new Store<AnnotationEditingStore>(STOPPED);
  /** Edits the open document's annotations once the document and the viewport are there. */
  let editor: AnnotationEditor | null = null;
  /**
   * Aborted when editing stops, which ends the editor's start while its
   * code loads, and what the editor reports afterwards.
   */
  let control: AbortController | null = null;
  /** The page the editor was last told is current. */
  let editorPage = -1;
  /** Annotations kept while no viewport is attached, which the next one shows again. */
  let kept: SavedAnnotation[] | null = null;
  /**
   * Removes the kept annotations from the document's storage, where they
   * stay meanwhile: other viewers save and print them.
   */
  let forgetKept: (() => void) | null = null;
  let open: { session: DocumentSession; signal: AbortSignal } | null = null;
  let viewport: { scroller: HTMLElement; content: HTMLElement } | null = null;

  const showTool = (tool: AnnotationTool) => {
    store.set({ tool });
    // Links and comments are out of reach while a tool is chosen, as in pdf.js's viewer.
    viewer.content?.classList.toggle("parapdf-annotating", tool !== "none");
    viewer.claimPointer(tool !== "none");
  };

  /** Start editing, with the annotations a viewport that detached left. */
  const start = () => {
    if (editor || control || !open || !viewport || open.signal.aborted) return;
    if (!permits(viewer, "annotate")) return;
    const { session, signal: work } = open;
    const { scroller, content } = viewport;
    const { layout, rotation, scale } = viewer.store.get();
    // Stopping editing aborts it, and so do the viewport detaching and the
    // document closing.
    const started = linked(work);
    const { signal } = started;
    control = started;
    let created: AnnotationEditor | null = null;
    const editing = createPdfjsAnnotationEditor(
      session.pdfjs.pdfjs,
      session.proxy,
      (index) => session.page(index),
      {
        container: scroller,
        pages: content,
        labels,
        ...(viewer.pageColors ? { pageColors: viewer.pageColors } : {}),
        scale: layout?.scale ?? scale,
        rotation,
        onStateChange: (state) => {
          if (created && !signal.aborted) store.set({ state });
        },
        onStylesChange: (styles) => {
          if (created && !signal.aborted) store.set({ styles });
        },
        onToolChange: (tool) => {
          if (created && !signal.aborted) showTool(tool);
        },
        // Pages leave out the annotations of the file being edited, and
        // then those changed.
        onRedraw: () => {
          if (created && !signal.aborted) viewer.invalidateDrawings();
        },
      },
    );
    created = editing;
    editor = editing;
    const { currentPage } = viewer.store.get();
    editorPage = currentPage;
    editing.setCurrentPage(currentPage);
    viewer.setAnnotationEditor(editing);
    // Saving and printing from any viewer of the document finish what is typed here.
    session.onCommit(() => editing.commit(), signal);
    store.set({ tool: "none", state: editing.state, styles: editing.styles });
    const restore = kept;
    kept = null;
    // The new editor adds them again, under ids of its own.
    forgetKept?.();
    forgetKept = null;
    if (restore?.length) {
      editing.import(restore).catch((error: unknown) => {
        if (!signal.aborted) console.error("restoring annotations failed", error);
      });
    }
  };

  /**
   * Stop editing; with `keep`, the next editor shows its annotations again,
   * as it does annotations kept while this one was starting, and the
   * document keeps them meanwhile.
   */
  const stop = (keep: boolean) => {
    const stopped = editor;
    control?.abort();
    control = null;
    if (!keep) {
      kept = null;
      forgetKept?.();
      forgetKept = null;
    }
    if (!stopped) return;
    if (keep) {
      stopped.commit();
      kept = stopped.export();
    }
    editor = null;
    viewer.setAnnotationEditor(null);
    const forget = stopped.destroy(keep);
    if (keep) forgetKept = forget;
    viewer.content?.classList.remove("parapdf-annotating");
    viewer.claimPointer(false);
    store.set(STOPPED);
  };

  /** The editor follows the zoom, turns, and the current page as they are published. */
  const followView = () => {
    if (!editor) return;
    const { layout, currentPage } = viewer.store.hot.get();
    if (layout) editor.setView(layout.scale, layout.rotation);
    if (currentPage !== editorPage) {
      editorPage = currentPage;
      editor.setCurrentPage(currentPage);
    }
  };
  const unsubscribe = viewer.store.hot.subscribe(followView);

  const detachExtension = viewer.extend({
    ready(session, signal) {
      open = { session, signal };
      // The viewport detaching (`detaching`) keeps the annotations, and the
      // document closing (`closed`) forgets them, before this aborts.
      signal.addEventListener("abort", () => stop(true), { once: true });
      start();
    },
    detaching() {
      // While the pages are still there to commit what is being typed.
      stop(true);
    },
    viewport(scroller, content, signal) {
      viewport = { scroller, content };
      signal.addEventListener(
        "abort",
        () => {
          if (viewport?.content === content) viewport = null;
        },
        { once: true },
      );
      start();
    },
    closed() {
      stop(false);
      open = null;
    },
  });

  /** Page `requested`, or the current one, once its annotations can be edited; null if never. */
  const editablePage = async (requested: number | undefined): Promise<number | null> => {
    const renderer = viewer.renderer;
    const signal = viewer.workSignal;
    const { currentPage, first, last } = viewer.store.get();
    const pageCount = viewer.session?.pageCount ?? 0;
    const pageIndex = requested ?? currentPage;
    if (!renderer || !signal || !editor || pageIndex < 0 || pageIndex >= pageCount) {
      return null;
    }
    if (pageIndex < first || pageIndex > last) viewer.goToPage(pageIndex);
    return (await renderer.whenEditable(pageIndex)) && !signal.aborted ? pageIndex : null;
  };

  return {
    store,
    async setTool(tool) {
      const current = editor;
      if (!current) return;
      showTool(tool);
      await current.setTool(tool);
    },
    setStyle(tool, style) {
      editor?.setStyle(tool, style);
    },
    undo() {
      editor?.undo();
    },
    redo() {
      editor?.redo();
    },
    deleteSelected() {
      editor?.deleteSelected();
    },
    selectAll() {
      editor?.selectAll();
    },
    async addImage(image, { pageIndex, altText } = {}) {
      const page = await editablePage(pageIndex);
      const current = editor;
      if (page === null || !current) return false;
      showTool("stamp");
      return current.addImage(page, image, altText);
    },
    async addSignature(signature, { pageIndex, description } = {}) {
      const page = await editablePage(pageIndex);
      const current = editor;
      if (page === null || !current) return false;
      showTool("signature");
      return current.addSignature(page, signature, description);
    },
    export() {
      return editor?.export() ?? [];
    },
    async import(annotations) {
      return (await editor?.import(annotations)) ?? 0;
    },
    setLabels(next) {
      labels = { ...ANNOTATION_LABELS, ...next };
      if (!editor) return;
      stop(true);
      start();
    },
    detach() {
      stop(false);
      unsubscribe();
      detachExtension();
      open = null;
      viewport = null;
    },
  };
}
