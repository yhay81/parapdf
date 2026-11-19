import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { save, saveOf } from "../src/features/download.ts";
import { historyOf } from "../src/features/history.ts";
import { printOf } from "../src/features/print/index.ts";
import { searchOf } from "../src/features/search/index.ts";
import { useAnnotations } from "../src/react/annotations.ts";
import {
  activeTracked,
  createTrackedSnapshot,
  hasTrackedChange,
  SessionContext,
  ViewerContext,
} from "../src/react/context.ts";
import { useHistory } from "../src/react/history.ts";
import { usePrint } from "../src/react/print.ts";
import { useSave } from "../src/react/save.ts";
import { useSearch } from "../src/react/search.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

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
      "PdfThumbnail",
      "PdfThumbnailProps",
      "createPrintController",
      "PrintController",
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
      "ViewerExtension",
      "Opening",
      "RenderStats",
      "ViewerPosition",
      "save",
      "download",
      "print",
      "permits",
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
      "PermitsState",
      "usePermits",
      "PreloadDocumentOptions",
      "SelectionOptions",
      "PageSize",
      "ResolvedDestination",
      "DestinationView",
      "getText",
      "findText",
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

describe("useSave, usePrint, useSearch, and useHistory", () => {
  it("resolves context or explicit instances on the server and throws without context", () => {
    const session = new PdfSessionController({ url: "/doc.pdf" });
    const viewer = new ViewerController();

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
        const isSaving = useSave((s) => s.saving, session);
        const printState = usePrint(viewer);
        const isPrinting = usePrint((p) => p.printing, viewer);
        const tool = useAnnotations((a) => a.tool, viewer);
        return createElement(
          "span",
          null,
          `${saveState.saving}:${isSaving}:${printState.printing}:${isPrinting}:${tool}`,
        );
      }),
    );
    assert.equal(explicitHtml, "<span>false:false:false:false:none</span>");
  });

  it("shares saving state across save() and saveOf(session) while keeping action references stable", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let releaseSave = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const doc = fakeDocument({
      pages: [LETTER],
      proxy: {
        getData: async () => {
          await gate;
          return new Uint8Array([37, 80, 68, 70]);
        },
      },
    });
    const session = new PdfSessionController(
      { url: "/shared-save.pdf" },
      { pdfjs: fakePdfjs(async () => doc.proxy).loader },
    );
    const disconnect = session.connect();
    t.after(async () => {
      disconnect();
      t.mock.timers.tick(1000);
      await settle();
    });
    await settle();

    const slot = saveOf(session);
    const initial = slot.store.get();
    const actionSnap = createTrackedSnapshot(initial);
    const { save: saveFn, download: downloadFn } = actionSnap.proxy;
    assert.equal(initial.saving, false);

    // Standalone save(session) flips the session's shared SaveSlot store to saving: true.
    const pending = save(session);
    await settle();
    const during = slot.store.get();
    assert.equal(during.saving, true);
    assert.equal(during.save, saveFn);
    assert.equal(during.download, downloadFn);
    assert.equal(hasTrackedChange(initial, during, activeTracked(actionSnap)), false);

    releaseSave();
    const bytes = await pending;
    assert.deepEqual(bytes, new Uint8Array([37, 80, 68, 70]));
    assert.equal(slot.store.get().saving, false);
  });

  it("keeps print, search, and history action references stable and skips re-renders for action-only consumers", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
    const doc = fakeDocument({
      pages: [LETTER, LETTER],
      texts: [[{ str: "React PDF" }], [{ str: "React viewer" }]],
    });
    const viewer = new ViewerController();
    const { close } = show(viewer, { url: "/search.pdf" }, fakePdfjs(async () => doc.proxy).loader);
    t.after(async () => {
      close();
      t.mock.timers.tick(1000);
      await settle();
      if (cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", cancelFrame);
      else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    });
    await settle();

    const printSlot = printOf(viewer);
    const printSnap = createTrackedSnapshot(printSlot.store.get());
    const { print: printFn, cancel: cancelFn } = printSnap.proxy;
    assert.equal(printSlot.store.get().print, printFn);
    assert.equal(printSlot.store.get().cancel, cancelFn);

    const searchStore = searchOf(viewer);
    const initialSearch = searchStore.get();
    const actionOnlySnap = createTrackedSnapshot(initialSearch);
    const { search, next, previous, clear } = actionOnlySnap.proxy;
    assert.deepEqual([...actionOnlySnap.tracked], ["search", "next", "previous", "clear"]);

    search("React");
    for (let step = 0; step < 3; step++) {
      await settle();
      t.mock.timers.tick(0);
    }
    await settle();
    const afterSearch = searchStore.get();
    assert.equal(afterSearch.matches.length, 2);
    assert.equal(afterSearch.search, search);
    assert.equal(afterSearch.next, next);
    assert.equal(afterSearch.previous, previous);
    assert.equal(afterSearch.clear, clear);
    assert.equal(
      hasTrackedChange(initialSearch, afterSearch, activeTracked(actionOnlySnap)),
      false,
    );

    const historyStore = historyOf(viewer);
    const initialHistory = historyStore.get();
    const historyActionSnap = createTrackedSnapshot(initialHistory);
    const { back, forward } = historyActionSnap.proxy;
    assert.equal(initialHistory.back, back);
    assert.equal(initialHistory.forward, forward);
  });
});
