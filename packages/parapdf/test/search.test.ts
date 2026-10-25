import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { attachSearch, searchOf } from "../src/features/search/index.ts";
import { Viewer } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

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
    const viewers = [new Viewer({}, loader), new Viewer({}, loader)] as const;
    for (const viewer of viewers) close.push(viewer.open({ url: "/a.pdf" }));
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
