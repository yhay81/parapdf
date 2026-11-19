import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { searchOf } from "../src/features/search/index.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

describe("the search feature", () => {
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

  /** Two viewers of one document of three pages, "rose" on the first and last. */
  async function twoViewers() {
    const document = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      texts: [[{ str: "a rose" }], [{ str: "tulip" }], [{ str: "Rose and rose" }]],
    });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewers = [new ViewerController(), new ViewerController()] as const;
    for (const viewer of viewers) close.push(show(viewer, { url: "/a.pdf" }, loader).close);
    await settle();
    return { viewers, textsRead: document.textsRead };
  }

  /** Let a search run to its end: it yields to the main thread as it publishes. */
  async function finish() {
    for (let step = 0; step < 5; step++) {
      await settle();
      mock.timers.tick(0);
    }
    await settle();
  }

  it("finds the matches of every page", async () => {
    const { viewers } = await twoViewers();
    const search = searchOf(viewers[0]);
    search.get().search("rose");
    await finish();
    const { status, matches, current, pagesSearched } = search.get();
    assert.equal(status, "done");
    assert.deepEqual(
      matches.map((match) => match.pageIndex),
      [0, 2, 2],
    );
    assert.equal(current, 0);
    assert.equal(pagesSearched, 3);
    search.get().next();
    assert.equal(search.get().current, 1);
    search.get().previous();
    search.get().previous();
    assert.equal(search.get().current, 2);
  });

  it("selects the first match at or after the current page, else the first of all", async () => {
    const { viewers } = await twoViewers();
    const search = searchOf(viewers[0]);
    viewers[0].store.set({ currentPage: 1 });
    search.get().search("rose");
    await finish();
    assert.equal(search.get().current, 1);
    viewers[0].store.set({ currentPage: 2 });
    search.get().search("tulip");
    await finish();
    assert.equal(search.get().current, 0);
  });

  it("keeps the next match selected as the search publishes more pages and finishes", async (context) => {
    const document = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      texts: [
        [
          { str: "rose", x: 10 },
          { str: "rose", x: 50 },
        ],
        [],
        [{ str: "rose" }],
      ],
    });
    const viewer = new ViewerController();
    close.push(show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader).close);
    await settle();
    // Each page takes long enough for what was found so far to be published.
    let now = 0;
    context.mock.method(performance, "now", () => (now += 200));
    const search = searchOf(viewer);
    const scroll = context.mock.method(viewer, "revealRect");
    const unsubscribe = search.subscribe(() => {
      if (search.get().current < 0) return;
      unsubscribe();
      search.get().next();
    });
    search.get().search("rose");
    await settle();
    const second = search.get().matches[1];
    assert.ok(second);
    assert.deepEqual(
      scroll.mock.calls.map((call) => call.arguments[1].x),
      [50],
    );
    mock.timers.tick(0);
    await settle();
    const partial = search.get();
    assert.deepEqual([partial.status, partial.pagesSearched], ["searching", 2]);
    assert.strictEqual(partial.matches[partial.current], second);
    await finish();
    const done = search.get();
    assert.equal(done.status, "done");
    assert.strictEqual(done.matches[done.current], second);
  });

  it("starts on the current page and keeps the selected match as earlier pages arrive", async (context) => {
    const { viewers, textsRead } = await twoViewers();
    viewers[0].store.set({ currentPage: 2 });
    let now = 0;
    context.mock.method(performance, "now", () => (now += 200));
    const search = searchOf(viewers[0]);
    search.get().search("rose");
    await settle();
    assert.deepEqual(textsRead, [2]);
    const first = search.get();
    assert.deepEqual([first.pagesSearched, first.current, first.matches.length], [1, 0, 2]);
    const last = first.matches[1];
    assert.ok(last);
    search.get().previous();
    mock.timers.tick(0);
    await settle();
    const wrapped = search.get();
    assert.deepEqual([wrapped.status, wrapped.pagesSearched, wrapped.current], ["searching", 2, 2]);
    assert.deepEqual(
      wrapped.matches.map((match) => match.pageIndex),
      [0, 2, 2],
    );
    assert.strictEqual(wrapped.matches[wrapped.current], last);
    await finish();
    const done = search.get();
    assert.deepEqual(textsRead, [2, 0, 1]);
    assert.deepEqual([done.status, done.pagesSearched], ["done", 3]);
    assert.strictEqual(done.matches[done.current], last);
  });

  it("does nothing for a blank query, or to move through no matches", async () => {
    const { viewers, textsRead } = await twoViewers();
    const search = searchOf(viewers[0]);
    search.get().search(" \t ");
    await finish();
    assert.equal(search.get().status, "idle");
    assert.equal(search.get().query, " \t ");
    assert.deepEqual(textsRead, []);
    search.get().search("lily");
    await finish();
    search.get().next();
    search.get().previous();
    const { status, matches, current } = search.get();
    assert.deepEqual([status, matches.length, current], ["done", 0, -1]);
    assert.deepEqual(textsRead, [0, 1, 2]);
    search.get().clear();
    assert.equal(search.get().status, "idle");
    assert.equal(search.get().query, "");
  });

  it("indexes pages apart for each way of comparing, from the text read once", async () => {
    const { viewers, textsRead } = await twoViewers();
    const search = searchOf(viewers[0]);
    search.get().search("Rose", { caseSensitive: true });
    await finish();
    assert.equal(search.get().matches.length, 1);
    search.get().search("Rose");
    await finish();
    assert.equal(search.get().matches.length, 3);
    search.get().search("rose", { caseSensitive: true, entireWord: true });
    await finish();
    assert.equal(search.get().matches.length, 2);
    assert.deepEqual(textsRead, [0, 1, 2]);
  });

  it("reads each page's text once for every viewer of the document", async () => {
    const { viewers, textsRead } = await twoViewers();
    const first = searchOf(viewers[0]);
    const second = searchOf(viewers[1]);
    first.get().search("rose");
    await finish();
    second.get().search("rose", { caseSensitive: false });
    await finish();
    assert.equal(second.get().matches.length, 3);
    assert.deepEqual(textsRead, [0, 1, 2]);
  });

  it("does not publish an older query when a pending text read finishes", async () => {
    let releaseText!: () => void;
    const textsReady = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const document = fakeDocument({ texts: [[{ str: "rose tulip tulip" }]], textsReady });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new ViewerController();
    close.push(show(viewer, { url: "/slow.pdf" }, loader).close);
    await settle();
    const search = searchOf(viewer);
    search.get().search("rose");
    await settle();
    assert.deepEqual(document.textsRead, [0]);
    search.get().search("tulip");
    releaseText();
    await finish();
    const state = search.get();
    assert.equal(state.query, "tulip");
    assert.equal(state.status, "done");
    assert.equal(state.matches.length, 2);
    assert.deepEqual(document.textsRead, [0], "both queries share the pending read");
  });

  it("stays clear when a pending text read finishes", async () => {
    let releaseText!: () => void;
    const textsReady = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const document = fakeDocument({ texts: [[{ str: "rose" }]], textsReady });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new ViewerController();
    close.push(show(viewer, { url: "/slow.pdf" }, loader).close);
    await settle();
    const search = searchOf(viewer);
    search.get().search("rose");
    await settle();
    assert.deepEqual(document.textsRead, [0]);
    search.get().clear();
    releaseText();
    await finish();
    assert.equal(search.get().status, "idle");
    assert.equal(search.get().query, "");
    assert.deepEqual(search.get().matches, []);
  });

  it("keeps what it found while the viewer lets its document go, and forgets it with the session", async () => {
    const document = fakeDocument({
      pages: [LETTER, LETTER],
      texts: [[{ str: "a rose" }], [{ str: "rose" }]],
    });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new ViewerController();
    const shown = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    const search = searchOf(viewer);
    search.get().search("rose");
    await finish();
    const found = search.get();
    assert.deepEqual([found.status, found.matches.length], ["done", 2]);
    // Its provider lets the session go, as one React hides does.
    shown.close();
    assert.equal(viewer.session, null);
    assert.equal(search.get(), found, "the viewer may show the session again");
    close.push(show(viewer, { url: "/b.pdf" }, loader).close);
    assert.equal(search.get().status, "idle");
    assert.deepEqual(search.get().matches, []);
  });

  it("stops an in-flight search without publishing or reading further pages when its document closes", async () => {
    let releaseText!: () => void;
    const textsReady = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const document = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      texts: [[{ str: "hello" }], [{ str: "hello" }], [{ str: "hello" }]],
      textsReady,
    });
    const viewer = new ViewerController();
    const { close: closeDocument } = show(
      viewer,
      { url: "/closing-search.pdf" },
      fakePdfjs(async () => document.proxy).loader,
    );
    await settle();
    const search = searchOf(viewer);
    search.get().search("hello");
    assert.equal(search.get().status, "searching");
    await settle();
    assert.deepEqual(document.textsRead, [0], "the search reads a page at a time");
    closeDocument();
    releaseText();
    await finish();
    assert.equal(search.get().status, "idle", "the search publishes nothing after");
    assert.deepEqual(document.textsRead, [0], "and stopped after the page it was reading");
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
    const viewer = new ViewerController();
    close.push(
      show(viewer, { url: "/retry-search.pdf" }, fakePdfjs(async () => document.proxy).loader)
        .close,
    );
    await settle();
    const search = searchOf(viewer);
    search.get().search("hello");
    await settle();
    assert.equal(search.get().status, "done");
    assert.equal(search.get().matches.length, 0);
    search.get().search("hello");
    await finish();
    assert.equal(search.get().status, "done");
    assert.equal(search.get().matches.length, 1);
    assert.equal(attempts, 2);
  });

  it("shares one persistent search store per viewer", async () => {
    const { viewers } = await twoViewers();
    const own = searchOf(viewers[0]);
    assert.equal(searchOf(viewers[0]), own);
    assert.notEqual(searchOf(viewers[1]), own);
  });
});
