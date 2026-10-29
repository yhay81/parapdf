import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  connectSession,
  documentOf,
  fragmentOf,
  PdfSession,
  setFragment,
  setPasswordPrompt,
} from "../src/document/pdf-session.ts";
import type { PdfjsLoader } from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import { attachSearch } from "../src/features/search/index.ts";
import { getText } from "../src/features/text/index.ts";
import type { ViewerOptions } from "../src/view/options.ts";
import { attachViewport, openViewer, setViewerOptions, Viewer } from "../src/view/viewer.ts";
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
  it("removes an empty URL fragment from its source too", () => {
    const session = new PdfSession({ url: "/a.pdf#", httpHeaders: { Accept: "application/pdf" } });
    assert.deepEqual(session.source, {
      url: "/a.pdf",
      httpHeaders: { Accept: "application/pdf" },
    });
  });

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

  it("shares the document while each provider keeps its own fragment", async () => {
    let opens = 0;
    const { loader } = fakePdfjs(async () => {
      opens++;
      return fakeDocument().proxy;
    });
    const first = provide({ url: "/fragment.pdf#page=2" }, loader);
    const second = provide({ url: "/fragment.pdf#page=3" }, loader);
    await settle();
    assert.equal(opens, 1);
    assert.equal(first.proxy, second.proxy);
    assert.deepEqual(first.source, { url: "/fragment.pdf" });
    assert.equal(fragmentOf(first).get().fragment, "page=2");
    setFragment(first, "page=4");
    assert.equal(fragmentOf(first).get().fragment, "page=4");
    assert.equal(fragmentOf(second).get().fragment, "page=3");
  });

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

  it("drops what the viewer held of the document", async () => {
    const { loader } = fakePdfjs();
    const viewer = new Viewer();
    const { close: closeDocument } = show(viewer, { url: "/files/a.pdf" }, loader);
    await settle();
    const work = viewer.workSignal;
    assert.ok(viewer.session && viewer.permissions && viewer.renderer && viewer.layers && work);
    assert.equal(viewer.sourceName, "a.pdf");
    closeDocument();
    assert.equal(work.aborted, true);
    assert.deepEqual(
      [
        viewer.session,
        viewer.permissions,
        viewer.renderer,
        viewer.layers,
        viewer.workSignal,
        viewer.sourceName,
        viewer.store.get().layout,
      ],
      [null, null, null, null, null, null, null],
    );
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

describe("a viewer's viewport", () => {
  const globals = ["window", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
  const before = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const release: (() => void)[] = [];
  let resized: (() => void)[] = [];
  let frames: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    resized = [];
    frames = [];
    Object.assign(globalThis, {
      window: {
        devicePixelRatio: 1,
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: () => {},
      ResizeObserver: class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    });
  });

  afterEach(async () => {
    for (const done of release.splice(0)) done();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
    globals.forEach((name, index) => {
      const descriptor = before[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  });

  /** A scroller, 1000 by 800 CSS pixels, whose content is its viewer's layout. */
  class Scroller extends EventTarget {
    viewer: Viewer | null = null;
    clientWidth = 1000;
    clientHeight = 800;
    clientLeft = 0;
    clientTop = 0;
    readonly ownerDocument = { activeElement: null };
    readonly classList = { toggle: () => {}, remove: () => {} };
    readonly style = {};
    #left = 0;
    #top = 0;
    get scrollWidth(): number {
      return Math.max(this.clientWidth, this.viewer?.store.get().layout?.totalWidth ?? 0);
    }
    get scrollHeight(): number {
      return Math.max(this.clientHeight, this.viewer?.store.get().layout?.totalHeight ?? 0);
    }
    get scrollLeft(): number {
      return this.#left;
    }
    set scrollLeft(left: number) {
      this.#left = Math.min(Math.max(0, left), this.scrollWidth - this.clientWidth);
    }
    get scrollTop(): number {
      return this.#top;
    }
    set scrollTop(top: number) {
      this.#top = Math.min(Math.max(0, top), this.scrollHeight - this.clientHeight);
    }
    scrollTo(left: number, top: number): void {
      this.scrollLeft = left;
      this.scrollTop = top;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }
  }

  /** Attach `scroller` to `viewer`'s viewport until the test ends. */
  function attach(viewer: Viewer, scroller: Scroller): () => void {
    scroller.viewer = viewer;
    const content = { style: {}, classList: { remove: () => {} } };
    const detach = attachViewport(
      viewer,
      scroller as unknown as HTMLElement,
      content as unknown as HTMLElement,
    );
    release.push(detach);
    return detach;
  }

  /** A viewer of five Letter pages in a viewport. */
  async function viewing(options: ViewerOptions = {}) {
    const viewer = new Viewer(options);
    const scroller = new Scroller();
    attach(viewer, scroller);
    const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
    release.push(
      show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader).close,
    );
    await settle();
    return { viewer, scroller };
  }

  /** Resize the viewport, as the browser reports it, and draw the next frame. */
  function resize(scroller: Scroller, width: number, height: number): void {
    scroller.clientWidth = width;
    scroller.clientHeight = height;
    for (const observed of resized) observed();
    for (const frame of frames.splice(0)) frame();
  }

  /** The width of a Letter page fitted to a viewport `width` wide, with the gaps. */
  const fitWidth = (width: number) => (width - 24) / 612;

  it("goes to the page in range an index names: clamped, truncated, or not at all for NaN", async () => {
    const { viewer, scroller } = await viewing();
    const tops = viewer.store.get().layout?.tops ?? [];
    const at = () => [viewer.store.get().currentPage, scroller.scrollTop];
    viewer.goToPage(3);
    assert.deepEqual(at(), [3, (tops[3] ?? 0) - 12]);
    viewer.goToPage(Number.NaN);
    assert.deepEqual(at(), [3, (tops[3] ?? 0) - 12]);
    viewer.goToPage(1.5);
    assert.deepEqual(at(), [1, (tops[1] ?? 0) - 12]);
    viewer.goToPage(99);
    assert.deepEqual(at(), [4, (tops[4] ?? 0) - 12]);
    viewer.goToPage(Number.NEGATIVE_INFINITY);
    assert.deepEqual(at(), [0, 0]);
  });

  it("shows the row of the page an index names in page mode, and keeps it for NaN", async () => {
    const { viewer } = await viewing({ initialScrollMode: "page" });
    viewer.goToPage(2);
    viewer.goToPage(Number.NaN);
    assert.deepEqual(viewer.store.get().layout?.shown, { first: 2, last: 2 });
    viewer.goToPage(1.5);
    const layout = viewer.store.get().layout;
    assert.deepEqual(layout?.shown, { first: 1, last: 1 });
    assert.equal(layout?.totalHeight, (layout?.heights[1] ?? 0) + 24);
    assert.equal(viewer.store.get().currentPage, 1);
  });

  it("keeps fitting within scale limits that change, and clamps a custom zoom to them", async () => {
    const { viewer, scroller } = await viewing();
    const zoom = () => [viewer.store.get().scale, viewer.store.get().zoomMode];
    assert.deepEqual(zoom(), [fitWidth(1000), "fit-width"]);
    setViewerOptions(viewer, { minScale: 2 });
    assert.deepEqual(zoom(), [2, "fit-width"]);
    resize(scroller, 1400, 800);
    assert.deepEqual(zoom(), [fitWidth(1400), "fit-width"]);
    viewer.setScale(5);
    setViewerOptions(viewer, { minScale: 2, maxScale: 3 });
    assert.deepEqual(zoom(), [3, "custom"]);
  });

  it("opens at an initial scale within the limits", async () => {
    const { viewer } = await viewing({ initialScale: 20 });
    assert.deepEqual([viewer.store.get().scale, viewer.store.get().zoomMode], [10, "custom"]);
  });

  it("keeps a custom zoom within limits that change as the document is built again", async () => {
    const { viewer } = await viewing();
    viewer.setScale(5);
    setViewerOptions(viewer, { textLayer: false, maxScale: 2 });
    await settle();
    assert.deepEqual([viewer.store.get().scale, viewer.store.get().zoomMode], [2, "custom"]);
  });

  it("keeps a custom zoom within limits that changed while its viewport was away", async () => {
    const { viewer, scroller } = await viewing();
    viewer.setScale(5);
    release.shift()?.();
    setViewerOptions(viewer, { maxScale: 2 });
    attach(viewer, scroller);
    await settle();
    assert.deepEqual([viewer.store.get().scale, viewer.store.get().zoomMode], [2, "custom"]);
  });

  it("keeps the fitted zoom of a document built again while its viewport is hidden", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    resize(scroller, 0, 0);
    setViewerOptions(viewer, { textLayer: false });
    await settle();
    resize(scroller, 1000, 800);
    assert.equal(viewer.store.get().scale, fitWidth(1000));
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
  });

  it("keeps the fitted zoom of a viewport that attaches again while hidden", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    // The viewport's first detach, which viewing() released first.
    release.shift()?.();
    resized.splice(0);
    scroller.clientWidth = 0;
    scroller.clientHeight = 0;
    attach(viewer, scroller);
    await settle();
    resize(scroller, 1000, 800);
    assert.equal(viewer.store.get().scale, fitWidth(1000));
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
  });
});
