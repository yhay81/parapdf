import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLayout } from "../src/view/layout.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { LETTER } from "./fake-pdfjs.ts";

describe("view state publication", () => {
  it("notifies only key-matching subscribers on single-store updates", () => {
    const { store } = new ViewerController();
    let windowHits = 0;
    let currentHits = 0;
    let toolHits = 0;
    let rotationHits = 0;
    let sizesHits = 0;
    let externalLinksHits = 0;
    let all = 0;

    store.subscribeKeys(["layout", "first", "last"], () => windowHits++);
    store.subscribeKeys(["currentPage"], () => currentHits++);
    const unsubscribeTool = store.subscribeKeys(["tool"], () => toolHits++);
    store.subscribeKeys(["rotation"], () => rotationHits++);
    store.subscribeKeys(["sizes"], () => sizesHits++);
    store.subscribeKeys(["externalLinks"], () => externalLinksHits++);
    store.subscribe(() => all++);

    store.set({ currentPage: 5 });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [0, 1, 0, 0, 0, 0, 1],
    );

    store.set({ first: 2, last: 6 });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 0, 0, 0, 0, 2],
    );

    store.set({ tool: "hand" });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 0, 3],
    );

    // No-op patch allocates and notifies nothing.
    store.set({ currentPage: 5, tool: "hand" });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 0, 3],
    );

    store.setExternalLinks("disabled");
    assert.equal(store.externalLinks, "disabled");
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 1, 4],
    );

    unsubscribeTool();
    store.set({ tool: "select" });
    assert.equal(toolHits, 1);
  });

  it("installs ViewerState and derived sizes atomically before notifying any subscriber", () => {
    const { store } = new ViewerController();
    const pages = [LETTER, LETTER];
    const layout = computeLayout(pages, 2, {
      gap: 12,
      rotation: 90,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 0,
    });
    const check = () => {
      assert.equal(store.get().scale, 2);
      assert.equal(store.get().rotation, 90);
      assert.equal(store.get().pageCount, 2);
      assert.equal(store.sizes, pages);
    };
    store.subscribe(check);
    store.subscribeKeys(["scale"], check);
    store.subscribeKeys(["rotation"], check);
    store.subscribeKeys(["sizes"], check);
    store.set({ layout, scale: 2, rotation: 90 });
  });

  it("does not share view state or lifetime between viewers", () => {
    const left = new ViewerController();
    const right = new ViewerController();
    const before = right.store.get();
    left.store.set({ scale: 3, rotation: 90, currentPage: 8 });
    assert.equal(right.store.get(), before);
    assert.notEqual(left.signal, right.signal);
  });
});
