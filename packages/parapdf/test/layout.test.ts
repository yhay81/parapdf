import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaSize,
  computeLayout,
  intersectAreas,
  pageAt,
  pageLeft,
  turnBox,
  turnedSize,
  visibleArea,
  visibleRange,
} from "../src/runtime/layout.ts";

// A US Letter page and an A4 page in landscape, 10 CSS pixels apart.
const sizes = [
  { width: 612, height: 792 },
  { width: 842, height: 595 },
];

describe("computeLayout", () => {
  it("stacks pages with the gap between and around them", () => {
    const layout = computeLayout(sizes, 1, 10);
    assert.deepEqual([...layout.tops], [10, 812]);
    assert.deepEqual([...layout.widths], [612, 842]);
    assert.deepEqual([...layout.heights], [792, 595]);
    assert.equal(layout.totalHeight, 1417);
    assert.equal(layout.totalWidth, 862);
  });

  it("rounds page boxes to whole CSS pixels", () => {
    const layout = computeLayout(sizes, 1 / 3, 10);
    assert.deepEqual([...layout.widths], [204, 281]);
    assert.deepEqual([...layout.heights], [264, 198]);
  });

  it("swaps the page boxes of a quarter turn", () => {
    const layout = computeLayout(sizes, 1, 10, 90);
    assert.deepEqual([...layout.widths], [792, 595]);
    assert.deepEqual([...layout.heights], [612, 842]);
    // The sizes stay unturned.
    assert.deepEqual(layout.sizes, sizes);
  });
});

describe("pageAt and visibleRange", () => {
  const layout = computeLayout(sizes, 1, 10);

  it("finds the last page whose top is at or above a point", () => {
    assert.equal(pageAt(layout, 0), 0);
    assert.equal(pageAt(layout, 811), 0);
    assert.equal(pageAt(layout, 812), 1);
    assert.equal(pageAt(layout, 1e9), 1);
  });

  it("starts a band that begins in a gap with the next page", () => {
    assert.deepEqual(visibleRange(layout, 805, 100), { first: 1, last: 1 });
    assert.deepEqual(visibleRange(layout, 0, 900), { first: 0, last: 1 });
  });

  it("is empty for a document without pages", () => {
    assert.deepEqual(visibleRange(computeLayout([], 1, 10), 0, 900), { first: 0, last: -1 });
  });
});

describe("pageLeft and visibleArea", () => {
  const layout = computeLayout(sizes, 1, 10);

  it("centers each page in the viewport, at the gap when it is wider", () => {
    assert.equal(pageLeft(layout, 0, 1000), 194);
    assert.equal(pageLeft(layout, 1, 1000), 79);
    assert.equal(pageLeft(layout, 1, 700), 10);
  });

  it("gives the part of a page in the viewport as fractions of the page", () => {
    const viewport = { left: 0, top: 10, width: 1000, height: 396 };
    assert.deepEqual(visibleArea(layout, 0, viewport), { minX: 0, minY: 0, maxX: 1, maxY: 0.5 });
    assert.equal(visibleArea(layout, 1, viewport), null);
  });

  it("measures and intersects areas", () => {
    const a = { minX: 0, minY: 0, maxX: 0.5, maxY: 1 };
    const b = { minX: 0.25, minY: 0.5, maxX: 1, maxY: 1 };
    assert.equal(areaSize(a), 0.5);
    assert.deepEqual(intersectAreas(a, b), { minX: 0.25, minY: 0.5, maxX: 0.5, maxY: 1 });
    assert.equal(areaSize(intersectAreas(a, { minX: 0.75, minY: 0, maxX: 1, maxY: 1 })), 0);
  });
});

describe("turnBox", () => {
  const size = { width: 100, height: 200 };
  const box = { x: 10, y: 20, width: 30, height: 40 };

  it("moves a box with the view's clockwise turn", () => {
    assert.deepEqual(turnBox(box, size, 0), box);
    assert.deepEqual(turnBox(box, size, 90), { x: 140, y: 10, width: 40, height: 30 });
    assert.deepEqual(turnBox(box, size, 180), { x: 60, y: 140, width: 30, height: 40 });
    assert.deepEqual(turnBox(box, size, 270), { x: 20, y: 60, width: 40, height: 30 });
  });

  it("turns back to where it started", () => {
    const turned = turnBox(box, size, 90);
    assert.deepEqual(turnBox(turned, turnedSize(size, 90), 270), box);
  });
});
