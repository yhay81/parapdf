import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaSize,
  computeLayout,
  intersectAreas,
  pageAtPoint,
  pageLeft,
  pageTop,
  rowBounds,
  rowEnd,
  rowStart,
  sameRows,
  showPage,
  toRotation,
  turnBox,
  turnedSize,
  type Viewport,
  visibleArea,
  visibleRange,
  zoomTarget,
} from "../src/view/layout.ts";

// A US Letter page and an A4 page in landscape, 10 CSS pixels apart.
const sizes = [
  { width: 612, height: 792 },
  { width: 842, height: 595 },
];

/** The scroller's whole view at a scroll position, as the runtime measures it. */
const view = (left: number, top: number, width: number, height: number): Viewport => ({
  left,
  top,
  width,
  height,
  scrollerWidth: width,
  scrollerHeight: height,
});

describe("computeLayout", () => {
  it("stacks pages with the gap between and around them", () => {
    const layout = computeLayout(sizes, 1, { gap: 10 });
    assert.deepEqual([...layout.tops], [10, 812]);
    assert.deepEqual([...layout.widths], [612, 842]);
    assert.deepEqual([...layout.heights], [792, 595]);
    assert.equal(layout.totalHeight, 1417);
    assert.equal(layout.totalWidth, 862);
  });

  it("rounds page boxes to whole CSS pixels", () => {
    const layout = computeLayout(sizes, 1 / 3, { gap: 10 });
    assert.deepEqual([...layout.widths], [204, 281]);
    assert.deepEqual([...layout.heights], [264, 198]);
  });

  it("swaps the page boxes of a quarter turn", () => {
    const layout = computeLayout(sizes, 1, { gap: 10, rotation: 90 });
    assert.deepEqual([...layout.widths], [792, 595]);
    assert.deepEqual([...layout.heights], [612, 842]);
    // The sizes stay unturned.
    assert.deepEqual(layout.sizes, sizes);
  });

  it("keeps the page boxes of a half turn and swaps those of three quarters", () => {
    const half = computeLayout(sizes, 1, { gap: 10, rotation: 180 });
    assert.deepEqual([...half.widths], [612, 842]);
    assert.deepEqual([...half.heights], [792, 595]);
    const threeQuarters = computeLayout(sizes, 1, { gap: 10, rotation: 270 });
    assert.deepEqual([...threeQuarters.widths], [792, 595]);
    assert.deepEqual([...threeQuarters.heights], [612, 842]);
  });
});

describe("pageAtPoint and visibleRange", () => {
  const layout = computeLayout(sizes, 1, { gap: 10 });

  it("finds the last page whose top is at or above a point", () => {
    assert.equal(pageAtPoint(layout, 0, 0, 1000), 0);
    assert.equal(pageAtPoint(layout, 0, 811, 1000), 0);
    assert.equal(pageAtPoint(layout, 0, 812, 1000), 1);
    assert.equal(pageAtPoint(layout, 0, 1e9, 1000), 1);
  });

  it("starts a band that begins in a gap with the next page", () => {
    assert.deepEqual(visibleRange(layout, view(0, 805, 1000, 100)), { first: 1, last: 1 });
    assert.deepEqual(visibleRange(layout, view(0, 0, 1000, 900)), { first: 0, last: 1 });
  });

  it("is empty for a document without pages", () => {
    const empty = computeLayout([], 1, { gap: 10 });
    assert.deepEqual(visibleRange(empty, view(0, 0, 1000, 900)), { first: 0, last: -1 });
  });

  it("keeps a viewport scrolled past either end on the page at that end", () => {
    assert.deepEqual(visibleRange(layout, view(0, 5000, 1000, 100)), { first: 1, last: 1 });
    assert.deepEqual(visibleRange(layout, view(0, -100, 1000, 50)), { first: 0, last: 0 });
  });
});

describe("pageLeft and visibleArea", () => {
  const layout = computeLayout(sizes, 1, { gap: 10 });

  it("centers each page in the viewport, at the gap when it is wider", () => {
    assert.equal(pageLeft(layout, 0, 1000), 194);
    assert.equal(pageLeft(layout, 1, 1000), 79);
    assert.equal(pageLeft(layout, 1, 700), 10);
  });

  it("gives the part of a page in the viewport as fractions of the page", () => {
    const viewport = view(0, 10, 1000, 396);
    assert.deepEqual(visibleArea(layout, 0, viewport), { minX: 0, minY: 0, maxX: 1, maxY: 0.5 });
    assert.equal(visibleArea(layout, 1, viewport), null);
  });

  it("keeps pages centered in the scroller while a zoom preview shows less of the content", () => {
    const viewport = { ...view(347, 208, 306, 396), scrollerWidth: 1000, scrollerHeight: 792 };
    assert.deepEqual(visibleArea(layout, 0, viewport), {
      minX: 0.25,
      minY: 0.25,
      maxX: 0.75,
      maxY: 0.75,
    });
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

  it("turns back from a half turn and from three quarters", () => {
    assert.deepEqual(turnBox(turnBox(box, size, 180), size, 180), box);
    const turned = turnBox(box, size, 270);
    assert.deepEqual(turnBox(turned, turnedSize(size, 270), 90), box);
  });
});

describe("toRotation", () => {
  it("rounds to the nearest quarter turn, from 0 to 270", () => {
    assert.equal(toRotation(0), 0);
    assert.equal(toRotation(80), 90);
    assert.equal(toRotation(450), 90);
    assert.equal(toRotation(-90), 270);
    assert.equal(toRotation(-360), 0);
  });
});

describe("zoomTarget", () => {
  const scroller = { width: 1000, height: 800 };
  const center = { x: 500, y: 400 };

  it("keeps the point under the anchor at the same share of its page", () => {
    const layout = computeLayout(sizes, 1, { gap: 10 });
    // The middle of page 1's width, 390 of its 792 points down.
    const target = zoomTarget(layout, computeLayout(sizes, 2, { gap: 10 }), scroller, center, {
      x: 500,
      y: 400,
    });
    // At twice the size, the page is wider than the viewport and starts at the gap.
    assert.deepEqual(target, { left: 10 + 612 - 500, top: 10 + 780 - 400 });
  });

  it("finds the page again where the rows wrap otherwise", () => {
    const letters = Array.from({ length: 6 }, () => ({ width: 612, height: 792 }));
    const wrapped = (scale: number) =>
      computeLayout(letters, scale, { gap: 10, scrollMode: "wrapped", viewportWidth: 1000 });
    // The middle of page 5, the second of the second row of three.
    const point = { x: pageLeft(wrapped(0.5), 4, 1000) + 153, y: 416 + 198 };
    // At full size, one page fits a row: page 5 is the fifth row.
    assert.deepEqual(zoomTarget(wrapped(0.5), wrapped(1), scroller, center, point), {
      left: 194 + 306 - 500,
      top: 10 + 4 * 802 + 396 - 400,
    });
  });
});

describe("spreads", () => {
  // Five US Letter pages and one A4 landscape page last, 10 CSS pixels apart.
  const letter = { width: 612, height: 792 };
  const pages = [letter, letter, letter, letter, letter, { width: 842, height: 595 }];

  it("pairs pages in rows: odd from page 1, even after page 1 alone", () => {
    assert.deepEqual(rowBounds("none", 3, 6), { first: 3, last: 3 });
    assert.deepEqual(rowBounds("odd", 0, 6), { first: 0, last: 1 });
    assert.deepEqual(rowBounds("odd", 3, 6), { first: 2, last: 3 });
    assert.deepEqual(rowBounds("even", 0, 6), { first: 0, last: 0 });
    assert.deepEqual(rowBounds("even", 2, 6), { first: 1, last: 2 });
    // A last page without a partner stays alone.
    assert.deepEqual(rowBounds("even", 5, 6), { first: 5, last: 5 });
  });

  it("leaves the last page of an odd count alone, and a single page alone", () => {
    assert.deepEqual(rowBounds("odd", 4, 5), { first: 4, last: 4 });
    assert.deepEqual(rowBounds("odd", 0, 1), { first: 0, last: 0 });
    assert.deepEqual(rowBounds("even", 1, 2), { first: 1, last: 1 });
  });

  it("lays pairs side by side and centers each page in its row's height", () => {
    const layout = computeLayout(pages, 1, { gap: 10, spread: "odd" });
    assert.deepEqual([...layout.rowTops], [10, 10, 812, 812, 1614, 1614]);
    assert.deepEqual([...layout.offsets], [0, 622, 0, 622, 0, 622]);
    assert.deepEqual([...layout.rowWidths], [1234, 1234, 1234, 1234, 1464, 1464]);
    // The landscape page is shorter than its partner: it sits in the middle.
    assert.equal(layout.tops[5], 1614 + Math.round((792 - 595) / 2));
    assert.equal(layout.totalHeight, 2416);
    assert.equal(layout.totalWidth, 1484);
  });

  it("centers rows and places the second page after the first and the gap", () => {
    const layout = computeLayout(pages, 1, { gap: 10, spread: "even" });
    assert.equal(pageLeft(layout, 0, 2000), (2000 - 612) / 2);
    assert.equal(pageLeft(layout, 1, 2000), (2000 - 1234) / 2);
    assert.equal(pageLeft(layout, 2, 2000), (2000 - 1234) / 2 + 622);
    // A row wider than the viewport starts at the gap.
    assert.equal(pageLeft(layout, 2, 1000), 10 + 622);
  });

  it("finds rows by their first page, and the page under a point", () => {
    const layout = computeLayout(pages, 1, { gap: 10, spread: "odd" });
    assert.equal(pageAtPoint(layout, 0, 900, 1254), 2);
    assert.equal(pageAtPoint(layout, 1000, 900, 1254), 3);
    assert.deepEqual([rowStart(layout, 3), rowEnd(layout, 3)], [2, 3]);
    assert.deepEqual(visibleRange(layout, view(0, 0, 1254, 900)), { first: 0, last: 3 });
    // A band that starts in the gap below a row begins with the next row.
    assert.deepEqual(visibleRange(layout, view(0, 805, 1254, 100)), { first: 2, last: 3 });
  });

  it("is the single-page layout without spreads", () => {
    const layout = computeLayout(pages, 1, { gap: 10 });
    assert.deepEqual([...layout.rowTops], [...layout.tops]);
    assert.deepEqual([...layout.offsets], [0, 0, 0, 0, 0, 0]);
    assert.deepEqual([...layout.rowWidths], [...layout.widths]);
  });
});

describe("horizontal scrolling", () => {
  const layout = computeLayout(sizes, 1, { gap: 10, scrollMode: "horizontal" });

  it("puts every page in one row, each centered in the row's height", () => {
    assert.deepEqual([...layout.offsets], [0, 622]);
    assert.deepEqual([...layout.rowTops], [10, 10]);
    assert.deepEqual([...layout.rowHeights], [792, 792]);
    assert.deepEqual([...layout.tops], [10, 10 + Math.round((792 - 595) / 2)]);
    assert.deepEqual([rowStart(layout, 1), rowEnd(layout, 0)], [0, 1]);
    assert.equal(layout.totalWidth, 1484);
    assert.equal(layout.totalHeight, 812);
  });

  it("centers the row in the viewport's height, at the gap when taller", () => {
    assert.equal(pageTop(layout, 0, 1000), (1000 - 792) / 2);
    assert.equal(pageTop(layout, 1, 1000), (1000 - 792) / 2 + 99);
    assert.equal(pageTop(layout, 1, 500), 109);
    // Wider than the viewport, the row starts at the gap.
    assert.deepEqual([pageLeft(layout, 0, 1000), pageLeft(layout, 1, 1000)], [10, 632]);
  });

  it("finds pages along the row, wherever the point is in height", () => {
    // The boundary is the middle of the gap between the pages.
    assert.equal(pageAtPoint(layout, 626, 5000, 1000), 0);
    assert.equal(pageAtPoint(layout, 627, -50, 1000), 1);
    assert.deepEqual(visibleRange(layout, view(0, 0, 600, 900)), { first: 0, last: 0 });
    // A viewport that starts in the gap after a page begins with the next.
    assert.deepEqual(visibleRange(layout, view(625, 0, 600, 900)), { first: 1, last: 1 });
    assert.deepEqual(visibleRange(layout, view(0, 0, 1000, 900)), { first: 0, last: 1 });
  });

  it("keeps a viewport scrolled past the end of the row on the last page", () => {
    assert.deepEqual(visibleRange(layout, view(5000, 0, 600, 900)), { first: 1, last: 1 });
  });

  it("gives the visible part of a page in the centered row", () => {
    const viewport = view(0, 0, 1000, 1000);
    assert.deepEqual(visibleArea(layout, 0, viewport), { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    // Page 2 starts at 632 of the 1,000 pixels wide viewport.
    assert.equal(visibleArea(layout, 1, viewport)?.maxX, 368 / 842);
  });
});

describe("right-to-left page order", () => {
  const letter = { width: 612, height: 792 };
  const a4 = { width: 842, height: 595 };

  it("puts the earlier page of a spread on the right", () => {
    const layout = computeLayout([letter, letter, letter, a4], 1, {
      gap: 10,
      spread: "odd",
      direction: "rtl",
    });
    assert.equal(layout.direction, "rtl");
    assert.deepEqual([...layout.offsets], [622, 0, 852, 0]);
    assert.deepEqual([...layout.rowWidths], [1234, 1234, 1464, 1464]);
    assert.equal(pageAtPoint(layout, 0, 900, 1254), 3);
    assert.equal(pageAtPoint(layout, 1000, 900, 1254), 2);
    // Pages alone in their row sit where they would from the left.
    const single = computeLayout([letter, a4], 1, { gap: 10, direction: "rtl" });
    assert.deepEqual([...single.offsets], [0, 0]);
  });

  it("runs the horizontal row from right to left", () => {
    const layout = computeLayout(sizes, 1, {
      gap: 10,
      scrollMode: "horizontal",
      direction: "rtl",
    });
    assert.deepEqual([...layout.offsets], [852, 0]);
    assert.deepEqual([pageLeft(layout, 0, 1000), pageLeft(layout, 1, 1000)], [862, 10]);
    // The boundary is the middle of the gap between the pages.
    assert.equal(pageAtPoint(layout, 856, 0, 1000), 1);
    assert.equal(pageAtPoint(layout, 857, 0, 1000), 0);
    assert.deepEqual(visibleRange(layout, view(0, 0, 600, 900)), { first: 1, last: 1 });
    // A viewport that starts in the gap right of a page begins with the page beyond it.
    assert.deepEqual(visibleRange(layout, view(855, 0, 600, 900)), { first: 0, last: 0 });
    assert.deepEqual(visibleRange(layout, view(0, 0, 1484, 900)), { first: 0, last: 1 });
  });

  it("keeps a viewport beyond either end of a row read from the right on the page there", () => {
    const layout = computeLayout(sizes, 1, {
      gap: 10,
      scrollMode: "horizontal",
      direction: "rtl",
    });
    // Page 1 is at the right end, the last page at the left.
    assert.deepEqual(visibleRange(layout, view(5000, 0, 600, 900)), { first: 0, last: 0 });
    assert.deepEqual(visibleRange(layout, view(-500, 0, 400, 900)), { first: 1, last: 1 });
  });

  it("fills wrapped rows from the right", () => {
    const pages = Array.from({ length: 3 }, () => letter);
    const layout = computeLayout(pages, 0.5, {
      gap: 10,
      scrollMode: "wrapped",
      direction: "rtl",
      viewportWidth: 700,
    });
    // Two pages of 306 CSS pixels fit 700 with the gaps; the third wraps.
    assert.deepEqual([...layout.offsets], [316, 0, 0]);
    assert.deepEqual([...layout.rowFirst], [0, 0, 2]);
  });
});

describe("wrapped scrolling", () => {
  // Six US Letter pages at half size: 306 by 396 CSS pixels.
  const letter = { width: 612, height: 792 };
  const pages = Array.from({ length: 6 }, () => letter);
  const wrapped = (viewportWidth: number, spread: "none" | "even" = "none") =>
    computeLayout(pages, 0.5, { gap: 10, scrollMode: "wrapped", viewportWidth, spread });

  it("fills rows with as many pages as fit the viewport's width with the gaps", () => {
    const layout = wrapped(1000);
    assert.deepEqual([...layout.rowFirst], [0, 0, 0, 3, 3, 3]);
    assert.deepEqual([...layout.rowTops], [10, 10, 10, 416, 416, 416]);
    assert.deepEqual([...layout.offsets], [0, 316, 632, 0, 316, 632]);
    assert.equal(layout.totalHeight, 822);
    assert.equal(pageLeft(layout, 1, 1000), (1000 - 938) / 2 + 316);
    assert.deepEqual(visibleRange(layout, view(0, 420, 1000, 100)), { first: 3, last: 5 });
    assert.equal(pageAtPoint(layout, 500, 600, 1000), 4);
  });

  it("keeps at least one page in a row, and spreads whole", () => {
    assert.deepEqual([...wrapped(200).rowFirst], [0, 1, 2, 3, 4, 5]);
    // Page 1 alone, then pairs 2–3 and 4–5, then page 6: a pair never breaks.
    assert.deepEqual([...wrapped(1000, "even").rowFirst], [0, 0, 0, 3, 3, 3]);
    assert.deepEqual([...wrapped(900, "even").rowFirst], [0, 1, 1, 3, 3, 5]);
  });

  it("keeps a page in a row that it and the gaps fill exactly", () => {
    // Two pages of 306 CSS pixels, the gap between them, and one on each side.
    assert.deepEqual([...wrapped(642).rowFirst], [0, 0, 2, 2, 4, 4]);
    assert.deepEqual([...wrapped(641).rowFirst], [0, 1, 2, 3, 4, 5]);
  });

  it("tells whether another width wraps pages into other rows", () => {
    assert.equal(sameRows(wrapped(1000), wrapped(1100)), true);
    assert.equal(sameRows(wrapped(1000), wrapped(900)), false);
  });
});

describe("page scrolling", () => {
  const pages = [...sizes, { width: 612, height: 792 }];
  const layout = computeLayout(pages, 1, { gap: 10, scrollMode: "page", page: 1 });

  it("shows one row, and every row in the same place", () => {
    assert.deepEqual(layout.shown, { first: 1, last: 1 });
    assert.deepEqual([...layout.rowTops], [10, 10, 10]);
    // The content holds the row shown.
    assert.equal(layout.totalWidth, 862);
    assert.equal(layout.totalHeight, 615);
    assert.equal(pageTop(layout, 1, 1000), 10 + (1000 - 595) / 2 - 10);
  });

  it("finds only the row shown", () => {
    const viewport = view(0, 0, 1000, 1000);
    assert.deepEqual(visibleRange(layout, viewport), { first: 1, last: 1 });
    assert.equal(visibleArea(layout, 0, viewport), null);
    assert.equal(visibleArea(layout, 2, viewport), null);
    assert.notEqual(visibleArea(layout, 1, viewport), null);
    assert.equal(pageAtPoint(layout, 0, 0, 1000), 1);
  });

  it("shows another row with the same arrays", () => {
    assert.equal(showPage(layout, 1), layout);
    const next = showPage(layout, 2);
    assert.deepEqual(next.shown, { first: 2, last: 2 });
    assert.equal(next.tops, layout.tops);
    assert.deepEqual([next.totalWidth, next.totalHeight], [632, 812]);
    const vertical = computeLayout(pages, 1, { gap: 10 });
    assert.equal(showPage(vertical, 2), vertical);
  });

  it("shows spreads whole", () => {
    const spreads = computeLayout([...pages, ...pages], 1, {
      gap: 10,
      scrollMode: "page",
      spread: "odd",
      page: 3,
    });
    assert.deepEqual(spreads.shown, { first: 2, last: 3 });
    // Pages 3 and 4 are both US Letter.
    assert.equal(spreads.totalWidth, 612 + 10 + 612 + 20);
  });

  it("shows the first or last row for a page out of range", () => {
    const past = computeLayout(pages, 1, { gap: 10, scrollMode: "page", page: 99 });
    assert.deepEqual(past.shown, { first: 2, last: 2 });
    assert.deepEqual([past.totalWidth, past.totalHeight], [632, 812]);
    const before = computeLayout(pages, 1, { gap: 10, scrollMode: "page", page: -3 });
    assert.deepEqual(before.shown, { first: 0, last: 0 });
    assert.deepEqual(showPage(before, 99).shown, { first: 2, last: 2 });
  });

  it("starts a row taller or wider than the viewport at the gap", () => {
    const zoomed = computeLayout(pages, 2, { gap: 10, scrollMode: "page" });
    assert.deepEqual([pageTop(zoomed, 0, 800), pageLeft(zoomed, 0, 1000)], [10, 10]);
  });

  it("shows nothing without pages", () => {
    const empty = computeLayout([], 1, { gap: 10, scrollMode: "page" });
    assert.equal(empty.shown, null);
    assert.deepEqual(visibleRange(empty, view(0, 0, 1000, 1000)), { first: 0, last: -1 });
    assert.equal(pageAtPoint(empty, 0, 0, 1000), 0);
  });
});
