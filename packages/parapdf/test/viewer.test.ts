import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  connectSession,
  documentOf,
  PdfSession,
  setPasswordPrompt,
} from "../src/document/pdf-session.ts";
import type { PdfjsLoader } from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import { attachSearch } from "../src/features/search/index.ts";
import { getText } from "../src/features/text/index.ts";
import { openViewer, Viewer } from "../src/view/viewer.ts";
import {
  askPassword,
  fakeDocument,
  fakePdfjs,
  LETTER,
  PasswordException,
  settle,
  show,
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

describe("a session's document state", () => {
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

  /** A provider of `source`, as `<PdfDocument>` holds one. */
  const provide = (source: PdfSource, loader: PdfjsLoader, passwordPrompt = true) => {
    const session = new PdfSession(source, { passwordPrompt });
    close.push(connectSession(session, loader));
    return session;
  };

  it("is the session's, published to every provider and viewer of it", async () => {
    const { loader } = fakePdfjs(async () => fakeDocument({ pages: [LETTER, A4] }).proxy);
    const first = provide({ url: "/a.pdf" }, loader);
    const second = provide({ url: "/a.pdf" }, loader);
    assert.equal(first.state.get().status, "loading");
    assert.equal(first.state.get(), second.state.get(), "one store for both");
    await settle();
    const state = first.state.get();
    assert.equal(state.status, "ready");
    assert.equal(state.pageCount, 2);
    assert.equal(state.permissions?.restricted, false);
    assert.equal(second.state.get(), state);
    assert.ok(first.proxy);
    // A viewer keeps view state only.
    const viewer = new Viewer();
    openViewer(viewer, first);
    await settle();
    assert.equal("status" in viewer.store.get(), false);
    assert.equal(viewer.session?.proxy, first.proxy);
  });

  it("preserves a password request replayed to a second provider", async () => {
    const pdfjs = lockedPdfjs();
    const first = provide({ url: "/locked.pdf" }, pdfjs);
    await settle();
    assert.equal(first.state.get().status, "password");
    first.submitPassword("wrong");
    await settle();

    const second = provide({ url: "/locked.pdf" }, pdfjs);
    assert.equal(second.state.get().status, "password");
    assert.equal(second.state.get().passwordReason, "incorrect");
    // A replayed prompt must remain usable, not only visible.
    second.submitPassword(null);
    await settle();
    assert.equal(first.state.get().status, "error");
    assert.equal(second.state.get().status, "error");
  });

  it("preserves the prompt when a waiting provider remounts within the release delay", async () => {
    const session = new PdfSession({ url: "/locked.pdf" });
    const loader = lockedPdfjs();
    const release = connectSession(session, loader);
    await settle();
    release();
    close.push(connectSession(session, loader));
    assert.equal(session.state.get().status, "password");
    assert.equal(session.state.get().passwordReason, "required");
  });

  it("shows a password request as an error to a provider without a prompt", async () => {
    const pdfjs = lockedPdfjs();
    const first = provide({ url: "/locked.pdf" }, pdfjs);
    await settle();
    const second = provide({ url: "/locked.pdf" }, pdfjs, false);
    assert.equal(first.state.get().status, "password", "the other provider may still answer");
    assert.equal(second.state.get().status, "error");
    assert.equal(second.state.get().error, "PasswordException: No password given");
    first.submitPassword("wrong");
    await settle();
    assert.equal(second.state.get().error, "PasswordException: Incorrect Password");
  });

  it("settles its data without a prompt, and shows the prompt again once asked to", async () => {
    const pdfjs = lockedPdfjs();
    const session = provide({ url: "/locked.pdf" }, pdfjs, false);
    await settle();
    assert.equal(session.state.get().status, "error");
    assert.deepEqual(await session.outline(), [], "data settles while the document waits");
    let heard = 0;
    session.state.subscribe(() => heard++);
    setPasswordPrompt(session, true);
    assert.equal(session.state.get().status, "password", "the same session, now with its prompt");
    assert.equal(heard, 1);
  });

  it("opens with a changed source password without replaying the old error", async () => {
    const { loader, calls } = fakePdfjs(async (task, { password: given }) => {
      let password = given;
      while (password !== "secret") {
        const answer = await askPassword(task, password === undefined ? "required" : "incorrect");
        if (answer === null) throw new PasswordException("No password given", 1);
        password = answer;
      }
      return fakeDocument().proxy;
    });
    const wrong = new PdfSession(
      { url: "/locked.pdf", password: "wrong" },
      { passwordPrompt: false },
    );
    const release = connectSession(wrong, loader);
    await settle();
    assert.equal(wrong.state.get().status, "error");
    release();
    const right = provide({ url: "/locked.pdf", password: "secret" }, loader, false);
    const statuses: string[] = [];
    const unsubscribe = right.state.subscribe(() => statuses.push(right.state.get().status));
    await settle();
    unsubscribe();
    assert.equal(right.state.get().status, "ready");
    assert.equal(right.state.get().error, null);
    assert.equal(calls.opens, 1);
    assert.equal(statuses.includes("error"), false);
  });

  it("follows the session opened again after a hold that outlived it", async () => {
    const { loader, calls } = fakePdfjs();
    const session = new PdfSession({ url: "/a.pdf" });
    const release = connectSession(session, loader);
    const first = await documentOf(session);
    const outline = session.outline();
    release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(first.signal.aborted, true, "the registry closed the first session");
    close.push(connectSession(session, loader));
    const second = await documentOf(session);
    assert.notEqual(second, first);
    assert.equal(second.signal.aborted, false);
    assert.notEqual(session.outline(), outline, "its data is read from the new session");
    assert.equal(session.proxy, second.proxy);
    assert.equal(calls.opens, 2);
  });

  it("reads secondary data once, and settles it empty when the document fails", async (context) => {
    context.mock.method(console, "error", () => {});
    const { loader } = fakePdfjs();
    const session = provide({ url: "/a.pdf" }, loader);
    assert.equal(session.outline(), session.outline());
    assert.deepEqual(await session.outline(), []);
    const failed = provide(
      { url: "/broken.pdf" },
      fakePdfjs(async () => {
        throw new Error("not a PDF");
      }).loader,
    );
    assert.deepEqual(await failed.attachments(), []);
    assert.equal(await failed.metadata(), null);
    assert.equal(failed.state.get().status, "error");
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
    const viewer = new Viewer();
    const { close: closeDocument } = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    assert.ok(viewer.store.get().layout);
    const session = viewer.session;
    const reading = getText(viewer);
    const search = attachSearch(viewer);
    search.search("hello");
    assert.equal(search.store.get().status, "searching");
    closeDocument();
    read();
    await assert.rejects(reading, /closed/);
    // The search's first match would be published, and it yields after.
    await settle();
    mock.timers.tick(0);
    await settle();
    assert.equal(search.store.get().status, "idle", "the search publishes nothing after");
    assert.equal(viewer.session, null);
    // The session stays a second for a viewer that comes back, then closes.
    assert.equal(session?.signal.aborted, false);
    mock.timers.tick(1000);
    await settle();
    assert.equal(session?.signal.aborted, true);
  });

  it("stops a search, which reads no more pages once its document closes", async () => {
    const { loader, read, textsRead } = slowTexts(3);
    const viewer = new Viewer();
    const { close: closeDocument } = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    attachSearch(viewer).search("hello");
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
    const viewer = new Viewer();
    close.push(show(viewer, { url: "/a.pdf" }, open.loader).close);
    await settle();
    // Every page has the first one's size until the background pass knows better.
    assert.deepEqual(viewer.store.get().layout?.sizes, [LETTER, LETTER, LETTER]);
    mock.timers.tick(0);
    await settle();
    assert.deepEqual(viewer.store.get().layout?.sizes, pages);

    const closed = fakePdfjs(async () => fakeDocument({ pages }).proxy);
    const other = new Viewer();
    const { close: closeOther } = show(other, { url: "/a.pdf" }, closed.loader);
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
    const first = new Viewer();
    const second = new Viewer();
    const { close: closeFirst } = show(first, { url: "/a.pdf" }, loader);
    close.push(show(second, { url: "/a.pdf" }, loader).close);
    await settle();
    const session = second.session;
    assert.ok(session);
    assert.equal(first.session, session, "one session for both");
    const reading = getText(second);
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
    const viewer = new Viewer();
    close.push(show(viewer, { url: "/a.pdf" }, loader).close);
    await settle();
    const search = attachSearch(viewer);
    search.search("hello");
    await settle();
    assert.equal(search.store.get().status, "done");
    assert.equal(search.store.get().matches.length, 0);
    search.search("hello");
    await settle();
    mock.timers.tick(0);
    await settle();
    assert.equal(search.store.get().status, "done");
    assert.equal(search.store.get().matches.length, 1);
    assert.equal(attempts, 2);
  });

  it("closes the open document when it opens another", async () => {
    const { loader, calls } = fakePdfjs();
    const viewer = new Viewer();
    const a = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    const first = viewer.session;
    close.push(show(viewer, { url: "/b.pdf" }, loader).close);
    // Its provider lets the first go too.
    a.close();
    await settle();
    const second = viewer.session;
    assert.ok(first && second && first !== second);
    mock.timers.tick(1000);
    await settle();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(calls.destroys, 1);
  });
});

describe("a viewer's extensions", () => {
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

  /** An extension that counts what it hears. */
  const counting = () => {
    const heard = { prepare: 0, ready: 0, closed: 0, aborted: 0 };
    return {
      heard,
      extension: {
        prepare: () => void heard.prepare++,
        ready: (_session: unknown, signal: AbortSignal) => {
          heard.ready++;
          signal.addEventListener("abort", () => heard.aborted++);
        },
        closed: () => {
          // The document's work stops after the features let go of it.
          assert.equal(heard.aborted, 0);
          heard.closed++;
        },
      },
    };
  };

  it("hear a document's load once, whether they extend before or after it", async () => {
    const viewer = new Viewer();
    const early = counting();
    viewer.extend(early.extension);
    const { close: closeDocument } = show(viewer, { url: "/a.pdf" }, fakePdfjs().loader);
    const loading = counting();
    viewer.extend(loading.extension);
    await settle();
    const late = counting();
    const remove = viewer.extend(late.extension);
    for (const { heard } of [early, loading, late]) {
      assert.deepEqual(heard, { prepare: 1, ready: 1, closed: 0, aborted: 0 });
    }
    remove();
    closeDocument();
    assert.deepEqual(early.heard, { prepare: 1, ready: 1, closed: 1, aborted: 1 });
    assert.equal(late.heard.closed, 0, "a removed extension hears nothing more");
  });

  it("wait for the features they defer before the first layout", async () => {
    const viewer = new Viewer();
    let load = () => {};
    viewer.defer(new Promise<void>((resolve) => (load = resolve)));
    const { session, close: closeDocument } = show(viewer, { url: "/a.pdf" }, fakePdfjs().loader);
    close.push(closeDocument);
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.equal(viewer.store.get().layout, null);
    load();
    await settle();
    assert.ok(viewer.store.get().layout);
  });

  it("finish the edits in progress of every viewer of the document before it saves", async () => {
    const { loader } = fakePdfjs();
    const viewers = [new Viewer(), new Viewer()];
    for (const viewer of viewers) close.push(show(viewer, { url: "/a.pdf" }, loader).close);
    await settle();
    const session = viewers[0]?.session;
    assert.ok(session && session === viewers[1]?.session);
    const committed: number[] = [];
    const editing = new AbortController();
    session.onCommit(() => committed.push(0), editing.signal);
    session.onCommit(() => committed.push(1), new AbortController().signal);
    session.commit();
    editing.abort();
    session.commit();
    assert.deepEqual(committed, [0, 1, 1]);
  });
});
