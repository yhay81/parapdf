import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRenderCancelled, RenderCancelledError } from "../src/engine/types.ts";
import { Store } from "../src/runtime/store.ts";

describe("Store", () => {
  it("publishes only when a field changes", () => {
    const store = new Store({ page: 0, scale: 1 });
    let published = 0;
    store.subscribe(() => published++);
    store.set({ page: 0 });
    store.set({ page: 0, scale: 1 });
    assert.equal(published, 0);
    const before = store.get();
    store.set({ page: 2 });
    assert.equal(published, 1);
    assert.deepEqual(store.get(), { page: 2, scale: 1 });
    // A new state object, so React sees the change.
    assert.notEqual(store.get(), before);
  });

  it("stops publishing to a listener that unsubscribed", () => {
    const store = new Store({ page: 0 });
    let published = 0;
    const unsubscribe = store.subscribe(() => published++);
    store.set({ page: 1 });
    unsubscribe();
    store.set({ page: 2 });
    assert.equal(published, 1);
  });
});

describe("isRenderCancelled", () => {
  it("recognizes ParaPDF's and pdf.js's cancellations", () => {
    assert.equal(isRenderCancelled(new RenderCancelledError("cancelled")), true);
    for (const name of ["RenderingCancelledException", "AbortException"]) {
      const error = new Error("cancelled");
      error.name = name;
      assert.equal(isRenderCancelled(error), true, name);
    }
  });

  it("leaves every other failure alone", () => {
    assert.equal(isRenderCancelled(new Error("broken")), false);
    assert.equal(isRenderCancelled("RenderCancelledError"), false);
    assert.equal(isRenderCancelled(null), false);
  });
});
