import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PdfViewerRuntime } from "../src/runtime/viewer.ts";
import { askPassword, fakeDocument, fakePdfjs, PasswordException, settle } from "./fake-pdfjs.ts";

/** pdf.js that keeps asking for a password until the viewers close the document. */
function lockedPdfjs() {
  return fakePdfjs(async (task) => {
    let reason: "required" | "incorrect" = "required";
    for (;;) {
      if ((await askPassword(task, reason)) === null) {
        throw new PasswordException("No password given", 1);
      }
      reason = "incorrect";
    }
  }).loader;
}

describe("the viewer's pending password request", () => {
  const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const close: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
  });

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
    if (cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", cancelFrame);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });

  it("preserves a password request replayed to a second viewer", async () => {
    const pdfjs = lockedPdfjs();
    const first = new PdfViewerRuntime({}, pdfjs);
    close.push(first.open({ url: "/locked.pdf" }));
    await settle();
    assert.equal(first.store.get().status, "password");
    first.submitPassword("wrong");
    await settle();

    const second = new PdfViewerRuntime({}, pdfjs);
    close.push(second.open({ url: "/locked.pdf" }));
    assert.equal(second.store.get().status, "password");
    assert.equal(second.store.get().passwordReason, "incorrect");
    // A replayed prompt must remain usable, not only visible.
    second.submitPassword(null);
    await settle();
    assert.equal(first.store.get().status, "error");
    assert.equal(second.store.get().status, "error");
  });

  it("preserves the prompt when a waiting viewer remounts within the release delay", async () => {
    const viewer = new PdfViewerRuntime({}, lockedPdfjs());
    const release = viewer.open({ url: "/locked.pdf" });
    await settle();
    release();
    close.push(viewer.open({ url: "/locked.pdf" }));
    assert.equal(viewer.store.get().status, "password");
    assert.equal(viewer.store.get().passwordReason, "required");
  });

  it("preserves the replayed error when the second viewer has no password prompt", async () => {
    const pdfjs = lockedPdfjs();
    const first = new PdfViewerRuntime({}, pdfjs);
    close.push(first.open({ url: "/locked.pdf" }));
    await settle();
    const second = new PdfViewerRuntime({ passwordPrompt: false }, pdfjs);
    close.push(second.open({ url: "/locked.pdf" }));
    assert.equal(second.store.get().status, "error");
    assert.equal(second.store.get().error, "PasswordException: No password given");
  });

  it("opens with a changed source password without replaying the old error when prompting is disabled", async () => {
    const { loader, calls } = fakePdfjs(async (task, { password: given }) => {
      let password = given;
      while (password !== "secret") {
        const answer = await askPassword(task, password === undefined ? "required" : "incorrect");
        if (answer === null) throw new PasswordException("No password given", 1);
        password = answer;
      }
      return fakeDocument().proxy;
    });
    const viewer = new PdfViewerRuntime({ passwordPrompt: false }, loader);
    const release = viewer.open({ url: "/locked.pdf", password: "wrong" });
    await settle();
    assert.equal(viewer.store.get().status, "error");
    release();
    const statuses: string[] = [];
    const unsubscribe = viewer.store.subscribe(() => statuses.push(viewer.store.get().status));
    close.push(viewer.open({ url: "/locked.pdf", password: "secret" }));
    await settle();
    unsubscribe();
    assert.equal(viewer.store.get().status, "ready");
    assert.equal(viewer.store.get().error, null);
    assert.equal(calls.opens, 1);
    assert.equal(statuses.includes("error"), false);
  });
});
