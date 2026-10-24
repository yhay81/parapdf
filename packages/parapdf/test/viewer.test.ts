import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PdfViewerRuntime } from "../src/runtime/viewer.ts";
import {
  askPassword,
  fakeDocument,
  fakePdfjs,
  LETTER,
  PasswordException,
  settle,
} from "./fake-pdfjs.ts";

const A4 = { width: 595, height: 842 };

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

describe("closing a viewer's document", () => {
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

  /**
   * pdf.js whose documents' texts, "hello" on every page, are read once
   * `read()` is called; `textsRead` lists the pages whose text was asked for.
   */
  function slowTexts(pages = 2) {
    let read = () => {};
    const textsReady = new Promise<void>((resolve) => (read = resolve));
    const document = fakeDocument({
      pages: Array.from({ length: pages }, () => LETTER),
      texts: Array.from({ length: pages }, () => [{ str: "hello" }]),
      textsReady,
    });
    const fake = fakePdfjs(async () => document.proxy);
    return { ...fake, read, textsRead: document.textsRead };
  }

  it("stops what the viewer started for the document", async () => {
    const { loader, read } = slowTexts();
    const viewer = new PdfViewerRuntime({}, loader);
    const closeDocument = viewer.open({ url: "/a.pdf" });
    await settle();
    assert.equal(viewer.store.get().status, "ready");
    const session = viewer.store.get().document;
    const reading = viewer.getText();
    viewer.search("hello");
    assert.equal(viewer.store.get().search.status, "searching");
    closeDocument();
    read();
    await assert.rejects(reading, /closed/);
    // The search's first match would be published, and it yields after.
    await settle();
    mock.timers.tick(0);
    await settle();
    assert.equal(viewer.store.get().search.status, "idle", "the search publishes nothing after");
    assert.equal(viewer.store.get().document, null);
    // The session stays a second for a viewer that comes back, then closes.
    assert.equal(session?.signal.aborted, false);
    mock.timers.tick(1000);
    await settle();
    assert.equal(session?.signal.aborted, true);
  });

  it("stops a search, which reads no more pages once its document closes", async () => {
    const { loader, read, textsRead } = slowTexts(3);
    const viewer = new PdfViewerRuntime({}, loader);
    const closeDocument = viewer.open({ url: "/a.pdf" });
    await settle();
    viewer.search("hello");
    await settle();
    assert.deepEqual(textsRead, [0], "the search reads a page at a time");
    closeDocument();
    read();
    for (let step = 0; step < 3; step++) {
      await settle();
      mock.timers.tick(0);
    }
    await settle();
    assert.deepEqual(textsRead, [0], "and stopped after the page it was reading");
  });

  it("lays the pages out again once their sizes are known, unless the document closed", async () => {
    const pages = [LETTER, A4, LETTER];
    const open = fakePdfjs(async () => fakeDocument({ pages }).proxy);
    const viewer = new PdfViewerRuntime({}, open.loader);
    close.push(viewer.open({ url: "/a.pdf" }));
    await settle();
    // Every page has the first one's size until the background pass knows better.
    assert.deepEqual(viewer.store.get().layout?.sizes, [LETTER, LETTER, LETTER]);
    mock.timers.tick(0);
    await settle();
    assert.deepEqual(viewer.store.get().layout?.sizes, pages);

    const closed = fakePdfjs(async () => fakeDocument({ pages }).proxy);
    const other = new PdfViewerRuntime({}, closed.loader);
    const closeOther = other.open({ url: "/a.pdf" });
    await settle();
    closeOther();
    let published = 0;
    other.store.subscribe(() => published++);
    mock.timers.tick(0);
    await settle();
    assert.equal(published, 0, "a closed viewer publishes nothing when the pass ends");
  });

  it("leaves the work of another viewer of the same document running", async () => {
    const { loader, calls, read } = slowTexts();
    const first = new PdfViewerRuntime({}, loader);
    const second = new PdfViewerRuntime({}, loader);
    const closeFirst = first.open({ url: "/a.pdf" });
    close.push(second.open({ url: "/a.pdf" }));
    await settle();
    const session = second.store.get().document;
    assert.ok(session);
    assert.equal(first.store.get().document, session, "one session for both");
    const reading = second.getText();
    closeFirst();
    read();
    assert.equal((await reading).text, "hello\n\nhello");
    mock.timers.tick(1000);
    await settle();
    assert.equal(session.signal.aborted, false, "the session stays open for the other viewer");
    assert.equal(calls.opens, 1);
  });

  it("retries a search after a transient text read failure", async (context) => {
    const document = fakeDocument({ texts: [[{ str: "hello" }]] });
    const page = await document.proxy.getPage(1);
    let attempts = 0;
    context.mock.method(page, "getTextContent", async () => {
      if (++attempts === 1) throw new Error("text unavailable");
      return {
        items: [
          { str: "hello", hasEOL: false, transform: [10, 0, 0, 10, 0, 0], width: 20, height: 10 },
        ],
      };
    });
    context.mock.method(console, "error", () => {});
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new PdfViewerRuntime({}, loader);
    close.push(viewer.open({ url: "/a.pdf" }));
    await settle();
    viewer.search("hello");
    await settle();
    assert.equal(viewer.store.get().search.status, "done");
    assert.equal(viewer.store.get().search.matches.length, 0);
    viewer.search("hello");
    await settle();
    mock.timers.tick(0);
    await settle();
    assert.equal(viewer.store.get().search.status, "done");
    assert.equal(viewer.store.get().search.matches.length, 1);
    assert.equal(attempts, 2);
  });

  it("closes the open document when it opens another", async () => {
    const { loader, calls } = fakePdfjs();
    const viewer = new PdfViewerRuntime({}, loader);
    viewer.open({ url: "/a.pdf" });
    await settle();
    const first = viewer.store.get().document;
    close.push(viewer.open({ url: "/b.pdf" }));
    await settle();
    const second = viewer.store.get().document;
    assert.ok(first && second && first !== second);
    mock.timers.tick(1000);
    await settle();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(calls.destroys, 1);
  });
});
