import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { sameFieldValue } from "../src/features/forms/scripts.ts";
import type { LoadedPdfjs } from "../src/pdfjs/loader.ts";
import { startScripting } from "../src/pdfjs/scripting.ts";

/** A document without scripts, whose fields fail to read with `failure`. */
function plainDocument(failure?: Error) {
  return {
    numPages: 2,
    getFieldObjects: async () => {
      if (failure) throw failure;
      return null;
    },
    getCalculationOrderIds: async () => null,
    getJSActions: async () => null,
    getPage: async () => ({ getJSActions: async () => null }),
    getMetadata: async () => assert.fail("a document without scripts gives them no info"),
  } as unknown as Pdfjs.PDFDocumentProxy;
}

/** pdf.js loaded without a sandbox to start: starting one fails the test. */
const loaded = {
  scriptingUrls: () => assert.fail("a document without scripts starts no sandbox"),
} as unknown as LoadedPdfjs;

const handlers = {
  field: () => assert.fail("no script changes a field"),
  command: () => assert.fail("no script sends a command"),
};

describe("a document's scripts", () => {
  it("start no sandbox for a document without any, whose events still run", async (context) => {
    const errors = context.mock.method(console, "error", () => {});
    const scripting = startScripting(loaded, plainDocument(), "a.pdf", handlers);
    await scripting.documentEvent("WillSave");
    scripting.showPage(0);
    scripting.showPage(1);
    scripting.dispatch({ id: "1R", name: "Keystroke" });
    await scripting.documentEvent("DidSave");
    scripting.destroy();
    scripting.destroy();
    await scripting.documentEvent("WillPrint");
    assert.equal(errors.mock.callCount(), 0);
  });

  it("report a document whose scripts cannot be read, whose events still run", async (context) => {
    const errors = context.mock.method(console, "error", () => {});
    const failure = new Error("worker gone");
    const scripting = startScripting(loaded, plainDocument(failure), null, handlers);
    await scripting.documentEvent("WillPrint");
    scripting.destroy();
    assert.deepEqual(
      errors.mock.calls.map((call) => call.arguments),
      [["starting the document's scripts failed", failure]],
    );
  });
});

describe("a field's value as scripts change it", () => {
  it("is the same for the same options in another array, and for a number and its text", () => {
    assert.equal(sameFieldValue(["a", "b"], ["a", "b"]), true);
    assert.equal(sameFieldValue(["a", "b"], ["b", "a"]), false);
    assert.equal(sameFieldValue(["a"], ["a", "b"]), false);
    assert.equal(sameFieldValue(5, "5"), true);
    assert.equal(sameFieldValue("5", 5), true);
    assert.equal(sameFieldValue(5, "5.0"), false);
    assert.equal(sameFieldValue("a", "a"), true);
    assert.equal(sameFieldValue(undefined, ""), false);
    assert.equal(sameFieldValue(true, "true"), false);
  });
});
