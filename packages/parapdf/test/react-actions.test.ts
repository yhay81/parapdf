import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock, type TestContext } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  connectSession,
  openDocumentOf,
  PdfSession,
  setOpenAttachment,
} from "../src/document/pdf-session.ts";
import { getAttachmentContent, openAttachment } from "../src/features/attachments.ts";
import { getFormFields, setFormValues } from "../src/features/forms/index.ts";
import { historyOf } from "../src/features/history.ts";
import { setLayerVisible } from "../src/features/layers.ts";
import { enforcePermissions } from "../src/features/permissions.ts";
import { searchOf } from "../src/features/search/index.ts";
import {
  activeTracked,
  createTrackedSnapshot,
  hasTrackedChange,
  SessionContext,
  ViewerContext,
} from "../src/react/context.ts";
import { historyControlsStore, useHistory } from "../src/react/history.ts";
import { createPrintController, type PrintState, usePrint } from "../src/react/print.ts";
import { useSave } from "../src/react/save.ts";
import { searchControlsStore, useSearch } from "../src/react/search.ts";
import { attachViewport, openViewer, Viewer } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

class PrintElement {
  children: PrintElement[] = [];
  parent: PrintElement | null = null;
  width = 640;
  height = 480;
  append(child: PrintElement) {
    this.children.push(child);
    child.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  removeAttribute(name: string) {
    Reflect.deleteProperty(this, name);
  }
  async decode() {}
  toBlob(callback: BlobCallback) {
    callback(new Blob(["PNG"]));
  }
}

function mockPrintEnvironment(t: TestContext) {
  const head = new PrintElement();
  const body = new PrintElement();
  const listeners = new Set<() => void>();
  let prints = 0;
  let urls = 0;
  const afterPrint = () => {
    for (const listener of [...listeners]) listener();
  };
  const replacements = {
    document: {
      head,
      body,
      createElement: () => new PrintElement(),
    },
    window: {
      print: () => prints++,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      afterPrint();
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(URL, "createObjectURL", () => `blob:print-${++urls}`);
  t.mock.method(URL, "revokeObjectURL", () => {});
  return { prints: () => prints };
}

function fakeViewport(width = 800, height = 600) {
  const scroller = {
    clientWidth: width,
    clientHeight: height,
    scrollLeft: 0,
    scrollTop: 0,
    style: {} as Record<string, string>,
    classList: { toggle() {}, add() {}, remove() {} },
    ownerDocument: { activeElement: null },
    scrollTo({ left, top }: { left?: number; top?: number }) {
      if (left !== undefined) (this as { scrollLeft?: number }).scrollLeft = left;
      if (top !== undefined) (this as { scrollTop?: number }).scrollTop = top;
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  } as unknown as HTMLElement;
  const content = {
    style: {} as Record<string, string>,
    classList: { toggle() {}, add() {}, remove() {} },
    ownerDocument: { activeElement: null },
    scrollTo({ left, top }: { left?: number; top?: number }) {
      if (left !== undefined) (this as { scrollLeft?: number }).scrollLeft = left;
      if (top !== undefined) (this as { scrollTop?: number }).scrollTop = top;
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLElement;
  return { scroller, content };
}

function withViewportGlobals<T>(run: () => Promise<T>): Promise<T> {
  const names = ["window", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.assign(globalThis, {
    window: {
      devicePixelRatio: 1,
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return run().finally(() => {
    names.forEach((name, index) => {
      const descriptor = before[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  });
}

describe("public React-first surface (decision 0035)", () => {
  it("unexports Vanilla-only helpers while exporting session actions and React hooks", () => {
    const barrel = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const specifiers = new Set(
      [...barrel.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)].flatMap((match) =>
        (match[1] ?? "")
          .split(",")
          .map((item) =>
            item
              .trim()
              .replace(/^type\s+/, "")
              .trim(),
          )
          .filter(Boolean),
      ),
    );
    const removed = [
      "searchOf",
      "attachSearch",
      "Search",
      "historyOf",
      "attachHistory",
      "History",
      "HistoryState",
      "attachThumbnail",
      "enforcePermissions",
      "useAnnotationEditing",
      "AnnotationEditing",
      "AnnotationEditingOptions",
      "AnnotationEditingStore",
      "FormLayers",
      "getSelection",
      "getViewState",
      "setViewState",
    ];
    for (const name of removed) {
      assert.equal(specifiers.has(name), false, `${name} should not be exported`);
    }
    const expected = [
      "AttachmentHandler",
      "ViewState",
      "SaveControls",
      "useSave",
      "PrintControls",
      "PrintProgress",
      "usePrint",
      "save",
      "download",
      "getText",
      "getFormFields",
      "setFormValues",
      "setLayerVisible",
      "getAttachmentContent",
      "openAttachment",
    ];
    for (const name of expected) {
      assert.equal(specifiers.has(name), true, `${name} should be exported`);
    }
  });
});

describe("PdfSession document actions without a Viewer", () => {
  const close: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
  });

  it("reads and sets form values on PdfSession and invalidates every mounted Viewer", async () => {
    const storage = new Map<string, unknown>();
    const widget = {
      id: "1R",
      annotationType: 20,
      fieldName: "author",
      fieldType: "Tx",
      fieldValue: "Initial",
      rect: [0, 0, 100, 20],
    };
    const objects = new Map([["author", [{ page: 0 }]]]);
    const doc = fakeDocument({
      pages: [LETTER],
      proxy: {
        getFieldObjects: async () => objects,
        getPage: async () => ({
          view: [0, 0, LETTER.width, LETTER.height],
          rotate: 0,
          userUnit: 1,
          getViewport: () => ({
            width: LETTER.width,
            height: LETTER.height,
            convertToViewportPoint: (x: number, y: number) => [x, LETTER.height - y],
          }),
          getAnnotations: async () => [widget],
        }),
        annotationStorage: {
          get size() {
            return storage.size;
          },
          print: { printing: true },
          getRawValue: (id: string) => storage.get(id),
          setValue: (id: string, value: unknown) => storage.set(id, value),
        },
      },
    });
    const session = new PdfSession(
      { url: "/form.pdf" },
      { pdfjs: fakePdfjs(async () => doc.proxy).loader },
    );
    close.push(connectSession(session));
    await settle();

    // Works with zero Viewers mounted.
    const initial = await getFormFields(session);
    assert.equal(initial[0]?.value, "Initial");
    assert.deepEqual(await setFormValues(session, { author: "Updated" }), ["author"]);
    assert.equal((await getFormFields(session))[0]?.value, "Updated");

    // Notifies every listener / viewer sharing the DocumentSession.
    const openDoc = openDocumentOf(session);
    assert.ok(openDoc);
    let notifications = 0;
    const stop = new AbortController();
    openDoc.onContentChange(() => notifications++, stop.signal);
    await setFormValues(session, { author: "Again" });
    assert.equal(notifications, 1);
    stop.abort();
  });

  it("toggles layers via PdfSession both before and after layers are loaded", async () => {
    const visibility: Record<string, boolean> = { grid: true };
    const doc = fakeDocument({
      proxy: {
        getOptionalContentConfig: async () => ({
          getOrder: () => ["grid"],
          getGroup: (id: string) =>
            id === "grid" ? { name: "Grid", visible: visibility.grid } : null,
          setVisibility(id: string, visible: boolean) {
            visibility[id] = visible;
          },
          setOCGState() {},
          *[Symbol.iterator]() {
            yield ["grid", { name: "Grid", visible: visibility.grid }] as const;
          },
        }),
      },
    });
    const session = new PdfSession(
      { url: "/layers.pdf" },
      { pdfjs: fakePdfjs(async () => doc.proxy).loader },
    );
    close.push(connectSession(session));
    await settle();

    // Before layers() was called by any viewer, setLayerVisible loads and updates them.
    assert.equal(openDocumentOf(session)?.loadedLayers, null);
    setLayerVisible(session, "grid", false);
    await settle();
    assert.equal(visibility.grid, false);
    assert.notEqual(openDocumentOf(session)?.loadedLayers, null);

    // Subsequent calls update loadedLayers synchronously.
    setLayerVisible(session, "grid", true);
    assert.equal(visibility.grid, true);
  });

  it("reads and opens attachments through PdfSession and onOpenAttachment", async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const doc = fakeDocument({
      proxy: {
        getAttachmentContent: async (id: string) => (id === "readme.txt" ? bytes : null),
      },
    });
    const session = new PdfSession(
      { url: "/attachments.pdf" },
      { pdfjs: fakePdfjs(async () => doc.proxy).loader },
    );
    close.push(connectSession(session));
    await settle();

    assert.deepEqual(await getAttachmentContent(session, "readme.txt"), bytes);
    assert.equal(await getAttachmentContent(session, "missing.txt"), null);

    const opened: { filename: string; content: Uint8Array }[] = [];
    setOpenAttachment(session, (file) => opened.push(file));
    await openAttachment(session, {
      id: "readme.txt",
      filename: "readme.txt",
      description: null,
    });
    assert.deepEqual(opened, [{ filename: "readme.txt", content: bytes }]);
  });
});

describe("viewer.viewState() and viewer.setViewState()", () => {
  it("reads null before layout and round-trips view state on an attached viewer", async () => {
    await withViewportGlobals(async () => {
      const doc = fakeDocument({ pages: [LETTER, LETTER, LETTER] });
      const viewer = new Viewer();
      assert.equal(viewer.viewState(), null);

      const { scroller, content } = fakeViewport();
      const detach = attachViewport(viewer, scroller, content);
      const session = new PdfSession(
        { url: "/book.pdf" },
        { pdfjs: fakePdfjs(async () => doc.proxy).loader },
      );
      const release = connectSession(session);
      openViewer(viewer, session);
      await settle();

      viewer.setViewState({
        page: 2,
        x: 0,
        y: 120,
        scale: 1.5,
        rotation: 90,
        spread: "odd",
        scrollMode: "vertical",
      });
      const snapshot = viewer.viewState();
      assert.ok(snapshot);
      assert.equal(snapshot.page, 2);
      assert.equal(snapshot.scale, 1.5);
      assert.equal(snapshot.rotation, 90);
      assert.equal(snapshot.spread, "odd");
      assert.equal(snapshot.scrollMode, "vertical");

      release();
      detach();
    });
  });
});

describe("useSave, usePrint, useSearch, and useHistory", () => {
  it("resolves context or explicit instances on the server and throws without context", () => {
    const session = new PdfSession({ url: "/doc.pdf" });
    const viewer = new Viewer();

    assert.throws(
      () =>
        renderToString(
          createElement(() => {
            useSave();
            return null;
          }),
        ),
      /PdfDocument/,
    );
    assert.throws(
      () =>
        renderToString(
          createElement(() => {
            usePrint();
            return null;
          }),
        ),
      /useViewer/,
    );

    const html = renderToString(
      createElement(
        SessionContext,
        { value: session },
        createElement(
          ViewerContext,
          { value: viewer },
          createElement(() => {
            const saveState = useSave();
            const printState = usePrint();
            const searchStatus = useSearch((s) => s.status);
            const canGoBack = useHistory((h) => h.canGoBack);
            return createElement(
              "span",
              null,
              `${saveState.saving}:${printState.printing}:${printState.progress}:${searchStatus}:${canGoBack}`,
            );
          }),
        ),
      ),
    );
    assert.equal(html, "<span>false:false:null:idle:false</span>");

    const explicitHtml = renderToString(
      createElement(() => {
        const saveState = useSave(session);
        const printState = usePrint(viewer);
        return createElement("span", null, `${saveState.saving}:${printState.printing}`);
      }),
    );
    assert.equal(explicitHtml, "<span>false:false</span>");
  });

  it("tracks progress, supports clean cancel() and dispose(), and propagates errors in createPrintController", async (t) => {
    const env = mockPrintEnvironment(t);
    const doc = fakeDocument({ pages: [LETTER, LETTER, LETTER] });
    const viewer = new Viewer();
    const { close } = show(viewer, { url: "/three.pdf" }, fakePdfjs(async () => doc.proxy).loader);
    t.after(close);
    await settle();

    const states: PrintState[] = [];
    const controller = createPrintController(viewer, (state) => states.push(state));

    // Complete 3-page print run.
    const firstRun = controller.print();
    for (let index = 0; index < 3; index++) {
      await settle();
      doc.drawings[index]?.resolve();
    }
    await firstRun;
    assert.equal(env.prints(), 1);
    assert.deepEqual(states, [
      { printing: true, progress: { done: 0, total: 3 } },
      { printing: true, progress: { done: 1, total: 3 } },
      { printing: true, progress: { done: 2, total: 3 } },
      { printing: true, progress: { done: 3, total: 3 } },
      { printing: false, progress: null },
    ]);

    // Cancelling mid-preparation resolves cleanly and resets to idle immediately.
    states.length = 0;
    const cancelledRun = controller.print();
    await settle();
    assert.deepEqual(states, [{ printing: true, progress: { done: 0, total: 3 } }]);
    controller.cancel();
    assert.deepEqual(states.at(-1), { printing: false, progress: null });
    await cancelledRun;
    assert.equal(env.prints(), 1);

    // Caller AbortSignal still rejects instead of being swallowed as cancel().
    const callerAbort = new AbortController();
    const abortedRun = controller.print({ signal: callerAbort.signal });
    await settle();
    const reason = new Error("caller aborted");
    callerAbort.abort(reason);
    await assert.rejects(abortedRun, /Rendering cancelled/);
    await assert.rejects(
      controller.print({ signal: AbortSignal.abort(reason) }),
      (err) => err === reason,
    );

    // Restricted permissions reject immediately.
    const restrictedDoc = fakeDocument({
      pages: [LETTER],
      proxy: { getPermissions: async () => new Set<number>() },
    });
    const restrictedViewer = new Viewer();
    const detachPermissions = enforcePermissions(restrictedViewer);
    const { close: closeRestricted } = show(
      restrictedViewer,
      { url: "/locked.pdf" },
      fakePdfjs(async () => restrictedDoc.proxy).loader,
    );
    t.after(() => {
      detachPermissions();
      closeRestricted();
    });
    await settle();
    const restrictedController = createPrintController(restrictedViewer, () => {});
    await assert.rejects(restrictedController.print(), /does not permit printing/);
  });

  it("keeps search and history action references stable and skips re-renders for action-only consumers", async () => {
    const doc = fakeDocument({
      pages: [LETTER, LETTER],
      texts: [[{ str: "React PDF" }], [{ str: "React viewer" }]],
    });
    const viewer = new Viewer();
    const { close } = show(viewer, { url: "/search.pdf" }, fakePdfjs(async () => doc.proxy).loader);
    await settle();

    const searchStore = searchControlsStore(searchOf(viewer));
    const initialSearch = searchStore.get();
    const actionOnlySnap = createTrackedSnapshot(initialSearch);
    const { search, next, previous, clear } = actionOnlySnap.proxy;
    assert.deepEqual([...actionOnlySnap.tracked], ["search", "next", "previous", "clear"]);

    search("React");
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await settle();
    const afterSearch = searchStore.get();
    assert.equal(afterSearch.matches.length, 2);
    // Methods are referentially identical across state updates.
    assert.equal(afterSearch.search, search);
    assert.equal(afterSearch.next, next);
    assert.equal(afterSearch.previous, previous);
    assert.equal(afterSearch.clear, clear);
    // Action-only readers never re-render when matches/status/current change.
    assert.equal(
      hasTrackedChange(initialSearch, afterSearch, activeTracked(actionOnlySnap)),
      false,
    );

    const historyStore = historyControlsStore(historyOf(viewer));
    const initialHistory = historyStore.get();
    const historyActionSnap = createTrackedSnapshot(initialHistory);
    const { back, forward } = historyActionSnap.proxy;
    assert.equal(initialHistory.back, back);
    assert.equal(initialHistory.forward, forward);

    close();
  });
});
