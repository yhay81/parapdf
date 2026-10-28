import type * as Pdfjs from "pdfjs-dist";
import type { AnnotationLayerEditing } from "./annotation-layer.ts";
import { RenderCancelledError, type Rotation } from "./draw.ts";
import { l10n, labelElements } from "./editor-labels.ts";
import type {
  AnnotationAltText,
  AnnotationEditingState,
  AnnotationEditor,
  AnnotationEditorLayerTask,
  AnnotationEditorOptions,
  AnnotationLayerEditor,
  AnnotationStyles,
  AnnotationTool,
  AnnotationType,
  SavedAnnotation,
  SelectedAnnotation,
  SignatureInput,
} from "./editor-types.ts";

/*
 * Annotation editing through pdf.js's display API: its
 * AnnotationEditorUIManager owns the editors of one viewer, an
 * AnnotationEditorLayer per mounted page shows them, and a DrawLayer per page
 * draws highlights and freehand lines as SVG under the text layer. The
 * annotations the file holds that pdf.js edits come from the page's
 * annotation layer, which reports them to the manager, while a tool is
 * chosen. pdf.js's
 * viewer components, which build these for its own viewer, are not used: the
 * manager hears of scrolling, zooming, and turning through a small event bus
 * of ParaPDF's, the shape pdf.js's editors expect of one.
 *
 * The annotation editing feature, which applications load only to edit
 * annotations, imports this module; other modules import its types alone,
 * from `editor-types.ts`.
 */

/** The parts of pdf.js's editors this module calls, which pdf.js types loosely. */
interface PdfjsEditor {
  readonly id: string;
  readonly div: HTMLElement | null;
  /** pdf.js's name of the kind, the same as ParaPDF's. */
  readonly editorType: AnnotationType;
  pageIndex: number;
  /** The id of the annotation of the file it edits, null for one created. */
  annotationElementId: string | null;
  /** What pdf.js tells a change to the file's annotation by. */
  _initialData: object | null;
  readonly deleted: boolean;
  /** Moves it by CSS pixels on the screen. */
  translate(x: number, y: number): void;
  isClone?: boolean;
  serialize(isForCopying?: boolean): Record<string, unknown> | null;
  isEmpty(): boolean;
  readonly isSelected: boolean;
  /** Text annotations take no comment: their text is their content. */
  readonly canAddComment: boolean;
  /** Its comment, which pdf.js keeps whenever one was set; `text` "" or `deleted` when removed. */
  comment: { text: string | null; deleted: boolean } | string | null;
  readonly hasComment: boolean;
  altTextData: { altText: string | null; decorative: boolean } | undefined;
  createAltText(): unknown;
  addSignature(data: unknown, heightInPage: number, description: string, uuid: string | null): void;
  getFromText(text: string, font: object): unknown;
  getFromImage(bitmap: ImageBitmap): unknown;
  getDrawnSignature(curves: object): unknown;
  onceAdded(focus: boolean): void;
  remove(): void;
  show(visible?: boolean): void;
  /** Shows its change in the file's annotation's element: true when that hides it. */
  renderAnnotationElement(element: object): unknown;
}

interface PdfjsEditorLayer {
  readonly pageIndex: number;
  readonly div: HTMLDivElement | null;
  render(parameters: { viewport: Pdfjs.PageViewport }): Promise<void>;
  update(parameters: { viewport: Pdfjs.PageViewport }): void;
  deserialize(data: object): Promise<PdfjsEditor | null>;
  addOrRebuild(editor: PdfjsEditor): void;
  addNewEditor(data?: object): void;
  /** The element of the file's annotation `id` in the page's annotation layer. */
  getEditableAnnotation(id: string): { hide(): void; show(): void } | null;
  destroy(): void;
}

interface PdfjsUIManager {
  readonly imageManager: {
    getFromUrl(url: string): Promise<{ bitmap: unknown; id: string; isSvg: boolean } | null>;
    getFromFile(file: File): Promise<{ bitmap: unknown; id: string; isSvg: boolean } | null>;
    deleteId(id: string): void;
  };
  viewParameters: { realScale: number; rotation: number };
  updateMode(
    mode: number,
    editId?: string | null,
    isFromUser?: boolean,
    isFromKeyboard?: boolean,
    mustEnterInEditMode?: boolean,
    editComment?: boolean,
  ): Promise<void>;
  updateParams(type: number, value: unknown): void;
  getMode(): number;
  addChangedExistingAnnotation(editor: PdfjsEditor): void;
  removeDeletedAnnotationElement(editor: PdfjsEditor): void;
  getLayer(pageIndex: number): PdfjsEditorLayer | undefined;
  getEditors(pageIndex: number): Iterable<PdfjsEditor>;
  readonly hasSelection: boolean;
  readonly firstSelectedEditor: PdfjsEditor | undefined;
  setSelected(editor: PdfjsEditor): void;
  toggleSelected(editor: PdfjsEditor): void;
  unselect(editor: PdfjsEditor): void;
  unselectAll(): void;
  undo(): void;
  redo(): void;
  delete(): void;
  selectAll(): void;
  commitOrRemove(): void;
  endCurrentEditing(): void;
  addCommands(command: { cmd(): void; undo(): void; mustExec?: boolean }): void;
  getId(): string;
  findClonesForPage(layer: PdfjsEditorLayer): Promise<unknown>;
  readonly _signal: AbortSignal | null;
  combinedSignal(controller: AbortController): AbortSignal;
  destroy(): void;
}

type Listener = (event: Record<string, unknown>) => void;

/**
 * What pdf.js's editors expect of the viewer's event bus: listeners by
 * event name, removed by their abort signal or `off`, and `dispatch`.
 */
class EditorEventBus {
  readonly #listeners = new Map<string, Set<Listener>>();

  on(name: string, listener: Listener, options?: { once?: boolean; signal?: AbortSignal }): void {
    if (options?.signal?.aborted) return;
    const listeners = this.#listeners.get(name) ?? new Set();
    this.#listeners.set(name, listeners);
    const wrapped: Listener = options?.once
      ? (event) => {
          listeners.delete(wrapped);
          listener(event);
        }
      : listener;
    // `off` removes a listener by itself; `once` listeners are wrapped.
    if (options?.once) this.#wrapped.set(listener, wrapped);
    listeners.add(wrapped);
    options?.signal?.addEventListener("abort", () => listeners.delete(wrapped), { once: true });
  }

  readonly #wrapped = new WeakMap<Listener, Listener>();

  off(name: string, listener: Listener): void {
    const listeners = this.#listeners.get(name);
    listeners?.delete(listener);
    const wrapped = this.#wrapped.get(listener);
    if (wrapped) listeners?.delete(wrapped);
  }

  dispatch(name: string, event: Record<string, unknown>): void {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) listener(event);
  }

  clear(): void {
    this.#listeners.clear();
  }
}

/** pdf.js's own highlight colors, which its color picker offers, by name; the first is the default. */
const HIGHLIGHT_COLORS =
  "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F," +
  "yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043";

/** How tall a signature is when placed, in PDF points, as in pdf.js's viewer. */
const SIGNATURE_HEIGHT = 40;

const isAnnotationType = (value: unknown): value is AnnotationType =>
  value === "highlight" ||
  value === "freetext" ||
  value === "ink" ||
  value === "stamp" ||
  value === "signature";

/**
 * Plain arrays for the typed arrays pdf.js serializes outlines in, so that
 * the data survives JSON; pdf.js reads both back alike.
 */
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
  }
  return value;
}

/** A Blob as the File pdf.js's image cache takes, under a name no other image has. */
let imageCount = 0;
const asFile = (image: Blob): File =>
  image instanceof File
    ? image
    : new File([image], `image-${++imageCount}`, { type: image.type, lastModified: Date.now() });

/**
 * Runs `run`, in which a layer adds editors that exist already, as they
 * would be after the reader's own steps: hidden, so that the editors that
 * focus themselves as a layer adds them, highlights and images, do not
 * (pdf.js's own viewer builds its layers hidden too), and recording no undo
 * step. Drawings and images record a step that removes them whenever a
 * layer adds them, which a page's new layer does for the annotations it
 * shows again: undo then removed an annotation drawn long before instead
 * of the reader's last step, in pdf.js's viewer too once a page left its
 * page buffer (mozilla/pdf.js#22270). `run` must not await: pdf.js shows the layer again where it
 * should be shown when its render ends.
 */
function quietly<T>(manager: PdfjsUIManager, container: HTMLElement, run: () => T): T {
  const hidden = container.hidden;
  container.hidden = true;
  // An own property over the prototype's method, for the length of `run`.
  manager.addCommands = ({ cmd, mustExec }) => {
    if (mustExec) cmd();
  };
  try {
    return run();
  } finally {
    delete (manager as Partial<PdfjsUIManager>).addCommands;
    container.hidden = hidden;
  }
}

/** What pdf.js's ids of editors' annotations start with, followed by a number. */
const EDITOR_PREFIX = "pdfjs_internal_editor_";

/** A page without a structure tree, which labels nothing. */
const NO_STRUCTURE = { getAriaAttributes: async () => null };

/** The next editor id of each document, for every editor of it. */
const editorIds = new WeakMap<Pdfjs.PDFDocumentProxy, { next: number }>();

/** `editor`'s comment, null without one. */
function commentOf(editor: PdfjsEditor): string | null {
  if (!editor.canAddComment || !editor.hasComment) return null;
  const { comment } = editor;
  const text = typeof comment === "object" ? comment?.text : comment;
  return text || null;
}

/** Sets `editor`'s comment; null removes it, which the PDF saves too. */
function setCommentOf(editor: PdfjsEditor, comment: string | null): void {
  // pdf.js restores a comment from an object, and takes a string as an edit.
  editor.comment = comment;
}

/** An image editor's alternative text, which pdf.js reads from the file or data on demand. */
function altTextOf(editor: PdfjsEditor): AnnotationAltText {
  editor.createAltText();
  const data = editor.altTextData;
  return { text: data?.altText ?? "", decorative: data?.decorative ?? false };
}

/** What `state.selected` says of `editor`. */
function describe(editor: PdfjsEditor | null): SelectedAnnotation | null {
  if (!editor || !isAnnotationType(editor.editorType)) return null;
  return {
    id: editor.id,
    pageIndex: editor.pageIndex,
    type: editor.editorType,
    comment: commentOf(editor),
    altText: editor.editorType === "stamp" ? altTextOf(editor) : null,
  };
}

function sameSelection(a: SelectedAnnotation | null, b: SelectedAnnotation | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.pageIndex === b.pageIndex &&
    a.type === b.type &&
    a.comment === b.comment &&
    a.altText?.text === b.altText?.text &&
    a.altText?.decorative === b.altText?.decorative
  );
}

/** Builds annotation editing on pdf.js's display API for one viewer of `doc`. */
export function createPdfjsAnnotationEditor(
  pdfjs: typeof Pdfjs,
  doc: Pdfjs.PDFDocumentProxy,
  getPage: (pageIndex: number) => Promise<Pdfjs.PDFPageProxy>,
  options: AnnotationEditorOptions,
): AnnotationEditor {
  const { AnnotationEditorType: Mode, AnnotationEditorParamsType: Param } = pdfjs;
  const modes: Record<AnnotationTool, number> = {
    none: Mode.NONE,
    highlight: Mode.HIGHLIGHT,
    freetext: Mode.FREETEXT,
    ink: Mode.INK,
    stamp: Mode.STAMP,
    signature: Mode.SIGNATURE,
  };
  /** Which style of which tool each of pdf.js's parameters is. */
  const params: Record<number, [keyof AnnotationStyles, string]> = {
    [Param.HIGHLIGHT_COLOR]: ["highlight", "color"],
    [Param.HIGHLIGHT_THICKNESS]: ["highlight", "thickness"],
    [Param.FREETEXT_COLOR]: ["freetext", "color"],
    [Param.FREETEXT_SIZE]: ["freetext", "fontSize"],
    [Param.INK_COLOR]: ["ink", "color"],
    [Param.INK_THICKNESS]: ["ink", "thickness"],
    [Param.INK_OPACITY]: ["ink", "opacity"],
  };
  // pdf.js's own defaults, until its editors report theirs.
  let styles: AnnotationStyles = {
    highlight: { color: "#FFFF98", thickness: 12 },
    freetext: { color: "#000000", fontSize: 10 },
    ink: { color: "#000000", thickness: 1, opacity: 1 },
  };
  let state: AnnotationEditingState = {
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    isEmpty: true,
    selected: null,
  };
  /** The manager exists: its selection can be read. */
  let managerReady = false;
  const eventBus = new EditorEventBus();
  eventBus.on("editingstateschanged", ({ details }) => {
    const changed = details as Record<string, boolean>;
    state = {
      canUndo: changed.hasSomethingToUndo ?? state.canUndo,
      canRedo: changed.hasSomethingToRedo ?? state.canRedo,
      hasSelection: changed.hasSelectedEditor ?? state.hasSelection,
      isEmpty: changed.isEmpty ?? state.isEmpty,
      selected: describe(selectedAlone()),
    };
    options.onStateChange(state);
  });
  /** Report the selected annotation again: the selection, a comment, or an alt text changed. */
  const selectionChanged = () => {
    const selected = describe(selectedAlone());
    if (sameSelection(selected, state.selected)) return;
    state = { ...state, selected };
    options.onStateChange(state);
  };
  eventBus.on("annotationeditorparamschanged", ({ details }) => {
    let next = styles;
    for (const [type, value] of details as [number, unknown][]) {
      const param = params[type];
      if (!param) continue;
      const [tool, key] = param;
      if ((next[tool] as Record<string, unknown>)[key] === value) continue;
      next = { ...next, [tool]: { ...next[tool], [key]: value } };
    }
    if (next === styles) return;
    styles = next;
    options.onStylesChange(styles);
  });

  const toolOf = (mode: unknown): AnnotationTool =>
    (Object.entries(modes) as [AnnotationTool, number][]).find(
      ([, value]) => value === mode,
    )?.[0] ?? "none";
  /** Switches the application asked for, which the editors' own requests do not undo. */
  let switching = 0;
  let toolRevision = 0;
  // Selecting an annotation of another kind switches to its tool, which
  // pdf.js asks its viewer's toolbar to do.
  eventBus.on("switchannotationeditormode", (event) => {
    // Finishing the text being typed selects it, and pdf.js then asks for
    // the text tool again.
    if (switching > 0) return;
    const { mode, editId, isFromKeyboard, mustEnterInEditMode, editComment } = event as {
      mode: number;
      editId?: string;
      isFromKeyboard?: boolean;
      mustEnterInEditMode?: boolean;
      editComment?: boolean;
    };
    toolRevision++;
    options.onToolChange(toolOf(mode));
    void manager.updateMode(
      mode,
      editId ?? null,
      true,
      isFromKeyboard ?? false,
      mustEnterInEditMode ?? false,
      editComment ?? false,
    );
  });
  eventBus.on("showannotationeditorui", ({ mode }) => {
    toolRevision++;
    options.onToolChange(toolOf(mode));
    void manager.updateMode(mode as number).then(() => {
      eventBus.dispatch("annotationeditormodechanged", { source: null, mode });
    });
  });

  /** A signature waiting for the editor that `addSignature` asked pdf.js to create. */
  let pendingSignature: {
    input: SignatureInput;
    description: string;
    revision: number;
    complete(added: boolean): void;
  } | null = null;
  /**
   * What pdf.js's signature editor asks for when it is created without a
   * signature: ParaPDF hands it the one `addSignature` was given. pdf.js's
   * viewer opens a dialog instead.
   */
  const signatureManager = {
    async loadSignatures() {},
    async renderEditButton() {
      return null;
    },
    getSignature({ editor }: { editor: PdfjsEditor }) {
      const pending = pendingSignature;
      pendingSignature = null;
      // pdf.js selects the editor and records an undo step in onceAdded(),
      // before its signature can be ready. Do that only after it succeeds.
      const onceAdded = editor.onceAdded;
      editor.onceAdded = () => {};
      void (async () => {
        let ownedBitmap: ImageBitmap | undefined;
        try {
          // pdf.js requests the signature from render(), before its layer
          // appends the editor and calls onceAdded(). Finish that setup first:
          // removing a failed signature during render() clears the parent
          // that onceAdded() still needs.
          await Promise.resolve();
          if (
            !pending ||
            destroyed ||
            pending.revision !== toolRevision ||
            !editor.div?.isConnected
          ) {
            if (!destroyed) editor.remove();
            pending?.complete(false);
            return;
          }
          const { input, description } = pending;
          let outline: unknown;
          if ("text" in input) {
            outline = editor.getFromText(input.text, {
              fontFamily: input.fontFamily ?? "serif",
              fontStyle: input.fontStyle ?? "italic",
              fontWeight: input.fontWeight ?? "normal",
            });
          } else if ("image" in input) {
            let bitmap = input.image;
            if (bitmap instanceof Blob) {
              bitmap = ownedBitmap = await createImageBitmap(bitmap);
              // A newer tool choice cancels insertion before it can select
              // the signature and take focus from the reader's next action.
              if (destroyed || pending.revision !== toolRevision || !editor.div?.isConnected) {
                if (!destroyed) editor.remove();
                pending.complete(false);
                return;
              }
            }
            outline = editor.getFromImage(bitmap);
          } else {
            outline = editor.getDrawnSignature({
              curves: input.strokes.map((points) => ({ points: [...points] })),
              width: input.width,
              height: input.height,
              thickness: input.thickness ?? 1,
            });
          }
          if (!outline || pending.revision !== toolRevision) {
            editor.remove();
            pending.complete(false);
            return;
          }
          editor.addSignature(outline, SIGNATURE_HEIGHT, description, null);
          delete (editor as Partial<PdfjsEditor>).onceAdded;
          onceAdded.call(editor, true);
          pending.complete(true);
        } catch {
          if (!destroyed) editor.remove();
          pending?.complete(false);
        } finally {
          delete (editor as Partial<PdfjsEditor>).onceAdded;
          ownedBitmap?.close();
        }
      })();
    },
    destroy() {},
  };

  // pdf.js initializes its editor classes once, with the first manager,
  // and keeps that manager's view parameters in the defaults of new
  // drawings (mozilla/pdf.js#22272): the newest editor takes them over.
  (pdfjs.AnnotationEditorLayer as unknown as { _initialized: boolean })._initialized = false;
  const manager = new pdfjs.AnnotationEditorUIManager(
    options.container,
    options.pages,
    null, // viewerAlert
    null, // altTextManager: images get the alt text addImage() is given
    null, // commentManager
    signatureManager,
    eventBus,
    doc,
    options.pageColors ?? null,
    HIGHLIGHT_COLORS,
    false, // enableHighlightFloatingButton
    false, // enableUpdatedAddImage
    false, // enableNewAltTextWhenAddingImage
    null, // mlManager
    null, // editorUndoBar
    // ParaPDF zooms the document with two fingers, also over an annotation.
    false,
  ) as unknown as PdfjsUIManager;

  // Choosing a tool, or going back to none, changes what pages draw of the
  // file's annotations: those edited are left out while a tool is chosen,
  // and those changed or deleted after. pdf.js and its editors switch
  // modes through updateMode(), on their own too.
  let editing = false;
  // pdf.js keeps the ids of changed annotations, which drawings leave out,
  // until told to collect them again.
  const resetModifiedIds = () =>
    (doc.annotationStorage as unknown as { resetModifiedIds(): void }).resetModifiedIds();
  const updateMode = manager.updateMode.bind(manager);
  manager.updateMode = async (...args) => {
    await updateMode(...args);
    const now = !destroyed && manager.getMode() !== Mode.NONE;
    if (now === editing) return;
    editing = now;
    // As pdf.js's viewer does here.
    if (!now) resetModifiedIds();
    options.onRedraw();
  };
  const layerEditing = {
    uiManager: manager,
    eventBus,
    get editing() {
      return editing;
    },
  } satisfies AnnotationLayerEditing;

  // WebKit collects a signal from AbortSignal.any() that nothing references,
  // and aborting its sources then no longer removes the listeners added with
  // it: in Playwright's WebKit 27.2, the window listener of a finished
  // drawing stayed, and every later press threw in it (yhay81/parapdf#1;
  // bench/scripts/abort-any-repro.ts reproduces it without pdf.js).
  // pdf.js combines its signals here; each is kept until it aborts.
  const combined = new Set<AbortSignal>();
  manager.combinedSignal = (controller) => {
    const signal = AbortSignal.any([manager._signal ?? controller.signal, controller.signal]);
    combined.add(signal);
    signal.addEventListener("abort", () => combined.delete(signal), { once: true });
    return signal;
  };

  managerReady = true;
  // pdf.js reports only whether some annotation is selected; selecting
  // another one, alone, changes what `selected` describes too.
  for (const name of [
    "setSelected",
    "toggleSelected",
    "unselect",
    "unselectAll",
    "selectAll",
  ] as const) {
    const method = manager[name].bind(manager) as (editor?: PdfjsEditor) => void;
    manager[name] = (editor?: PdfjsEditor) => {
      method(editor);
      if (!destroyed) selectionChanged();
    };
  }

  /** The one annotation selected, if one alone is. */
  function selectedAlone(): PdfjsEditor | null {
    // The manager may report its first states as it is created.
    if (!managerReady) return null;
    const editor = manager.firstSelectedEditor;
    if (!editor || !manager.hasSelection) return null;
    for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
      for (const other of manager.getEditors(pageIndex)) {
        if (other !== editor && other.isSelected) return null;
      }
    }
    return editor;
  }

  /** Run `change`, and `undo` to take it back, as one undo step. */
  function step(change: () => void, undo: () => void): void {
    manager.addCommands({
      cmd: () => {
        change();
        selectionChanged();
      },
      undo: () => {
        undo();
        selectionChanged();
      },
      mustExec: true,
    });
  }

  // pdf.js numbers each manager's editors from 0, and the editors of every
  // viewer of a document share its annotation storage, where two of the
  // same id would replace each other: ids are the document's, and each
  // manager keeps to the editors it made.
  let ids = editorIds.get(doc);
  if (!ids) {
    ids = { next: 0 };
    editorIds.set(doc, ids);
  }
  const counter = ids;
  const own = new Set<string>();
  manager.getId = () => {
    const id = `${EDITOR_PREFIX}${counter.next++}`;
    own.add(id);
    return id;
  };
  // pdf.js's own, but for this manager's clones alone: another viewer's
  // annotations, imported in place as clones, stay with that viewer.
  manager.findClonesForPage = (layer) => {
    const storage = doc.annotationStorage;
    const found: Promise<void>[] = [];
    for (const [id, value] of [...storage]) {
      const clone = value as { pageIndex?: number; isClone?: boolean } | null;
      if (!own.has(id) || !clone?.isClone || clone.pageIndex !== layer.pageIndex) continue;
      storage.remove(id);
      found.push(
        layer.deserialize(clone).then((editor) => {
          if (!editor) return;
          editor.isClone = true;
          layer.addOrRebuild(editor);
        }),
      );
    }
    return Promise.all(found);
  };

  let scale = options.scale;
  let rotation = options.rotation;
  const viewportOf = (page: Pdfjs.PDFPageProxy, cssScale = scale, turn = rotation) =>
    page.getViewport({ scale: cssScale, rotation: (page.rotate + turn) % 360 }).clone({
      dontFlip: true,
    });
  const setView = (cssScale: number, nextRotation: Rotation) => {
    if (cssScale !== scale) {
      scale = cssScale;
      eventBus.dispatch("scalechanging", {
        source: null,
        scale: cssScale / pdfjs.PixelsPerInch.PDF_TO_CSS_UNITS,
      });
    }
    if (nextRotation !== rotation) {
      rotation = nextRotation;
      eventBus.dispatch("rotationchanging", { source: null, pagesRotation: nextRotation });
    }
  };
  manager.viewParameters.realScale = scale;
  manager.viewParameters.rotation = rotation;

  let destroyed = false;
  /** The layers of the mounted pages, by page, and what takes each down. */
  const layers = new Map<number, { layer: PdfjsEditorLayer; destroy(): void }>();

  /** Run `use` on page `pageIndex`'s layer, or on a layer outside the document for an unmounted page. */
  async function withLayer<T>(
    pageIndex: number,
    use: (layer: PdfjsEditorLayer) => Promise<T>,
  ): Promise<T> {
    const live = layers.get(pageIndex)?.layer;
    if (live) return use(live);
    const page = await getPage(pageIndex);
    const mounted = layers.get(pageIndex)?.layer;
    if (mounted) return use(mounted);
    // Built, filled, and destroyed within microtasks, before the page can
    // mount: its editors stay with the manager, as those of a page that
    // unmounts do, and appear when its layer is built.
    const container = document.createElement("div");
    const drawLayer = new pdfjs.DrawLayer({ pageIndex });
    drawLayer.setParent(document.createElement("div"));
    const layer = new pdfjs.AnnotationEditorLayer({
      uiManager: manager as never,
      pageIndex,
      div: container,
      structTreeLayer: null as never,
      accessibilityManager: undefined,
      annotationLayer: undefined,
      drawLayer,
      textLayer: undefined,
      viewport: viewportOf(page),
      l10n: l10n as never,
      mode: {},
      enabled: false,
    }) as unknown as PdfjsEditorLayer;
    try {
      return await use(layer);
    } finally {
      layer.destroy();
      drawLayer.destroy();
    }
  }

  /** Data pdf.js can create an editor from again where it was: images decoded, copies not moved. */
  async function restorable(annotation: SavedAnnotation): Promise<object | null> {
    const data = { ...(annotation.data as Record<string, unknown>) };
    if (annotation.type === "stamp" && typeof data.bitmapUrl === "string") {
      // Decoded before the editor is created, which then draws it at once:
      // a layer outside the document is gone by the time a download would end.
      const image = await manager.imageManager.getFromUrl(data.bitmapUrl);
      if (!image) return null;
      Object.assign(data, { bitmapId: image.id, bitmap: image.bitmap, isSvg: image.isSvg });
    }
    return data;
  }

  /** The editor `layer` created last for `create`, null when it created none. */
  function created(layer: PdfjsEditorLayer, create: () => void): PdfjsEditor | null {
    const before = new Set(manager.getEditors(layer.pageIndex));
    create();
    for (const editor of manager.getEditors(layer.pageIndex)) {
      if (!before.has(editor)) return editor;
    }
    return null;
  }

  /** Switch to `mode` for the application: the annotation being typed or drawn is finished first. */
  async function switchTo(mode: number): Promise<number> {
    const revision = ++toolRevision;
    switching++;
    try {
      manager.endCurrentEditing();
      await manager.updateMode(mode);
    } finally {
      switching--;
    }
    return revision;
  }

  /**
   * pdf.js exposes no completion promise for a new image editor. Its canvas
   * is added only after the bitmap, dimensions, and save data are ready.
   * Mutation callbacks run after that synchronous setup has finished.
   */
  function imageReady(layer: PdfjsEditorLayer, editor: PdfjsEditor): Promise<boolean> {
    return new Promise((resolve) => {
      const signal = manager._signal;
      const finish = (ready: boolean) => {
        observer.disconnect();
        signal?.removeEventListener("abort", aborted);
        resolve(ready);
      };
      const aborted = () => finish(false);
      const check = () => {
        if (destroyed || !editor.div || !layer.div?.contains(editor.div)) finish(false);
        else if (editor.div.querySelector("canvas")) finish(true);
      };
      const observer = new MutationObserver(check);
      if (layer.div) observer.observe(layer.div, { childList: true, subtree: true });
      signal?.addEventListener("abort", aborted, { once: true });
      check();
    });
  }

  return {
    get state() {
      return state;
    },
    get styles() {
      return styles;
    },
    layerEditing,
    async setTool(tool) {
      if (destroyed) return;
      await switchTo(modes[tool]);
    },
    setStyle(tool, style) {
      for (const [type, [paramTool, key]] of Object.entries(params)) {
        const value = (style as Record<string, unknown>)[key];
        if (paramTool === tool && value !== undefined) manager.updateParams(Number(type), value);
      }
      // pdf.js reports the style of selected annotations it changes; the
      // defaults, its toolbars keep themselves.
      if (!state.hasSelection) {
        styles = { ...styles, [tool]: { ...styles[tool], ...style } };
        options.onStylesChange(styles);
      }
    },
    undo: () => manager.undo(),
    redo: () => manager.redo(),
    deleteSelected: () => manager.delete(),
    selectAll: () => manager.selectAll(),
    setComment(comment) {
      const editor = selectedAlone();
      if (destroyed || !editor?.canAddComment) return false;
      const before = commentOf(editor);
      const after = comment || null;
      if (after === before) return true;
      step(
        () => setCommentOf(editor, after),
        () => setCommentOf(editor, before),
      );
      return true;
    },
    setAltText(altText) {
      const editor = selectedAlone();
      if (destroyed || editor?.editorType !== "stamp") return false;
      const before = altTextOf(editor);
      const after = { text: altText.text, decorative: altText.decorative };
      if (before.text === after.text && before.decorative === after.decorative) return true;
      const apply = ({ text, decorative }: AnnotationAltText) => {
        editor.altTextData = { altText: text, decorative };
      };
      step(
        () => apply(after),
        () => apply(before),
      );
      return true;
    },
    commit: () => manager.endCurrentEditing(),
    async addImage(pageIndex, image, altText) {
      if (destroyed) return false;
      // The runtime has already published the stamp tool. Choose it before
      // loading, even if decoding fails. A newer tool choice cancels this
      // insertion rather than taking focus from the reader's next action.
      const revision = await switchTo(Mode.STAMP);
      if (destroyed || revision !== toolRevision) return false;
      const source = typeof image === "string" ? image : asFile(image);
      // Decode before creating the editor: a loading image is already in
      // annotationStorage, but pdf.js cannot serialize it until it has pixels.
      const loading =
        typeof source === "string"
          ? manager.imageManager.getFromUrl(source)
          : manager.imageManager.getFromFile(source);
      const signal = manager._signal;
      let aborted = () => {};
      const cancelled = new Promise<null>((resolve) => {
        aborted = () => resolve(null);
      });
      signal?.addEventListener("abort", aborted, { once: true });
      const decoded = await Promise.race([loading, cancelled]);
      signal?.removeEventListener("abort", aborted);
      if (!decoded) {
        // A download may finish after the viewer closed; release the cache
        // reference then, without keeping addImage() pending for its response.
        if (destroyed)
          void loading.then((image) => image && manager.imageManager.deleteId(image.id));
        return false;
      }
      try {
        if (destroyed || revision !== toolRevision) return false;
        const layer = layers.get(pageIndex)?.layer;
        if (destroyed || !layer) return false;
        // The image cache now supplies this editor without another fetch or
        // decode, retaining pdf.js's normal placement, selection, and undo.
        const editor = created(layer, () =>
          layer.addNewEditor(
            typeof source === "string" ? { bitmapUrl: source } : { bitmapFile: source },
          ),
        );
        if (!editor || !(await imageReady(layer, editor))) return false;
        if (altText) {
          editor.createAltText();
          editor.altTextData = { altText, decorative: false };
        }
        return true;
      } finally {
        // The editor owns its own cache reference after creation.
        manager.imageManager.deleteId(decoded.id);
      }
    },
    async addSignature(pageIndex, signature, description = "") {
      if (destroyed) return false;
      const revision = await switchTo(Mode.SIGNATURE);
      if (destroyed || revision !== toolRevision) return false;
      const layer = layers.get(pageIndex)?.layer;
      if (!layer) return false;
      let complete = (_added: boolean) => {};
      const promise = new Promise<boolean>((resolve) => {
        complete = resolve;
      });
      const signal = manager._signal;
      const aborted = () => complete(false);
      signal?.addEventListener("abort", aborted, { once: true });
      pendingSignature = { input: signature, description, revision, complete };
      const editor = created(layer, () => layer.addNewEditor());
      if (pendingSignature) complete(false);
      pendingSignature = null;
      try {
        return editor ? await promise : false;
      } finally {
        signal?.removeEventListener("abort", aborted);
      }
    },
    export() {
      const annotations: SavedAnnotation[] = [];
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
        for (const editor of manager.getEditors(pageIndex)) {
          const type = editor.editorType;
          if (!isAnnotationType(type) || editor.isEmpty()) continue;
          // The file's annotations count once changed; deletions stay out.
          const { annotationElementId: replaces } = editor;
          if (replaces && (editor.deleted || editor.serialize() === null)) continue;
          // Copies, which pdf.js pastes, carry everything, images included;
          // highlights have none and are kept as the PDF saves them.
          const data = editor.serialize(type !== "highlight");
          if (!data) continue;
          // The id pdf.js creates an editor of the file's annotation with.
          if (replaces) data.annotationElementId = replaces;
          annotations.push({ pageIndex, type, data: plain(data) });
        }
      }
      return annotations;
    },
    async import(annotations) {
      const byPage = new Map<number, SavedAnnotation[]>();
      for (const annotation of annotations) {
        const { pageIndex } = annotation;
        if (!isAnnotationType(annotation.type) || !annotation.data) continue;
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) continue;
        byPage.set(pageIndex, [...(byPage.get(pageIndex) ?? []), annotation]);
      }
      let count = 0;
      let replaced = false;
      const imported = () => {
        // The manager hears of no step, so it reports no change.
        if (count > 0 && state.isEmpty) {
          state = { ...state, isEmpty: false };
          options.onStateChange(state);
        }
        if (replaced && !destroyed) {
          resetModifiedIds();
          options.onRedraw();
        }
        return count;
      };
      for (const [pageIndex, saved] of byPage) {
        // Images are decoded first, so that the layer is filled in one go.
        const data = await Promise.all(saved.map(restorable));
        if (destroyed) return imported();
        count += await withLayer(pageIndex, async (layer) => {
          const editors: PdfjsEditor[] = [];
          const replacing = new Map<PdfjsEditor, { id: string; popupRef: unknown }>();
          for (const item of data) {
            // pdf.js makes an editor of the file's annotation only of its
            // element; this one is made new, and takes its place below.
            const { annotationElementId: id, ...rest } = (item ?? {}) as Record<string, unknown>;
            const editor = item ? await layer.deserialize({ ...rest, pageIndex }) : null;
            if (editor && typeof id === "string")
              replacing.set(editor, { id, popupRef: rest.popupRef });
            // pdf.js saves a comment as the popup it serializes, and reads
            // one back only from the file's annotations.
            const popup = rest.popup as { contents?: unknown; deleted?: unknown } | undefined;
            if (editor?.canAddComment && popup) {
              if (popup.deleted) {
                if (typeof id === "string") setCommentOf(editor, null);
              } else if (typeof popup.contents === "string" && popup.contents) {
                setCommentOf(editor, popup.contents);
              }
            }
            // In place: pdf.js moves a pasted copy beside its original,
            // except a clone.
            if (editor) editor.isClone = true;
            if (editor) editors.push(editor);
          }
          // An editor of the file's annotation already there, changed,
          // deleted, or not, gives way.
          for (const { id } of replacing.values()) {
            for (const existing of [...manager.getEditors(pageIndex)]) {
              if (existing.annotationElementId !== id) continue;
              if (existing.deleted) manager.removeDeletedAnnotationElement(existing);
              existing.remove();
            }
          }
          if (layer.div) {
            const { div } = layer;
            // pdf.js hides a layer left empty as the tool goes back to none.
            if (editors.length > 0) div.hidden = false;
            quietly(manager, div, () => {
              for (const editor of editors) layer.addOrRebuild(editor);
            });
            for (const editor of editors) {
              // pdf.js moves a new text annotation up by its font size from
              // where the reader clicked, and a clone too (mozilla/pdf.js#22271).
              const { fontSize } = editor.serialize(true) ?? {};
              if (editor.editorType === "freetext" && typeof fontSize === "number") {
                editor.translate(0, fontSize * manager.viewParameters.realScale);
              }
            }
          }
          // Drawn, it becomes a change to the file's annotation, as an edit
          // makes one: saved over it, and shown, drawn, and exported instead.
          for (const [editor, { id, popupRef }] of replacing) {
            editor.annotationElementId = id;
            // Unlike any annotation of the file, so that it counts as changed.
            editor._initialData = {
              pageIndex: -1,
              color: [],
              accessibilityData: { altText: "" },
              popupRef: typeof popupRef === "string" ? popupRef : "",
            };
            doc.annotationStorage.setValue(editor.id, editor);
            manager.addChangedExistingAnnotation(editor);
            replaced = true;
            // On a page shown, the file's annotation hides while a tool is
            // chosen, and shows the change, as pdf.js has it once the tool
            // goes back to none, otherwise.
            const element = layer.getEditableAnnotation(id);
            if (element && editing) element.hide();
            else if (element && editor.renderAnnotationElement(element)) editor.show(false);
          }
          return editors.length;
        });
      }
      return imported();
    },
    setView,
    setCurrentPage(pageIndex) {
      eventBus.dispatch("pagechanging", { source: null, pageNumber: pageIndex + 1 });
    },
    renderLayer({
      pageIndex,
      container,
      drawings,
      textLayer,
      annotationLayer,
      structTree,
      cssScale,
      rotation: turn,
    }) {
      let cancelled = false;
      let handle: AnnotationLayerEditor | null = null;
      const promise = getPage(pageIndex).then(async (page): Promise<AnnotationLayerEditor> => {
        if (cancelled || destroyed) throw new RenderCancelledError("annotation editor cancelled");
        // The layer of an earlier mount of the page, should it still be up.
        layers.get(pageIndex)?.destroy();
        // pdf.js finds the text a selection highlights through its class.
        textLayer?.classList.add("textLayer");
        container.dir = getComputedStyle(options.container).direction;
        const drawLayer = new pdfjs.DrawLayer({ pageIndex });
        drawLayer.setParent(drawings);
        const observer = labelElements(container, options.labels);
        let layerRotation = turn;
        const layer = new pdfjs.AnnotationEditorLayer({
          uiManager: manager as never,
          pageIndex,
          div: container as HTMLDivElement,
          // pdf.js labels the file's images it edits from the structure tree.
          structTreeLayer: (structTree ?? NO_STRUCTURE) as never,
          accessibilityManager: undefined,
          annotationLayer: (annotationLayer ?? undefined) as never,
          drawLayer,
          textLayer: (textLayer ? { div: textLayer } : undefined) as never,
          viewport: viewportOf(page, cssScale, turn),
          l10n: l10n as never,
          mode: {},
          enabled: false,
        }) as unknown as PdfjsEditorLayer;
        let removed = false;
        const destroy = () => {
          if (removed) return;
          removed = true;
          observer.disconnect();
          if (layers.get(pageIndex)?.layer === layer) layers.delete(pageIndex);
          // The layer first, whose editors take their drawings off the draw layer.
          layer.destroy();
          drawLayer.destroy();
          textLayer?.classList.remove("textLayer", "highlighting");
          container.replaceChildren();
          for (const name of ["style", "dir", "hidden", "tabindex", "data-main-rotation"]) {
            container.removeAttribute(name);
          }
          container.className = container.className
            .split(" ")
            .filter((name) => name.startsWith("parapdf-"))
            .join(" ");
        };
        layers.set(pageIndex, { layer, destroy });
        handle = {
          update(nextScale, nextRotation) {
            if (removed || nextRotation === layerRotation) return;
            layerRotation = nextRotation;
            layer.update({ viewport: viewportOf(page, nextScale, nextRotation) });
          },
          destroy,
        };
        try {
          // The annotations of the page go back on it in the part of
          // render() that runs before it returns; render() then shows the
          // layer, unless it has nothing to show and no tool is chosen.
          container.hidden = true;
          const rendered = quietly(manager, container, () =>
            layer.render({ viewport: viewportOf(page, cssScale, turn) }),
          );
          await rendered;
        } catch (error) {
          destroy();
          throw error;
        }
        if (cancelled || destroyed) {
          destroy();
          throw new RenderCancelledError("annotation editor cancelled");
        }
        return handle;
      });
      return {
        promise,
        cancel() {
          cancelled = true;
          handle?.destroy();
        },
      } satisfies AnnotationEditorLayerTask;
    },
    destroy(keep = false) {
      // The document forgets this editor's annotations, which it would save
      // otherwise, and keeps those of the other viewers.
      const storage = doc.annotationStorage;
      const forget = () => {
        for (const id of own) storage.remove(id);
        own.clear();
        // The file's annotations it changed are drawn again as they were.
        resetModifiedIds();
      };
      if (destroyed) return forget;
      destroyed = true;
      for (const { destroy } of [...layers.values()]) destroy();
      layers.clear();
      // The manager lets go of its editors, which serialize without it, as
      // those of unmounted pages do without their layers.
      manager.destroy();
      eventBus.clear();
      if (!keep) forget();
      return forget;
    },
  };
}
