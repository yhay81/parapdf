import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLayout, type Viewport } from "../src/view/layout.ts";
import { blankFraction, sharpness } from "../src/view/metrics.ts";

// Two US Letter pages in a column, 10 px apart and from the edges.
const layout = computeLayout(
  [
    { width: 612, height: 792 },
    { width: 612, height: 792 },
  ],
  1,
  { gap: 10 },
);
const WIDTH = 632;
const view = (top: number, height = 400): Viewport => ({
  left: 0,
  top,
  width: WIDTH,
  height,
  scrollerWidth: WIDTH,
  scrollerHeight: height,
});
// From 600 to 1000, page 0 shows down to its bottom at 802 and page 1 from its top at 812.
const SHOWN = [802 - 600, 1000 - 812];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9);

describe("blankFraction", () => {
  it("counts the visible area of pages without pixels", () => {
    close(
      blankFraction(layout, view(0), () => false),
      (612 * 390) / (WIDTH * 400),
    );
    assert.equal(
      blankFraction(layout, view(0), () => true),
      0,
    );
  });

  it("leaves out the pages that show pixels", () => {
    close(
      blankFraction(layout, view(600), (index) => index === 0),
      (612 * (SHOWN[1] ?? 0)) / (WIDTH * 400),
    );
  });

  it("is 0 for a viewport with no height or no width", () => {
    assert.equal(
      blankFraction(layout, view(0, 0), () => false),
      0,
    );
    assert.equal(
      blankFraction(layout, { ...view(0), width: 0, scrollerWidth: 0 }, () => false),
      0,
    );
  });

  it("is 0 for a viewport that shows only the gap between pages", () => {
    assert.equal(
      blankFraction(layout, view(802, 10), () => false),
      0,
    );
  });
});

describe("sharpness", () => {
  it("weights each page's sharpness by its visible area", () => {
    const needed: number[] = [];
    const sharp = sharpness(layout, view(600), 2, (index, _area, at) => {
      needed.push(at);
      return index === 0 ? 1 : 0.5;
    });
    const [first = 0, second = 0] = SHOWN;
    close(sharp, (first + second * 0.5) / (first + second));
    assert.deepEqual(needed, [2, 2]);
  });

  it("is 0 with no page visible or no height", () => {
    assert.equal(
      sharpness(layout, view(0, 0), 1, () => 1),
      0,
    );
    assert.equal(
      sharpness(layout, view(5000), 1, () => 1),
      0,
    );
  });
});
