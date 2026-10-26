import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type InputHost, ViewerInput } from "../src/view/input.ts";
import type { PointerTool } from "../src/view/state.ts";

// Key events' targets are checked against Element, which Node lacks.
globalThis.Element ??= class {} as typeof Element;

/** A scroller scrolled to `top` of 0 to 1000, listening as the input attaches. */
function fakeScroller(top = 0) {
  const listeners = new Map<string, (event: unknown) => void>();
  const classes = new Set<string>();
  const scroller = {
    scrollTop: top,
    scrollLeft: 0,
    scrollHeight: 1400,
    clientHeight: 400,
    scrollWidth: 600,
    clientWidth: 600,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (...names: string[]) => {
        for (const name of names) classes.delete(name);
      },
    },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    scrollTo(left: number, top: number) {
      this.scrollLeft = Math.min(left, this.scrollWidth - this.clientWidth);
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
    },
    focus: () => {},
    setPointerCapture: () => {},
  };
  const fire = (type: string, event: object) => {
    let prevented = false;
    listeners.get(type)?.({ preventDefault: () => (prevented = true), ...event });
    return prevented;
  };
  return { scroller, listeners, classes, fire };
}

function setUp(state: { tool: PointerTool; scrollMode: "vertical" | "page" }, top = 0) {
  const fake = fakeScroller(top);
  const calls: string[] = [];
  const host: InputHost = {
    scroller: () => fake.scroller as unknown as HTMLElement,
    state: () => state,
    pointerClaimed: () => false,
    pageCount: () => 5,
    flip: (direction, axis) => {
      calls.push(`flip ${direction} ${axis}`);
      return true;
    },
    goToPage: (index) => calls.push(`page ${index}`),
    zoomBy: (factor) => calls.push(`zoom ${factor}`),
    resetScale: () => calls.push("reset"),
  };
  const input = new ViewerInput(host);
  const detach = input.attach(fake.scroller as unknown as HTMLElement);
  return { ...fake, calls, input, detach };
}

describe("ViewerInput", () => {
  it("zooms with Ctrl or ⌘ and +, -, or 0", () => {
    const { fire, calls } = setUp({ tool: "select", scrollMode: "vertical" });
    assert.equal(fire("keydown", { key: "=", ctrlKey: true }), true);
    assert.equal(fire("keydown", { key: "-", metaKey: true }), true);
    assert.equal(fire("keydown", { key: "0", ctrlKey: true }), true);
    assert.equal(fire("keydown", { key: "a", ctrlKey: true }), false);
    assert.equal(fire("keydown", { key: "=", ctrlKey: true, altKey: true }), false);
    assert.deepEqual(calls, ["zoom 1.25", "zoom 0.8", "reset"]);
  });

  it("flips pages in page mode only at the edge a key crosses", () => {
    const top = setUp({ tool: "select", scrollMode: "page" });
    assert.equal(top.fire("keydown", { key: "PageDown" }), false);
    assert.equal(top.fire("keydown", { key: "ArrowUp" }), true);
    assert.equal(top.fire("keydown", { key: "End" }), true);
    assert.deepEqual(top.calls, ["flip -1 y", "page 4"]);
    const bottom = setUp({ tool: "select", scrollMode: "page" }, 1000);
    assert.equal(bottom.fire("keydown", { key: " " }), true);
    assert.deepEqual(bottom.calls, ["flip 1 y"]);
    const scrolling = setUp({ tool: "select", scrollMode: "vertical" }, 1000);
    assert.equal(scrolling.fire("keydown", { key: " " }), false);
    assert.deepEqual(scrolling.calls, []);
  });

  it("scrolls with the hand tool's drag and lets go when the tool changes", () => {
    const state: { tool: PointerTool; scrollMode: "vertical" } = {
      tool: "hand",
      scrollMode: "vertical",
    };
    const { fire, scroller, classes, input } = setUp(state, 500);
    const at = (x: number, y: number) => ({ pointerId: 1, clientX: x, clientY: y });
    fire("pointerdown", { ...at(100, 100), pointerType: "mouse", button: 0, target: null });
    assert.ok(classes.has("parapdf-grabbing"));
    fire("pointermove", at(90, 60));
    assert.equal(scroller.scrollTop, 540);
    assert.equal(scroller.scrollLeft, 10);
    input.release();
    assert.ok(!classes.has("parapdf-grabbing"));
    fire("pointermove", at(0, 0));
    assert.equal(scroller.scrollTop, 540);
  });

  it("leaves touches and the select tool to the browser, and stops listening on detach", () => {
    const state: { tool: PointerTool; scrollMode: "vertical" } = {
      tool: "hand",
      scrollMode: "vertical",
    };
    const { fire, classes, listeners, detach } = setUp(state);
    const down = { pointerId: 1, clientX: 0, clientY: 0, button: 0, target: null };
    assert.equal(fire("pointerdown", { ...down, pointerType: "touch" }), false);
    state.tool = "select";
    assert.equal(fire("pointerdown", { ...down, pointerType: "mouse" }), false);
    assert.ok(!classes.has("parapdf-grabbing"));
    detach();
    assert.equal(listeners.size, 0);
  });
});
