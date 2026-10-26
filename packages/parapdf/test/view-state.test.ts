import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Viewer } from "../src/view/viewer.ts";

describe("view state publication", () => {
  it("keeps hot, cold, and feature notifications separate", () => {
    const { store } = new Viewer();
    const initialHot = store.hot.get();
    const initialCold = store.cold.get();
    let hot = 0;
    let cold = 0;
    let all = 0;
    store.hot.subscribe(() => hot++);
    const unsubscribe = store.cold.subscribe(() => cold++);
    store.subscribe(() => all++);
    store.set({ currentPage: 5 });
    assert.deepEqual([hot, cold, all], [1, 0, 1]);
    assert.equal(store.cold.get(), initialCold);
    store.set({ tool: "hand" });
    assert.deepEqual([hot, cold, all], [1, 1, 2]);
    assert.notEqual(store.hot.get(), initialHot);
    store.set({ currentPage: 5, tool: "hand" });
    assert.deepEqual([hot, cold, all], [1, 1, 2]);
    unsubscribe();
    store.set({ tool: "select" });
    assert.equal(cold, 1);
  });

  it("installs all snapshots before any subscriber reads a mixed hot/cold update", () => {
    const { store } = new Viewer();
    const check = () => {
      assert.equal(store.get().scale, 2);
      assert.equal(store.hot.get().scale, 2);
      assert.equal(store.get().rotation, 90);
      assert.equal(store.cold.get().rotation, 90);
    };
    store.subscribe(check);
    store.hot.subscribe(check);
    store.cold.subscribe(check);
    store.set({ scale: 2, rotation: 90 });
  });

  it("does not share view state or lifetime between viewers", () => {
    const left = new Viewer();
    const right = new Viewer();
    const before = right.store.get();
    left.store.set({ scale: 3, rotation: 90, currentPage: 8 });
    assert.equal(right.store.get(), before);
    assert.notEqual(left.signal, right.signal);
  });
});
