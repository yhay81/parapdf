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
import type { Rotation } from "../src/pdfjs/draw.ts";
import type { ViewerOptions } from "../src/view/options.ts";
import {
  attachViewport,
  holdViewer,
  openViewer,
  setViewerOptions,
  Viewer,
} from "../src/view/viewer.ts";
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
    const session = new PdfSession(source, { passwordPrompt, pdfjs: loader });
    close.push(connectSession(session));
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
    const loader = lockedPdfjs();
    const session = new PdfSession({ url: "/locked.pdf" }, { pdfjs: loader });
    const release = connectSession(session);
    await settle();
    release();
    close.push(connectSession(session));
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
      { passwordPrompt: false, pdfjs: loader },
    );
    const release = connectSession(wrong);
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
    const session = new PdfSession({ url: "/a.pdf" }, { pdfjs: loader });
    const release = connectSession(session);
    const first = await documentOf(session);
    const outline = session.outline();
    release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(first.signal.aborted, true, "the registry closed the first session");
    close.push(connectSession(session));
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

  it("stops what the viewer and session started for the document", async () => {
    const { loader, read } = slowTexts();
    const viewer = new Viewer();
    const { session: pdfSession, close: closeDocument } = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    assert.ok(viewer.store.get().layout);
    const session = viewer.session;
    const reading = getText(pdfSession);
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
    const { session: pdfSession, close: closeDocument } = show(
      viewer,
      { url: "/files/a.pdf" },
      loader,
    );
    await settle();
    const work = viewer.workSignal;
    assert.ok(viewer.session && viewer.permissions && viewer.renderer && viewer.layers && work);
    assert.equal(viewer.pdfSession, pdfSession);
    closeDocument();
    assert.equal(work.aborted, true);
    assert.deepEqual(
      [
        viewer.session,
        viewer.permissions,
        viewer.renderer,
        viewer.layers,
        viewer.workSignal,
        viewer.pdfSession,
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
    const { session: secondSession, close: closeSecond } = show(second, { url: "/a.pdf" }, loader);
    close.push(closeSecond);
    await settle();
    const session = second.session;
    assert.ok(session);
    assert.equal(first.session, session, "one session for both");
    const reading = getText(secondSession);
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
    readonly classes = new Set<string>();
    readonly classList = {
      toggle: (name: string, on: boolean) =>
        on ? this.classes.add(name) : this.classes.delete(name),
      remove: (name: string) => this.classes.delete(name),
    };
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

  it("opens another document at its own starting position with its own tool", async () => {
    for (const scrollMode of ["vertical", "horizontal"] as const) {
      for (const direction of ["ltr", "rtl"] as const) {
        const { viewer, scroller } = await viewing({
          initialScale: 2,
          initialScrollMode: scrollMode,
          direction,
        });
        const position = () => [
          scroller.scrollLeft,
          scroller.scrollTop,
          viewer.store.get().currentPage,
        ];
        const opening = position();
        viewer.goToPage(3);
        scroller.scrollLeft += 100;
        scroller.scrollTop += 100;
        viewer.setTool("hand");
        assert.notDeepEqual(position(), opening);
        assert.ok(scroller.classes.has("parapdf-hand"));

        const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
        const loader = fakePdfjs(async () => document.proxy).loader;
        release.push(show(viewer, { url: `/next-${direction}-${scrollMode}.pdf` }, loader).close);
        await settle();
        assert.deepEqual(position(), opening, `${direction} ${scrollMode}`);
        assert.equal(viewer.store.get().tool, "select");
        assert.equal(scroller.classes.has("parapdf-hand"), false);
      }
    }
  });

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

  it("fits again as the scale limits change, widening or narrowing", async () => {
    const { viewer } = await viewing();
    const zoom = () => [viewer.store.get().scale, viewer.store.get().zoomMode];
    setViewerOptions(viewer, { maxScale: 1 });
    assert.deepEqual(zoom(), [1, "fit-width"]);
    setViewerOptions(viewer, {});
    assert.deepEqual(zoom(), [fitWidth(1000), "fit-width"]);
    setViewerOptions(viewer, { minScale: 2 });
    assert.deepEqual(zoom(), [2, "fit-width"]);
    setViewerOptions(viewer, { minScale: 1 });
    assert.deepEqual(zoom(), [fitWidth(1000), "fit-width"]);
  });

  it("does nothing for a NaN scale, zoom factor, or rotation, or a rotation not finite", async () => {
    const { viewer } = await viewing();
    viewer.setScale(2);
    viewer.setScale(Number.NaN);
    viewer.zoomBy(Number.NaN);
    viewer.setRotation(Number.NaN as Rotation);
    viewer.setRotation(Number.POSITIVE_INFINITY as Rotation);
    viewer.rotate(Number.NaN);
    const { scale, zoomMode, rotation, layout } = viewer.store.get();
    assert.deepEqual([scale, zoomMode, rotation, layout?.scale], [2, "custom", 0, 2]);
  });

  it("reveals a rect on the page a fractional index truncates to, and nothing for NaN", async () => {
    const { viewer, scroller } = await viewing();
    const rect = { x: 0, y: 400, width: 100, height: 20 };
    const at = () => [viewer.store.get().currentPage, scroller.scrollTop];
    viewer.revealRect(2, rect);
    const revealed = at();
    viewer.goToPage(0);
    viewer.revealRect(2.7, rect);
    assert.deepEqual(at(), revealed);
    viewer.revealRect(Number.NaN, rect);
    assert.deepEqual(at(), revealed);
  });

  it("keeps the page and rotation a view shows as NaN", async () => {
    const { viewer } = await viewing();
    viewer.goToPage(2);
    viewer.show({
      target: { pageIndex: Number.NaN, x: null, y: null },
      rotation: Number.NaN as Rotation,
    });
    assert.deepEqual([viewer.store.get().currentPage, viewer.store.get().rotation], [2, 0]);
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

  it("opens the new document at the start when it replaces one while detached", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(3);
    release.shift()?.();
    const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
    release.push(
      show(viewer, { url: "/replacement.pdf" }, fakePdfjs(async () => document.proxy).loader).close,
    );
    attach(viewer, scroller);
    await settle();
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [0, 0]);
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

  /**
   * A provider's session, its viewer, and the viewer's owner as React
   * mounts them: the viewport's layout effect, then the passive ones, a
   * child's before its parent's. The returned `hide` destroys them in that
   * order, as React does when it hides the tree or unmounts it.
   */
  function mount(viewer: Viewer, scroller: Scroller, session: PdfSession): () => void {
    const detach = attach(viewer, scroller);
    openViewer(viewer, session);
    const releaseSession = connectSession(session);
    const releaseViewer = holdViewer(viewer);
    const hide = () => {
      detach();
      releaseSession();
      releaseViewer();
    };
    release.push(hide);
    return hide;
  }

  /** pdf.js whose documents have five Letter pages. */
  const fivePages = () =>
    fakePdfjs(async () => fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) }).proxy);

  it("shows a session again where and how it showed it, once React shows what it hid", async () => {
    // Within the second the document stays open for, and after it closed.
    for (const away of [999, 1000]) {
      const { loader, calls } = fivePages();
      const session = new PdfSession({ url: "/a.pdf" }, { pdfjs: loader });
      const viewer = new Viewer();
      const scroller = new Scroller();
      const hide = mount(viewer, scroller, session);
      await settle();
      viewer.setScale(2);
      viewer.setRotation(90);
      viewer.setTool("hand");
      viewer.goToPage(3);
      const shown = viewer.session;
      const view = () => {
        const { currentPage, scale, zoomMode, rotation, tool } = viewer.store.get();
        return [currentPage, scale, zoomMode, rotation, tool, scroller.scrollTop];
      };
      const before = view();
      assert.deepEqual(before.slice(0, 5), [3, 2, "custom", 90, "hand"]);
      assert.ok(shown && scroller.scrollTop > 0);

      hide();
      assert.deepEqual(
        [viewer.session, viewer.renderer, viewer.pdfSession, viewer.store.get().layout],
        [null, null, null, null],
      );
      mock.timers.tick(away);
      await settle();
      assert.equal(shown.signal.aborted, away === 1000);

      mount(viewer, scroller, session);
      await settle();
      assert.equal(viewer.session === shown, away < 1000, "the document that stayed open");
      assert.equal(viewer.pdfSession, session);
      assert.deepEqual(view(), before, `away for ${away} ms`);
      assert.equal(calls.opens, away < 1000 ? 1 : 2);
    }
  });

  it("forgets the previous document when its URL returns different content or a new revision", async () => {
    for (const fingerprints of [
      ["different", null],
      ["original", "updated"],
    ]) {
      let identity: (string | null)[] = ["original", null];
      const { loader } = fakePdfjs(
        async () =>
          fakeDocument({
            pages: [LETTER, LETTER],
            proxy: { fingerprints: identity },
          }).proxy,
      );
      const session = new PdfSession({ url: "/latest.pdf" }, { pdfjs: loader });
      const viewer = new Viewer();
      const scroller = new Scroller();
      const forgotten: boolean[] = [];
      viewer.extend({ closed: (kept) => void forgotten.push(kept) });
      const hide = mount(viewer, scroller, session);
      await settle();
      viewer.setScale(2);
      viewer.goToPage(1);
      hide();
      mock.timers.tick(1000);
      await settle();
      identity = fingerprints;
      mount(viewer, scroller, session);
      await settle();
      assert.deepEqual(forgotten, [true, false], "clear edits and search before restoring");
      assert.equal(viewer.store.get().currentPage, 0);
      assert.equal(viewer.store.get().zoomMode, "fit-width");
    }
  });

  it("shows a document once, however often React runs the effects that mount it", async () => {
    const { loader, calls } = fivePages();
    const session = new PdfSession({ url: "/a.pdf" }, { pdfjs: loader });
    const viewer = new Viewer({ initialScale: 2 });
    const heard: string[] = [];
    viewer.extend({
      ready: () => void heard.push("ready"),
      closed: (kept) => void heard.push(`closed ${kept}`),
    });
    const scroller = new Scroller();
    // StrictMode mounts, unmounts, and mounts again, before the document loads.
    mount(viewer, scroller, session)();
    mount(viewer, scroller, session);
    await settle();
    assert.ok(viewer.store.get().layout);
    assert.equal(viewer.store.get().scale, 2);
    assert.deepEqual(heard, ["closed true", "ready"]);
    assert.equal(calls.opens, 1);
  });

  it("lets go of a document its owner lets go, whatever the provider holds, and shows it again", async () => {
    const { loader, calls } = fivePages();
    const viewer = new Viewer();
    const scroller = new Scroller();
    attach(viewer, scroller);
    // The provider stays mounted; React hides the component that owns the viewer.
    release.push(show(viewer, { url: "/a.pdf" }, loader).close);
    const letGo = holdViewer(viewer);
    await settle();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    const shown = viewer.session;
    assert.ok(shown);
    letGo();
    assert.deepEqual([viewer.session, viewer.store.get().layout], [null, null]);
    assert.equal(scroller.scrollTop, 0, "the viewport shows nothing of it");
    letGo();
    release.push(holdViewer(viewer));
    await settle();
    assert.equal(viewer.session, shown);
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
    assert.equal(calls.opens, 1);
  });

  it("forgets the view of a session it let go once another session opens", async () => {
    const { loader } = fivePages();
    const viewer = new Viewer();
    const heard: boolean[] = [];
    viewer.extend({ closed: (kept) => void heard.push(kept) });
    const scroller = new Scroller();
    const first = new PdfSession({ url: "/a.pdf" }, { pdfjs: loader });
    const hide = mount(viewer, scroller, first);
    await settle();
    viewer.setScale(2);
    viewer.goToPage(3);
    hide();
    assert.deepEqual(heard, [true]);
    mount(viewer, scroller, new PdfSession({ url: "/b.pdf" }, { pdfjs: loader }));
    assert.deepEqual(heard, [true, false], "features drop what they kept for the first");
    await settle();
    const { currentPage, scale, zoomMode } = viewer.store.get();
    assert.deepEqual([currentPage, scale, zoomMode], [0, fitWidth(1000), "fit-width"]);
    assert.equal(scroller.scrollTop, 0);
  });
});
