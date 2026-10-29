import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLayout, type LayoutOptions } from "../src/view/layout.ts";
import {
  destinationTarget,
  flipTarget,
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

describe("flipTarget", () => {
  const letters = Array.from({ length: 5 }, () => ({ width: 612, height: 792 }));
  const arranged = (options: Partial<LayoutOptions>) =>
    computeLayout(letters, 1, { gap: 10, ...options });

  it("goes to the page after or before the current page's row", () => {
    const odd = arranged({ spread: "odd" });
    assert.equal(flipTarget(odd, "odd", 2, 1), 4);
    assert.equal(flipTarget(odd, "odd", 3, -1), 1);
    assert.equal(flipTarget(arranged({ spread: "even" }), "even", 1, 1), 3);
    // Two pages fit a row of 1500 CSS pixels, three do not.
    const wrapped = arranged({ scrollMode: "wrapped", viewportWidth: 1500 });
    assert.equal(flipTarget(wrapped, "none", 0, 1), 2);
  });

  it("goes by the spread in horizontal mode, where all pages share one row", () => {
    const horizontal = arranged({ scrollMode: "horizontal", spread: "odd" });
    assert.equal(flipTarget(horizontal, "odd", 0, 1), 2);
    assert.equal(flipTarget(horizontal, "none", 0, 1), 1);
  });

  it("goes by the first page alone and the pairs after it in horizontal mode", () => {
    const horizontal = arranged({ scrollMode: "horizontal", spread: "even" });
    assert.equal(flipTarget(horizontal, "even", 0, 1), 1);
    assert.equal(flipTarget(horizontal, "even", 1, 1), 3);
    assert.equal(flipTarget(horizontal, "even", 3, -1), 2);
    assert.equal(flipTarget(horizontal, "even", 4, 1), null);
  });

  it("flips from a last page without a partner, and whole spreads in page mode", () => {
    const odd = arranged({ spread: "odd" });
    assert.equal(flipTarget(odd, "odd", 4, 1), null);
    assert.equal(flipTarget(odd, "odd", 4, -1), 3);
    const paged = arranged({ scrollMode: "page", spread: "odd", page: 3 });
    assert.equal(flipTarget(paged, "odd", 0, 1), 4);
    assert.equal(flipTarget(paged, "odd", 0, -1), 1);
  });

  it("flips from the row page mode shows, which the current page follows later", () => {
    const paged = arranged({ scrollMode: "page", page: 2 });
    assert.equal(flipTarget(paged, "none", 0, 1), 3);
    assert.equal(flipTarget(paged, "none", 0, -1), 1);
  });

  it("goes nowhere past the first or last page", () => {
    const vertical = arranged({});
    assert.equal(flipTarget(vertical, "none", 0, -1), null);
    assert.equal(flipTarget(vertical, "none", 4, 1), null);
  });
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

  it("shows the page at the viewport's right in horizontal mode read from the right", () => {
    const rtl = computeLayout(sizes, 1, { gap: 10, scrollMode: "horizontal", direction: "rtl" });
    // Page 1 is at the right end of the row of 1,484 CSS pixels.
    assert.deepEqual(pageTarget(rtl, 0, at()), { top: 0, left: 1484 - 1000 });
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

  it("turns the point with a half turn and three quarters", () => {
    const half = computeLayout(sizes, 1, { gap: 10, rotation: 180 });
    assert.deepEqual(destinationTarget(half, point, at(), false), {
      top: 10 + 792 - 50,
      left: null,
    });
    const threeQuarters = computeLayout(sizes, 1, { gap: 10, rotation: 270 });
    assert.deepEqual(destinationTarget(threeQuarters, point, at(), false), {
      top: 10 + 612 - 100,
      left: null,
    });
  });

  it("takes a quarter-turned page's top coordinate as the left one", () => {
    const turned = computeLayout(sizes, 1, { gap: 10, rotation: 90 });
    const target = { pageIndex: 0, x: null, y: 50 };
    // The page, 792 CSS pixels wide once turned, starts at 104.
    assert.deepEqual(destinationTarget(turned, target, at(), true), {
      top: 0,
      left: 104 + 792 - 50,
    });
  });

  it("shows a half-turned rectangle from the corner that turned to its top left", () => {
    const half = computeLayout(sizes, 1, { gap: 10, rotation: 180 });
    const rect = { ...point, view: { fit: "rect" as const, width: 200, height: 100 } };
    assert.deepEqual(destinationTarget(half, rect, at(), false), {
      top: 10 + 792 - 50 - 100,
      left: 194 + 612 - 100 - 200,
    });
  });

  it("goes to the page's left edge in horizontal mode without a point", () => {
    const target = { pageIndex: 1, x: null, y: null };
    assert.deepEqual(destinationTarget(row, target, at(), false), { top: 99, left: 622 });
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

  it("turns the rectangle with the view", () => {
    const turned = computeLayout(sizes, 1, { gap: 10, rotation: 90 });
    // Its left coordinate is now its top one, and it stays in view sideways.
    assert.deepEqual(rectTarget(turned, 0, rect, at()), { top: 10 + 20 - 800 / 3, left: null });
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

  it("shows a position again in a row read from the right", () => {
    const rtl = computeLayout(sizes, 1, { gap: 10, scrollMode: "horizontal", direction: "rtl" });
    const position = positionAt(rtl, at(300, 0), view);
    // Page 2 is at the row's left end, from 10 to 852.
    assert.equal(position.pageIndex, 1);
    const target = positionTarget(rtl, position, at());
    assert.ok(Math.abs(target.top) < 1e-9);
    assert.ok(Math.abs((target.left ?? 0) - 300) < 1e-9);
  });
});
