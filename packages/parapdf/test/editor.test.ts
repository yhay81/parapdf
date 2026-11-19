import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { Store } from "../src/document/store.ts";
import {
  ANNOTATION_LABELS,
  type AnnotationEditingStore,
  attachAnnotationEditing,
} from "../src/features/annotations.ts";
import { createPdfjsAnnotationEditor } from "../src/pdfjs/editor.ts";
import type { AnnotationEditingState } from "../src/pdfjs/editor-types.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

/** pdf.js's manager of editors, which, like pdf.js's, numbers the ids it gives from 0. */
class FakeManager {
  /** The manager made last, whose ids its editor's annotations get. */
  static last: FakeManager;
  #id = 0;
  #mode = 0;
  viewParameters = { realScale: 1, rotation: 0 };
  _signal = null;
  /** The editors of the page, by page. */
  editors: unknown[] = [];
  readonly selected = new Set<{ isSelected: boolean }>();
  /** Undo steps recorded, the last one last. */
  readonly steps: { cmd(): void; undo(): void }[] = [];

  constructor() {
    FakeManager.last = this;
  }

  getId() {
    return `pdfjs_internal_editor_${this.#id++}`;
  }

  async updateMode(mode: number) {
    this.#mode = mode;
  }

  getMode() {
    return this.#mode;
  }

  endCurrentEditing() {}

  getEditors() {
    return this.editors;
  }

  get hasSelection() {
    return this.selected.size > 0;
  }

  get firstSelectedEditor() {
    return this.selected.values().next().value;
  }

  setSelected(editor: { isSelected: boolean }) {
    this.unselectAll();
    this.toggleSelected(editor);
  }

  toggleSelected(editor: { isSelected: boolean }) {
    editor.isSelected = !editor.isSelected;
    if (editor.isSelected) this.selected.add(editor);
    else this.selected.delete(editor);
  }

  unselect(editor: { isSelected: boolean }) {
    if (editor.isSelected) this.toggleSelected(editor);
  }

  unselectAll() {
    for (const editor of this.selected) editor.isSelected = false;
    this.selected.clear();
  }

  selectAll() {
    for (const editor of this.editors as { isSelected: boolean }[]) {
      if (!editor.isSelected) this.toggleSelected(editor);
    }
  }

  addCommands(step: { cmd(): void; undo(): void }) {
    this.steps.push(step);
    step.cmd();
  }

  undo() {
    this.steps.pop()?.undo();
  }

  destroy() {}
}

/** pdf.js's editor classes as the editor builds them; it builds no layer here. */
const pdfjs = {
  AnnotationEditorType: { NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15, SIGNATURE: 101 },
  AnnotationEditorParamsType: {
    FREETEXT_SIZE: 11,
    FREETEXT_COLOR: 12,
    INK_COLOR: 21,
    INK_THICKNESS: 22,
    INK_OPACITY: 23,
    HIGHLIGHT_COLOR: 31,
    HIGHLIGHT_THICKNESS: 33,
  },
  PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 },
  // The editor resets the layers' initialization, a static of their class.
  AnnotationEditorLayer: { _initialized: true },
  AnnotationEditorUIManager: FakeManager,
} as unknown as typeof Pdfjs;

/** A document whose annotation storage is a map, as pdf.js's is. */
function document() {
  const storage = new Map<string, unknown>();
  /** How often pdf.js was told to collect the ids of changed annotations again. */
  const resets = { count: 0 };
  const doc = {
    numPages: 1,
    annotationStorage: {
      setValue: (id: string, value: unknown) => storage.set(id, value),
      remove: (id: string) => storage.delete(id),
      resetModifiedIds: () => resets.count++,
      [Symbol.iterator]: () => storage.entries(),
    },
  } as unknown as Pdfjs.PDFDocumentProxy;
  return { doc, storage, resets };
}

const editorOf = (doc: Pdfjs.PDFDocumentProxy) => {
  const changes: boolean[] = [];
  const states: AnnotationEditingState[] = [];
  const editor = createPdfjsAnnotationEditor(pdfjs, doc, async () => ({}) as never, {
    container: {} as HTMLElement,
    pages: {} as HTMLElement,
    labels: ANNOTATION_LABELS,
    scale: 1,
    rotation: 0,
    onStateChange: (state) => states.push(state),
    onStylesChange() {},
    onToolChange() {},
    onRedraw: () => changes.push(editor.layerEditing.editing),
  });
  return { editor, manager: FakeManager.last, changes, states };
};

/** An editor as pdf.js's manager lists it, of an annotation created or of the file's. */
const editorData = (
  serialized: Record<string, unknown> | null,
  { replaces = null as string | null, deleted = false } = {},
) => ({
  editorType: "ink",
  annotationElementId: replaces,
  deleted,
  isEmpty: () => false,
  serialize: (isForCopying = false) =>
    serialized && (isForCopying || replaces === null || !deleted) ? { ...serialized } : null,
});

describe("annotation editors of one document", () => {
  it("give their annotations ids of the document, not of each editor", () => {
    const { doc } = document();
    const left = editorOf(doc);
    const right = editorOf(doc);
    const ids = [left.manager.getId(), right.manager.getId(), left.manager.getId()];
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every((id) => /^pdfjs_internal_editor_[0-9]+$/.test(id)));
    // Another document numbers its own from 0.
    assert.equal(editorOf(document().doc).manager.getId(), "pdfjs_internal_editor_0");
  });

  it("remove only their own annotations from the storage", () => {
    const { doc, storage } = document();
    const left = editorOf(doc);
    const right = editorOf(doc);
    const mine = left.manager.getId();
    const theirs = right.manager.getId();
    storage.set(mine, {});
    storage.set(theirs, {});
    storage.set("12R", { value: "a form field's" });
    left.editor.destroy();
    assert.deepEqual([...storage.keys()], [theirs, "12R"]);
  });

  it("keep their annotations in the storage until told to forget them", () => {
    const { doc, storage } = document();
    const { editor, manager } = editorOf(doc);
    const id = manager.getId();
    storage.set(id, {});
    const forget = editor.destroy(true);
    assert.ok(storage.has(id), "saved and printed meanwhile");
    forget();
    assert.equal(storage.has(id), false);
  });

  it("draw pages again as a tool is chosen and as it goes back to none", async () => {
    const { doc, resets } = document();
    const { editor, changes } = editorOf(doc);
    assert.equal(editor.layerEditing.editing, false);
    await editor.setTool("ink");
    assert.equal(editor.layerEditing.editing, true);
    await editor.setTool("freetext");
    assert.deepEqual(changes, [true], "another tool changes nothing pages draw");
    assert.equal(resets.count, 0);
    await editor.setTool("none");
    assert.deepEqual(changes, [true, false]);
    assert.equal(resets.count, 1, "drawings leave out the annotations changed meanwhile");
    editor.destroy();
    assert.equal(resets.count, 2, "closing brings the file's annotations back");
  });

  it("export the file's annotations once changed, in their place, and leave deletions out", () => {
    const { doc } = document();
    const { editor, manager } = editorOf(doc);
    manager.editors = [
      editorData({ rect: [0, 0, 1, 1] }),
      // pdf.js serializes the file's annotations only once changed, but for copying.
      {
        ...editorData({ rect: [1, 1, 2, 2] }, { replaces: "12R" }),
        serialize: (copy = false) => (copy ? { rect: [1, 1, 2, 2] } : null),
      },
      editorData({ rect: [2, 2, 3, 3] }, { replaces: "13R" }),
      editorData({ rect: [3, 3, 4, 4] }, { replaces: "14R", deleted: true }),
    ];
    assert.deepEqual(
      editor.export().map(({ data }) => data),
      [{ rect: [0, 0, 1, 1] }, { rect: [2, 2, 3, 3], annotationElementId: "13R" }],
    );
  });
});

/** An editor whose comment and alternative text change as pdf.js's do. */
function described(editorType: string) {
  let comment: { text: string | null; deleted: boolean } | null = null;
  let altText: { altText: string | null; decorative: boolean } | undefined;
  return {
    ...editorData({}),
    id: `editor-${editorType}`,
    editorType,
    pageIndex: 0,
    isSelected: false,
    canAddComment: editorType !== "freetext",
    get hasComment() {
      return !!comment?.text && !comment.deleted;
    },
    get comment(): unknown {
      return comment;
    },
    set comment(value: string | null) {
      comment = { text: value ?? "", deleted: value === null };
    },
    createAltText() {
      altText ??= { altText: null, decorative: false };
    },
    get altTextData() {
      return altText;
    },
    set altTextData(data) {
      if (altText) altText = data;
    },
  };
}

describe("the annotation selected", () => {
  it("is described when it is selected alone", () => {
    const { doc } = document();
    const { editor, manager, states } = editorOf(doc);
    // Read anew: the state changes as the manager selects.
    const selected = () => editor.state.selected as AnnotationEditingState["selected"];
    const image = described("stamp");
    const ink = described("ink");
    manager.editors = [image, ink];
    manager.setSelected(image);
    assert.deepEqual(selected(), {
      id: "editor-stamp",
      pageIndex: 0,
      type: "stamp",
      comment: null,
      altText: { text: "", decorative: false },
    });
    assert.equal(states.at(-1)?.selected?.type, "stamp", "and reported");
    manager.toggleSelected(ink);
    assert.equal(selected(), null, "two are selected");
    manager.unselect(image);
    assert.equal(selected()?.type, "ink");
    assert.equal(selected()?.altText, null, "only images have an alternative text");
    manager.selectAll();
    assert.equal(selected(), null);
    manager.unselectAll();
    assert.equal(selected(), null);
  });

  it("takes a comment and gives it back as one undo step", () => {
    const { doc } = document();
    const { editor, manager } = editorOf(doc);
    const ink = described("ink");
    manager.editors = [ink];
    assert.equal(editor.setComment("Note"), false, "nothing is selected");
    manager.setSelected(ink);
    assert.equal(editor.setComment("Note"), true);
    assert.equal(editor.state.selected?.comment, "Note");
    assert.equal(editor.setComment(""), true, "an empty comment removes it");
    assert.equal(editor.state.selected?.comment, null);
    assert.equal(manager.steps.length, 2);
    manager.undo();
    assert.equal(editor.state.selected?.comment, "Note");
    manager.undo();
    assert.equal(editor.state.selected?.comment, null);
    assert.equal(editor.setComment(null), true, "no change, no step");
    assert.equal(manager.steps.length, 0);
  });

  it("takes no comment on text, whose text is its content", () => {
    const { doc } = document();
    const { editor, manager } = editorOf(doc);
    const text = described("freetext");
    manager.editors = [text];
    manager.setSelected(text);
    assert.equal(editor.setComment("Note"), false);
    assert.equal(manager.steps.length, 0);
  });

  it("takes an alternative text only on an image", () => {
    const { doc } = document();
    const { editor, manager } = editorOf(doc);
    const image = described("stamp");
    const ink = described("ink");
    manager.editors = [image, ink];
    manager.setSelected(ink);
    assert.equal(editor.setAltText({ text: "A line", decorative: false }), false);
    manager.setSelected(image);
    assert.equal(editor.setAltText({ text: "", decorative: true }), true);
    assert.deepEqual(editor.state.selected?.altText, { text: "", decorative: true });
    manager.undo();
    assert.deepEqual(editor.state.selected?.altText, { text: "", decorative: false });
  });
});

describe("attachAnnotationEditing restore recovery", () => {
  it("recovers editor controls and preserves kept annotations when restore fails, blocking partial commits until a retry succeeds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(console, "error", () => {});

    let canDecodeImage = false;
    class RestoringManager extends FakeManager {
      imageManager = {
        getFromUrl: async () => (canDecodeImage ? { id: "img_0", bitmap: {}, isSvg: false } : null),
      };
      getEditors() {
        return this.editors;
      }
      removeDeletedAnnotationElement() {}
      addChangedExistingAnnotation() {}
    }
    class FakeDrawLayer {
      setParent() {}
      destroy() {}
    }
    class FakeEditorLayer {
      static _initialized = true;
      readonly pageIndex: number;
      readonly div: { hidden: boolean };
      readonly #manager: RestoringManager;
      constructor(opts: {
        uiManager: RestoringManager;
        pageIndex: number;
        div: { hidden: boolean };
      }) {
        this.#manager = opts.uiManager;
        this.pageIndex = opts.pageIndex;
        this.div = opts.div;
      }
      async deserialize(data: Record<string, unknown>) {
        return {
          ...editorData(data),
          id: this.#manager.getId(),
          editorType: "stamp",
          isClone: false,
          canAddComment: true,
          translate() {},
          remove() {},
        };
      }
      addOrRebuild(ed: unknown) {
        this.#manager.editors.push(ed);
      }
      getEditableAnnotation() {
        return null;
      }
      destroy() {}
    }

    const globals = [
      "window",
      "document",
      "MutationObserver",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "ResizeObserver",
    ];
    const before = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.assign(globalThis, {
      window: {
        devicePixelRatio: 1,
        setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      },
      document: {
        createElement: () => ({ hidden: false }),
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    t.after(() => {
      globals.forEach((name, idx) => {
        const desc = before[idx];
        if (desc) Object.defineProperty(globalThis, name, desc);
        else Reflect.deleteProperty(globalThis, name);
      });
    });

    const storage = new Map<string, unknown>();
    const doc = fakeDocument({
      pages: [LETTER],
      proxy: {
        annotationStorage: {
          get size() {
            return storage.size;
          },
          print: {},
          setValue: (id: string, val: unknown) => storage.set(id, val),
          remove: (id: string) => storage.delete(id),
          resetModifiedIds() {},
          [Symbol.iterator]: () => storage.entries(),
        },
        getPage: async () => {
          const base = await fakeDocument({ pages: [LETTER] }).proxy.getPage(1);
          return {
            ...base,
            getViewport: (opts: Parameters<typeof base.getViewport>[0]) => {
              const vp = base.getViewport(opts);
              return { ...vp, clone: () => vp };
            },
          };
        },
      },
    });
    const fake = fakePdfjs(async () => doc.proxy);
    Object.assign(fake.loaded.pdfjs, {
      ...pdfjs,
      AnnotationEditorUIManager: RestoringManager,
      AnnotationEditorLayer: FakeEditorLayer,
      DrawLayer: FakeDrawLayer,
    });

    const makeElement = () =>
      ({
        clientWidth: 800,
        clientHeight: 600,
        scrollTop: 0,
        scrollLeft: 0,
        style: { setProperty() {}, removeProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        removeEventListener() {},
        contains: () => false,
      }) as unknown as HTMLElement;

    const viewer = new ViewerController();
    const store = new Store<AnnotationEditingStore>({
      tool: "none",
      state: null,
      styles: null,
    });
    const editing = attachAnnotationEditing(viewer, { store });
    const detach1 = viewer.attachViewport(makeElement(), makeElement());
    const shown = show(viewer, { url: "/restore.pdf" }, fake.loader);
    await settle();

    assert.ok(store.get().state);
    FakeManager.last.editors = [
      {
        ...editorData({ bitmapUrl: "blob:stamp" }),
        editorType: "stamp",
      },
    ];
    assert.equal(editing.export().length, 1);

    // Detach viewport -> snapshots `kept`, then reattach while decoding fails -> restore() rejects.
    detach1();
    const detach2 = viewer.attachViewport(makeElement(), makeElement());
    await settle();

    assert.notEqual(store.get().state, null, "editor state publishes despite restore failure");
    assert.notEqual(store.get().styles, null, "editor styles publish despite restore failure");
    await editing.setTool("ink");
    assert.equal(store.get().tool, "ink", "tools remain usable after restore failure");
    assert.equal(editing.export().length, 1, "export() preserves un-restored kept annotations");
    assert.ok(viewer.session);
    await assert.rejects(
      viewer.session.commit(),
      /Some annotations could not be restored/,
      "commit() refuses to silently overwrite with partial annotations",
    );

    // Detach and reattach once image decoding succeeds -> kept snapshot retries and succeeds.
    detach2();
    canDecodeImage = true;
    const detach3 = viewer.attachViewport(makeElement(), makeElement());
    await settle();

    assert.notEqual(store.get().state, null);
    assert.equal(editing.export().length, 1);
    await viewer.session.commit();

    detach3();
    editing.detach();
    shown.close();
    t.mock.timers.tick(1000);
    await settle();
    void mock;
  });
});
