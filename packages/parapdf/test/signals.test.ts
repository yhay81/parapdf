import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { linked } from "../src/view/signals.ts";

describe("linked", () => {
  it("is aborted at once, with the reason, by a parent aborted already", () => {
    const reason = new Error("closed");
    const controller = linked(undefined, AbortSignal.abort(reason), new AbortController().signal);
    assert.equal(controller.signal.aborted, true);
    assert.equal(controller.signal.reason, reason);
  });

  it("aborts with the first parent that aborts, and its reason", () => {
    const first = new AbortController();
    const second = new AbortController();
    const controller = linked(first.signal, second.signal);
    assert.equal(controller.signal.aborted, false);
    second.abort("detached");
    first.abort("closed");
    assert.equal(controller.signal.reason, "detached");
  });

  it("stops listening to its parents once it aborts on its own", () => {
    const parent = new AbortController();
    const controller = linked(parent.signal);
    assert.equal(getEventListeners(parent.signal, "abort").length, 1);
    controller.abort();
    assert.equal(getEventListeners(parent.signal, "abort").length, 0);
  });

  it("stops listening to the others once a parent aborts it", () => {
    const first = new AbortController();
    const second = new AbortController();
    linked(first.signal, second.signal);
    first.abort();
    assert.equal(getEventListeners(second.signal, "abort").length, 0);
  });

  it("is a controller of its own without parents", () => {
    const controller = linked();
    assert.equal(controller.signal.aborted, false);
    controller.abort();
    assert.equal(controller.signal.aborted, true);
  });
});
