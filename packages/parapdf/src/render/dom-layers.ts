"use client";

import type { DocumentSession } from "../document/session.ts";
import {
  type AnnotationLayerHandle,
  type AnnotationLayerScripting,
  type AnnotationLayerTask,
  buildAnnotationLayer,
  type LinkHandlers,
} from "../pdfjs/annotation-layer.ts";
import { isRenderCancelled, type Rotation } from "../pdfjs/draw.ts";
import type {
  AnnotationEditor,
  AnnotationEditorLayerTask,
  AnnotationLayerEditor,
} from "../pdfjs/editor-types.ts";
import type { LayerState } from "../pdfjs/layers.ts";
import { buildTextLayer, type TextLayerHandle, type TextLayerTask } from "../pdfjs/text.ts";
import type { PageElements } from "./page.ts";
import { sameScale, type ViewInput } from "./planner.ts";
import type { TextSelectionTracker } from "./selection.ts";

/**
 * The text, annotation, and annotation editor layers are DOM built on the
 * main thread, so they are the last things a page gets: one layer at a time,
 * only after scrolling settles, during idle periods, and never while a
 * visible page waits for its first pixels: text, then links, then the
 * annotations the viewer edits, which take the file's annotations from the
 * annotation layer.
 *
 * A text layer keeps the zoom it was laid out for: it carries its own
 * `--total-scale-factor`, and later zooms scale the laid-out layer with CSS.
 * Laying out every mounted page's text runs again at each zoom step was most
 * of the main thread's work while zooming. A visible page is laid out again,
 * one per idle period, only once the zoom goes in past TEXT_RELAYOUT_ZOOM
 * times the zoom its text was laid out for.
 */
interface PageLayerState {
  readonly index: number;
  readonly elements: PageElements;
  textTask: TextLayerTask | undefined;
  textHandle: TextLayerHandle | undefined;
  /** CSS pixels per point and view rotation the text runs were laid out for; 0 before any. */
  textScale: number;
  textRotation: Rotation;
  annotationTask: AnnotationLayerTask | undefined;
  annotationHandle: AnnotationLayerHandle | undefined;
  annotationScale: number;
  annotationRotation: Rotation;
  editorTask: AnnotationEditorLayerTask | undefined;
  editorHandle: AnnotationLayerEditor | undefined;
  /** Layers that failed: built again once the page mounts again, and annotations once they change. */
  readonly failed: Set<"text" | "annotations" | "editor">;
}

export interface DomLayerStats {
  text: number;
  /** Text layers laid out again for a new zoom. */
  textUpdates: number;
  annotations: number;
  /** Layers of annotations the viewer edits, built for mounted pages. */
  editors: number;
  cancelled: number;
  failed: number;
}

/**
 * How pages show their annotations besides drawing them, as features set
 * it: form fields as HTML, which the drawings then leave out, the scripts
 * those fields run, and the editor whose layers pages get. The renderer
 * holds it and changes it whole (`setAnnotationSetup`).
 */
export interface AnnotationSetup {
  /** Annotation layers show form fields the reader can fill in; the drawings leave them out. */
  readonly forms: boolean;
  /** The document's scripts, which those fields run. */
  readonly scripting: AnnotationLayerScripting | null;
  /** Edits annotations on the pages: they get its layers, and drawings leave out what it edits. */
  readonly editor: AnnotationEditor | null;
}

/** Pages draw their annotations: no form fields, scripts, or editor. */
export const DEFAULT_ANNOTATION_SETUP: AnnotationSetup = {
  forms: false,
  scripting: null,
  editor: null,
};

export interface DomLayerOptions {
  /** Where activated links in annotation layers go. */
  links?: LinkHandlers | undefined;
  /** How annotation layers show annotations. */
  annotationSetup: AnnotationSetup;
  /** Which layers annotation layers show. */
  layers?: LayerState | undefined;
  /** Keeps drag selections inside built text layers. */
  selection?: TextSelectionTracker | undefined;
  onTextReady?: ((pageIndex: number, handle: TextLayerHandle) => void) | undefined;
  onTextRemoved?: ((pageIndex: number) => void) | undefined;
  onAnnotationsReady?: ((pageIndex: number, handle: AnnotationLayerHandle) => void) | undefined;
  onAnnotationsRemoved?: ((pageIndex: number) => void) | undefined;
}

/** How long `whenEditable` waits for a page's annotation editor layer. */
const EDITOR_WAIT_MS = 10_000;

/**
 * Zooming in past this multiple of the zoom a text layer was laid out for
 * lays it out again. CSS scaling keeps runs where they were laid out, but
 * runs laid out small carry rounding errors that it magnifies: in Chromium,
 * up to 2.4 points at 0.25 CSS pixels per point against 0.04 at 4. Zooming
 * out keeps the finer layout.
 */
const TEXT_RELAYOUT_ZOOM = 2;

/**
 * Keeps a text layer at the zoom it is laid out for, `scale` CSS pixels per
 * point, whatever its page shows; null hands it back to the page's zoom.
 */
function pinTextLayer(container: HTMLElement, scale: number | null): void {
  if (scale === null) container.style.removeProperty("--total-scale-factor");
  else container.style.setProperty("--total-scale-factor", String(scale));
  container.style.scale = "";
}

/** Scales a pinned text layer with CSS to the page's zoom, `scale`, without laying it out. */
function followZoom(page: PageLayerState, scale: number): void {
  const { text } = page.elements;
  if (!text || page.textScale === 0) return;
  text.style.scale = scale === page.textScale ? "" : String(scale / page.textScale);
}

const whenIdle: (callback: () => void) => void =
  typeof requestIdleCallback === "function"
    ? (callback) => requestIdleCallback(callback, { timeout: 300 })
    : (callback) => setTimeout(callback, 16);

/** Builds the mounted pages' DOM layers, one at a time, in idle periods. */
export class DomLayers {
  readonly #session: DocumentSession;
  /** The renderer's, which it changes as features and the document do; layers built later follow. */
  readonly #options: Readonly<DomLayerOptions>;
  readonly #stats: DomLayerStats;
  /** Whether a visible page waits for its first pixels, which DOM layers never delay. */
  readonly #waiting: () => boolean;
  readonly #pages = new Map<number, PageLayerState>();
  #input: ViewInput | undefined;
  #running = false;
  #scheduled = false;
  /** Callers waiting for a page's annotation editor layer: true once built, false if never. */
  readonly #editorWaiters = new Map<number, Set<(built: boolean) => void>>();

  constructor(
    session: DocumentSession,
    options: DomLayerOptions,
    stats: DomLayerStats,
    waiting: () => boolean,
  ) {
    this.#session = session;
    this.#options = options;
    this.#stats = stats;
    this.#waiting = waiting;
  }

  attach(index: number, elements: PageElements): void {
    this.#pages.set(index, {
      index,
      elements,
      textTask: undefined,
      textHandle: undefined,
      textScale: 0,
      textRotation: 0,
      annotationTask: undefined,
      annotationHandle: undefined,
      annotationScale: 0,
      annotationRotation: 0,
      editorTask: undefined,
      editorHandle: undefined,
      failed: new Set(),
    });
  }

  /** Stops the page's layers and empties their containers. */
  detach(index: number): void {
    const page = this.#pages.get(index);
    if (!page) return;
    this.#pages.delete(index);
    page.textTask?.cancel();
    page.annotationTask?.cancel();
    page.editorTask?.cancel();
    page.editorHandle?.destroy();
    this.#editorBuilt(index, false);
    if (page.textHandle) this.#options.onTextRemoved?.(index);
    if (page.annotationHandle) this.#options.onAnnotationsRemoved?.(index);
    const { text, annotations, structure } = page.elements;
    if (text) {
      this.#options.selection?.remove(text);
      text.replaceChildren();
      pinTextLayer(text, null);
    }
    annotations?.replaceChildren();
    structure?.replaceChildren();
  }

  /** The view moved or zoomed: text layers follow a zoom with CSS. */
  update(input: ViewInput): void {
    if (input.layout.scale !== this.#input?.layout.scale) {
      for (const page of this.#pages.values()) followZoom(page, input.layout.scale);
    }
    this.#input = input;
  }

  /**
   * The view turned: text and annotation layers, laid out unturned, only
   * turn with CSS.
   */
  rotate(rotation: Rotation): void {
    for (const page of this.#pages.values()) {
      if (page.textHandle) {
        page.textHandle.update(page.textScale, rotation);
        page.textRotation = rotation;
      }
      if (page.annotationHandle) {
        page.annotationHandle.update(page.annotationScale, rotation);
        page.annotationRotation = rotation;
      }
      // Edited annotations turn with the page at once: they are what the reader works on.
      page.editorHandle?.update(this.#input?.layout.scale ?? 1, rotation);
    }
  }

  /**
   * The setup's editor changed: the old one's layers go, and the new one's
   * are built on the mounted pages from now on. The pages' editor containers
   * are the renderer's to add or remove.
   */
  editorChanged(): void {
    for (const index of [...this.#editorWaiters.keys()]) this.#editorBuilt(index, false);
    // Annotation layers report the file's annotations to the editor they were built with.
    this.invalidateAnnotations();
    this.schedule();
  }

  /**
   * Annotation layers are built again, as when the content or the forms
   * option changed, and the annotation editor layers that take the file's
   * annotations from them after them.
   */
  invalidateAnnotations(): void {
    for (const page of this.#pages.values()) {
      page.failed.delete("annotations");
      page.failed.delete("editor");
      page.editorTask?.cancel();
      page.editorTask = undefined;
      page.editorHandle?.destroy();
      page.editorHandle = undefined;
      const { annotations } = page.elements;
      if (!annotations) continue;
      page.annotationTask?.cancel();
      page.annotationTask = undefined;
      if (page.annotationHandle) this.#options.onAnnotationsRemoved?.(page.index);
      page.annotationHandle = undefined;
      annotations.replaceChildren();
    }
  }

  textHandle(index: number): TextLayerHandle | undefined {
    return this.#pages.get(index)?.textHandle;
  }

  /** Build the next layer in an idle period once scrolling settles. */
  schedule(): void {
    if (this.#scheduled || this.#running || !this.#input?.settled) return;
    this.#scheduled = true;
    whenIdle(() => {
      this.#scheduled = false;
      this.#pump();
    });
  }

  /**
   * Start or refresh at most one DOM layer: visible pages before overscan,
   * text before links, building before re-measuring after a zoom.
   */
  #pump(): void {
    const input = this.#input;
    if (!input?.settled || this.#running) return;
    // Text and annotations are parsed again in pdf.js's worker, so they
    // wait while a visible page draws its first pixels: on a page of
    // 200,000 segments, the text layer used to delay them by 48 ms. The
    // drawing's completion schedules them again.
    if (this.#waiting()) return;
    const { scale, rotation } = input.layout;
    const pages = [...this.#pages.values()].sort(
      (a, b) => Math.abs(a.index - input.focus) - Math.abs(b.index - input.focus),
    );
    const visible = (page: PageLayerState) => page.index >= input.first && page.index <= input.last;
    const needsText = (page: PageLayerState) =>
      page.elements.text !== null && !page.textHandle && !page.textTask && !page.failed.has("text");
    const needsLinks = (page: PageLayerState) =>
      page.elements.annotations !== null &&
      !page.annotationHandle &&
      !page.annotationTask &&
      !page.failed.has("annotations");
    // The editor layer takes the file's annotations from the annotation layer.
    const needsEditor = (page: PageLayerState) =>
      page.elements.editor !== null &&
      this.#options.annotationSetup.editor !== null &&
      !page.editorHandle &&
      !page.editorTask &&
      !page.failed.has("editor") &&
      (page.elements.annotations === null || page.annotationHandle !== undefined);
    for (const inWindow of [visible, (page: PageLayerState) => !visible(page)]) {
      const text = pages.find((page) => inWindow(page) && needsText(page));
      if (text) {
        this.#startText(text, scale, rotation);
        return;
      }
      const links = pages.find((page) => inWindow(page) && needsLinks(page));
      if (links) {
        this.#startAnnotations(links, scale, rotation);
        return;
      }
      const editor = pages.find((page) => inWindow(page) && needsEditor(page));
      if (editor) {
        this.#startEditor(editor, scale, rotation);
        return;
      }
    }
    // Lay visible text out again, one page per idle period, once the zoom has
    // gone in past TEXT_RELAYOUT_ZOOM times its layout zoom; CSS scales it
    // until then (see followZoom). Pages outside the viewport wait until they
    // scroll in.
    const textStale = (page: PageLayerState) =>
      page.textHandle !== undefined &&
      (scale > page.textScale * TEXT_RELAYOUT_ZOOM || page.textRotation !== rotation);
    const linksStale = (page: PageLayerState) =>
      page.annotationHandle !== undefined &&
      (!sameScale(page.annotationScale, scale) || page.annotationRotation !== rotation);
    const stale = pages.find((page) => visible(page) && (textStale(page) || linksStale(page)));
    if (stale) {
      const { text } = stale.elements;
      if (textStale(stale) && text) {
        pinTextLayer(text, scale);
        stale.textHandle?.update(scale, rotation);
        stale.textScale = scale;
        stale.textRotation = rotation;
        this.#stats.textUpdates++;
      }
      if (linksStale(stale)) {
        stale.annotationHandle?.update(scale, rotation);
        stale.annotationScale = scale;
        stale.annotationRotation = rotation;
      }
      this.schedule();
    }
  }

  /**
   * Whether page `index` gets its annotation editor layer: true once it is
   * built, at once if it is; false when the page unmounts first, editing
   * stops, or within EDITOR_WAIT_MS. The page need not be mounted yet.
   */
  whenEditable(index: number): Promise<boolean> {
    if (this.#pages.get(index)?.editorHandle) return Promise.resolve(true);
    if (!this.#options.annotationSetup.editor) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiters = this.#editorWaiters.get(index) ?? new Set();
      this.#editorWaiters.set(index, waiters);
      const timer = setTimeout(() => done(false), EDITOR_WAIT_MS);
      const done = (built: boolean) => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(built);
      };
      waiters.add(done);
    });
  }

  #editorBuilt(index: number, built: boolean): void {
    const waiters = this.#editorWaiters.get(index);
    if (!waiters) return;
    this.#editorWaiters.delete(index);
    for (const done of [...waiters]) done(built);
  }

  #current(page: PageLayerState): boolean {
    return this.#pages.get(page.index) === page;
  }

  /**
   * Counts a layer that failed or was cancelled; true if it failed. Like a
   * drawing, a layer that fails for good must not be built again and again,
   * ahead of every other layer.
   */
  #failed(error: unknown, page: PageLayerState, what: string): boolean {
    if (isRenderCancelled(error)) {
      this.#stats.cancelled++;
      return false;
    }
    this.#stats.failed++;
    console.error(`page ${page.index + 1}: ${what} failed`, error);
    return true;
  }

  #done(): void {
    this.#running = false;
    this.schedule();
  }

  #startEditor(page: PageLayerState, cssScale: number, rotation: Rotation): void {
    const { editor: container, drawings, text } = page.elements;
    const { editor } = this.#options.annotationSetup;
    if (!container || !editor) return;
    const task = editor.renderLayer({
      pageIndex: page.index,
      container,
      drawings,
      textLayer: text,
      annotationLayer: page.annotationHandle?.layer ?? null,
      structTree: page.textHandle?.structTree ?? null,
      cssScale,
      rotation,
    });
    page.editorTask = task;
    this.#running = true;
    task.promise
      .then(
        (handle) => {
          if (!this.#current(page) || page.editorTask !== task) {
            handle.destroy();
            return;
          }
          page.editorHandle = handle;
          // A turn while it was built, which rotate() could not tell it of.
          handle.update(cssScale, this.#input?.layout.rotation ?? rotation);
          this.#stats.editors++;
          this.#editorBuilt(page.index, true);
        },
        (error: unknown) => {
          if (this.#failed(error, page, "annotation editor layer") && page.editorTask === task) {
            page.failed.add("editor");
          }
        },
      )
      .finally(() => {
        if (page.editorTask === task) page.editorTask = undefined;
        this.#done();
      });
  }

  #startAnnotations(page: PageLayerState, cssScale: number, rotation: Rotation): void {
    const container = page.elements.annotations;
    const links = this.#options.links;
    if (!container || !links) return;
    container.replaceChildren();
    const session = this.#session;
    const { forms, scripting, editor } = this.#options.annotationSetup;
    const task = buildAnnotationLayer(session.pdfjs, session.proxy, session.page(page.index), {
      container,
      cssScale,
      rotation,
      links,
      forms,
      ...(this.#options.layers ? { layers: this.#options.layers.config } : {}),
      // The structure tree built with the page's text layer labels its annotations.
      structTree: page.textHandle?.structTree ?? null,
      editor: editor?.layerEditing ?? null,
      scripting,
    });
    page.annotationTask = task;
    this.#running = true;
    task.promise
      .then(
        (handle) => {
          if (!this.#current(page) || page.annotationTask !== task) return;
          page.annotationHandle = handle;
          page.annotationScale = cssScale;
          page.annotationRotation = rotation;
          this.#stats.annotations++;
          this.#options.onAnnotationsReady?.(page.index, handle);
        },
        (error: unknown) => {
          if (this.#failed(error, page, "annotation layer") && page.annotationTask === task) {
            page.failed.add("annotations");
          }
        },
      )
      .finally(() => {
        if (page.annotationTask === task) page.annotationTask = undefined;
        this.#done();
      });
  }

  #startText(page: PageLayerState, cssScale: number, rotation: Rotation): void {
    const { text: container, structure } = page.elements;
    if (!container) return;
    this.#options.selection?.remove(container);
    container.replaceChildren();
    pinTextLayer(container, cssScale);
    page.textScale = cssScale;
    structure?.replaceChildren();
    const task = buildTextLayer(this.#session.pdfjs, this.#session.page(page.index), {
      container,
      cssScale,
      rotation,
      ...(structure ? { structure } : {}),
    });
    page.textTask = task;
    this.#running = true;
    task.promise
      .then(
        (handle) => {
          if (!this.#current(page) || page.textTask !== task) return;
          // Like pdf.js's viewer, end with an element that catches drags past
          // the last run so selections do not jump to the page's start.
          const end = container.ownerDocument.createElement("div");
          end.className = "endOfContent";
          container.append(end);
          this.#options.selection?.add(container, end);
          page.textHandle = handle;
          page.textRotation = rotation;
          this.#stats.text++;
          this.#options.onTextReady?.(page.index, handle);
        },
        (error: unknown) => {
          if (this.#failed(error, page, "text layer") && page.textTask === task) {
            page.failed.add("text");
          }
        },
      )
      .finally(() => {
        if (page.textTask === task) page.textTask = undefined;
        this.#done();
      });
  }
}
