import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLayout } from "../src/view/layout.ts";
import {
  destinationTarget,
  pageTarget,
  positionAt,
  positionTarget,
  rectTarget,
} from "../src/view/navigation.ts";

// A US Letter page and an A4 page in landscape, 10 CSS pixels apart.
const sizes = [
  { width: 612, height: 792 },
  { width: 842, height: 595 },
];
const column = computeLayout(sizes, 1, { gap: 10 });
const spread = computeLayout(sizes, 1, { gap: 10, spread: "odd" });
const row = computeLayout(sizes, 1, { gap: 10, scrollMode: "horizontal" });

/** A 1000 by 800 scroller at a scroll position. */
const at = (scrollLeft = 0, scrollTop = 0) => ({
  scrollLeft,
  scrollTop,
  clientWidth: 1000,
  clientHeight: 800,
});

describe("pageTarget", () => {
  it("shows a page from its top and keeps the scroll sideways while it is in view", () => {
    assert.deepEqual(pageTarget(column, 0, at()), { top: 0, left: null });
    assert.deepEqual(pageTarget(column, 1, at()), { top: 802, left: null });
  });

  it("shows the top of the row of a page shorter than its row", () => {
    assert.equal(spread.tops[1], 109);
    assert.equal(pageTarget(spread, 1, at()).top, 0);
  });

  it("scrolls sideways to a page of a spread wider than the viewport", () => {
    assert.deepEqual(pageTarget(spread, 1, at()), { top: 0, left: 622 });
    assert.deepEqual(pageTarget(spread, 1, at(622)), { top: 0, left: null });
  });

  it("shows the page at the viewport's left in horizontal mode", () => {
    assert.deepEqual(pageTarget(row, 1, at()), { top: 99, left: 622 });
  });
});

describe("destinationTarget", () => {
  const point = { pageIndex: 0, x: 100, y: 50 };

  it("puts the point at the viewport's top, scrolling sideways only when it is out of view", () => {
    assert.deepEqual(destinationTarget(column, point, at(), false), { top: 60, left: null });
    assert.deepEqual(destinationTarget(column, point, at(500), false), { top: 60, left: 294 });
  });

  it("scrolls sideways to an exact point or a rectangle even in view", () => {
    assert.deepEqual(destinationTarget(column, point, at(), true), { top: 60, left: 294 });
    const rect = { ...point, view: { fit: "rect" as const, width: 10, height: 10 } };
    assert.deepEqual(destinationTarget(column, rect, at(), false), { top: 60, left: 294 });
  });

  it("shows the page from its top without a top", () => {
    assert.deepEqual(destinationTarget(column, { ...point, y: null }, at(), false), {
      top: 0,
      left: null,
    });
  });

  it("takes a quarter-turned page's left coordinate as the vertical one", () => {
    const turned = computeLayout(sizes, 1, { gap: 10, rotation: 90 });
    const target = { pageIndex: 0, x: 100, y: null };
    assert.deepEqual(destinationTarget(turned, target, at(), false), { top: 110, left: null });
  });
});

describe("rectTarget", () => {
  const rect = { x: 20, y: 30, width: 5, height: 5 };

  it("puts the rectangle in the viewport's upper third", () => {
    assert.deepEqual(rectTarget(column, 1, rect, at()), { top: 812 + 30 - 800 / 3, left: null });
  });

  it("puts it in the left third in horizontal mode or when it is out of view sideways", () => {
    assert.equal(rectTarget(row, 1, rect, at()).left, 622 + 10 + 20 - 1000 / 3);
    assert.equal(rectTarget(column, 1, rect, at(500)).left, 79 + 20 - 1000 / 3);
  });
});

describe("positionAt and positionTarget", () => {
  const view = { currentPage: 1, zoomMode: "fit-width" as const };

  it("keeps the page at the viewport's corner as a share of it", () => {
    const position = positionAt(column, at(0, 900), view);
    assert.equal(position.pageIndex, 1);
    assert.equal(position.x, -79 / 842);
    assert.equal(position.y, 88 / 595);
    assert.deepEqual(
      { current: position.current, scale: position.scale, zoomMode: position.zoomMode },
      { current: 1, scale: 1, zoomMode: "fit-width" },
    );
  });

  it("shows a position again at the zoom it had and at another", () => {
    const position = positionAt(column, at(0, 900), view);
    assert.deepEqual(positionTarget(column, position, at()), { top: 900, left: 0 });
    const twice = computeLayout(sizes, 2, { gap: 10 });
    const target = positionTarget(twice, position, at());
    assert.equal(target.top, 1604 + 88 * 2);
    assert.ok(Math.abs((target.left ?? 0) - (10 - 79 * 2)) < 1e-9);
  });
});
