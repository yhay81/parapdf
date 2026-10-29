import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { attachSearch, searchOf } from "../src/features/search/index.ts";
import { Viewer } from "../src/view/viewer.ts";
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
    const viewers = [new Viewer(), new Viewer()] as const;
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
    const search = attachSearch(viewers[0]);
    search.search("rose");
    await finish();
    const { status, matches, current, pagesSearched } = search.store.get();
    assert.equal(status, "done");
    assert.deepEqual(
      matches.map((match) => match.pageIndex),
      [0, 2, 2],
    );
    assert.equal(current, 0);
    assert.equal(pagesSearched, 3);
    search.next();
    assert.equal(search.store.get().current, 1);
    search.previous();
    search.previous();
    assert.equal(search.store.get().current, 2);
  });

  it("selects the first match at or after the current page, else the first of all", async () => {
    const { viewers } = await twoViewers();
    const search = attachSearch(viewers[0]);
    viewers[0].store.set({ currentPage: 1 });
    search.search("rose");
    await finish();
    assert.equal(search.store.get().current, 1);
    viewers[0].store.set({ currentPage: 2 });
    search.search("tulip");
    await finish();
    assert.equal(search.store.get().current, 0);
  });

  it("goes back from no selection to the last match", async (context) => {
    const document = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      texts: [[{ str: "rose rose" }], [], [{ str: "rose" }]],
    });
    const viewer = new Viewer();
    close.push(show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader).close);
    await settle();
    viewer.store.set({ currentPage: 2 });
    // Each page takes long enough for what was found so far to be published.
    let now = 0;
    context.mock.method(performance, "now", () => (now += 200));
    const search = attachSearch(viewer);
    search.search("rose");
    await settle();
    const { status, matches, current } = search.store.get();
    assert.deepEqual([status, matches.length, current], ["searching", 2, -1]);
    search.previous();
    assert.equal(search.store.get().current, 1);
  });

  it("does nothing for a blank query, or to move through no matches", async () => {
    const { viewers, textsRead } = await twoViewers();
    const search = attachSearch(viewers[0]);
    search.search(" \t ");
    await finish();
    assert.equal(search.store.get().status, "idle");
    assert.equal(search.store.get().query, " \t ");
    assert.deepEqual(textsRead, []);
    search.search("lily");
    await finish();
    search.next();
    search.previous();
    const { status, matches, current } = search.store.get();
    assert.deepEqual([status, matches.length, current], ["done", 0, -1]);
    assert.deepEqual(textsRead, [0, 1, 2]);
    search.clear();
    assert.equal(search.store.get().status, "idle");
    assert.equal(search.store.get().query, "");
  });

  it("indexes pages apart for each way of comparing, from the text read once", async () => {
    const { viewers, textsRead } = await twoViewers();
    const search = attachSearch(viewers[0]);
    search.search("Rose", { caseSensitive: true });
    await finish();
    assert.equal(search.store.get().matches.length, 1);
    search.search("Rose");
    await finish();
    assert.equal(search.store.get().matches.length, 3);
    search.search("rose", { caseSensitive: true, entireWord: true });
    await finish();
    assert.equal(search.store.get().matches.length, 2);
    assert.deepEqual(textsRead, [0, 1, 2]);
  });

  it("reads each page's text once for every viewer of the document", async () => {
    const { viewers, textsRead } = await twoViewers();
    const first = attachSearch(viewers[0]);
    const second = attachSearch(viewers[1]);
    first.search("rose");
    await finish();
    second.search("rose", { caseSensitive: false });
    await finish();
    assert.equal(second.store.get().matches.length, 3);
    assert.deepEqual(textsRead, [0, 1, 2]);
  });

  it("does not publish an older query when a pending text read finishes", async () => {
    let releaseText!: () => void;
    const textsReady = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const document = fakeDocument({ texts: [[{ str: "rose tulip tulip" }]], textsReady });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new Viewer();
    close.push(show(viewer, { url: "/slow.pdf" }, loader).close);
    await settle();
    const search = attachSearch(viewer);
    search.search("rose");
    await settle();
    assert.deepEqual(document.textsRead, [0]);
    search.search("tulip");
    releaseText();
    await finish();
    const state = search.store.get();
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
    const viewer = new Viewer();
    close.push(show(viewer, { url: "/slow.pdf" }, loader).close);
    await settle();
    const search = attachSearch(viewer);
    search.search("rose");
    await settle();
    assert.deepEqual(document.textsRead, [0]);
    search.clear();
    releaseText();
    await finish();
    assert.equal(search.store.get().status, "idle");
    assert.equal(search.store.get().query, "");
    assert.deepEqual(search.store.get().matches, []);
  });

  it("stops when detached, and the viewer hears nothing more of it", async () => {
    const { viewers, textsRead } = await twoViewers();
    const search = attachSearch(viewers[0]);
    search.search("rose");
    search.detach();
    await finish();
    assert.equal(search.store.get().status, "idle");
    assert.ok(textsRead.length <= 1, "it stopped after the page it was reading");
  });

  it("is one per viewer until detached", async () => {
    const { viewers } = await twoViewers();
    const own = searchOf(viewers[0]);
    assert.equal(searchOf(viewers[0]), own);
    assert.notEqual(searchOf(viewers[1]), own);
    own.detach();
    assert.notEqual(searchOf(viewers[0]), own);
  });
});
