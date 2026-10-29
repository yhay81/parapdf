import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { move, positionOf, scrollEdges, viewportOf } from "../src/view/scrolling.ts";

describe("scroll motion", () => {
  it("smooths nearby moves, resets after a pause, and keeps direction", () => {
    const motion = { position: 0, at: 0, velocity: 0 };
    move(motion, 100, 20);
    assert.equal(motion.velocity, 2);
    move(motion, 40, 40);
    assert.ok(Math.abs(motion.velocity - 0) < 1e-12);
    move(motion, -220, 170);
    assert.equal(motion.velocity, -2);
  });

  it("does not divide by zero when two moves have the same timestamp", () => {
    const motion = { position: 10, at: 20, velocity: 3 };
    move(motion, 30, 20);
    assert.deepEqual(motion, { position: 30, at: 20, velocity: 3 });
    move(motion, 40, 30);
    assert.ok(Math.abs(motion.velocity - 2.2) < 1e-12);
  });

  it("measures horizontal motion along x and other modes along y", () => {
    const viewport = { left: 12, top: 34 };
    assert.equal(positionOf("horizontal", viewport), 12);
    for (const mode of ["vertical", "wrapped", "page"] as const) {
      assert.equal(positionOf(mode, viewport), 34);
    }
  });
});

describe("scroll edges and viewport", () => {
  it("uses the browser's actual far edge and restores a fractional position", () => {
    const scroller = {
      scrollLeft: 584.5,
      scrollTop: 199.5,
      scrollTo(left: number, top: number) {
        this.scrollLeft = Math.max(0, Math.min(left, 585));
        this.scrollTop = Math.max(0, Math.min(top, 200));
      },
    };
    assert.deepEqual(scrollEdges(scroller as unknown as HTMLElement), {
      atTop: false,
      atBottom: true,
      atLeft: false,
      atRight: true,
    });
    assert.equal(scroller.scrollLeft, 584.5);
    assert.equal(scroller.scrollTop, 199.5);
    scroller.scrollTo(583.9, 198.9);
    assert.equal(scrollEdges(scroller as unknown as HTMLElement).atRight, false);
    assert.equal(scrollEdges(scroller as unknown as HTMLElement).atBottom, false);
  });

  it("includes content under a stable gutter only at the far edge", () => {
    const scroller = {
      scrollLeft: 584,
      scrollTop: 27,
      clientWidth: 400,
      offsetWidth: 415,
      scrollWidth: 1000,
      clientHeight: 300,
    };
    const element = scroller as unknown as HTMLElement;
    assert.deepEqual(viewportOf(element), {
      left: 584,
      top: 27,
      width: 416,
      height: 300,
      scrollerWidth: 400,
      scrollerHeight: 300,
    });
    scroller.scrollLeft = 583;
    assert.equal(viewportOf(element).width, 400);
  });
});
