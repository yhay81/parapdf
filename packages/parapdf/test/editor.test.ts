import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { ANNOTATION_LABELS } from "../src/features/annotations.ts";
import { createPdfjsAnnotationEditor } from "../src/pdfjs/editor.ts";

/** pdf.js's manager of editors, which, like pdf.js's, numbers the ids it gives from 0. */
class FakeManager {
  /** The manager made last, whose ids its editor's annotations get. */
  static last: FakeManager;
  #id = 0;
  viewParameters = { realScale: 1, rotation: 0 };
  _signal = null;

  constructor() {
    FakeManager.last = this;
  }

  getId() {
    return `pdfjs_internal_editor_${this.#id++}`;
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
  const doc = {
    numPages: 1,
    annotationStorage: {
      setValue: (id: string, value: unknown) => storage.set(id, value),
      remove: (id: string) => storage.delete(id),
      [Symbol.iterator]: () => storage.entries(),
    },
  } as unknown as Pdfjs.PDFDocumentProxy;
  return { doc, storage };
}

const editorOf = (doc: Pdfjs.PDFDocumentProxy) => {
  const editor = createPdfjsAnnotationEditor(pdfjs, doc, async () => ({}) as never, {
    container: {} as HTMLElement,
    pages: {} as HTMLElement,
    labels: ANNOTATION_LABELS,
    scale: 1,
    rotation: 0,
    onStateChange() {},
    onStylesChange() {},
    onToolChange() {},
  });
  return { editor, manager: FakeManager.last };
};

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
});
