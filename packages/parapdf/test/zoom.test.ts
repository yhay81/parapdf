import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedDestination } from "../src/pdfjs/destinations.ts";
import {
  type Arrangement,
  destinationScale,
  fitScale,
  refits,
  requestedZoom,
} from "../src/view/zoom.ts";

// A US Letter page, an A4 page in landscape, and a second US Letter page.
const sizes = [
  { width: 612, height: 792 },
  { width: 842, height: 595 },
  { width: 612, height: 792 },
];
const column: Arrangement = { rotation: 0, spread: "none", scrollMode: "vertical" };
const viewport = { clientWidth: 1000, clientHeight: 800 };
const GAP = 12;

const fit = (
  index: number,
  mode: "fit-width" | "fit-page",
  view: Arrangement = column,
  scroller: { clientWidth: number; clientHeight: number } | null = viewport,
  limits: [number, number] = [0.25, 10],
) => fitScale(sizes, view, index, mode, scroller, GAP, ...limits);

const destination = (target: ResolvedDestination, view: Arrangement = column) =>
  destinationScale(sizes, view, target, viewport, GAP, 0.25, 10);

describe("fitScale", () => {
  it("fits a page's width between the gaps beside it", () => {
    assert.equal(fit(0, "fit-width"), (1000 - 2 * GAP) / 612);
  });

  it("fits all of a page that is taller than its width allows", () => {
    assert.equal(fit(0, "fit-page"), (800 - 2 * GAP) / 792);
    // A landscape page is limited by its width even when the whole page fits.
    assert.equal(fit(1, "fit-page"), (1000 - 2 * GAP) / 842);
  });

  it("fits a quarter-turned page by its turned size", () => {
    assert.equal(fit(0, "fit-width", { ...column, rotation: 90 }), (1000 - 2 * GAP) / 792);
  });

  it("fits a spread's two pages, with the gap between them", () => {
    assert.equal(fit(0, "fit-width", { ...column, spread: "odd" }), (1000 - 3 * GAP) / (612 + 842));
  });

  it("counts a page alone in a spread mode's row twice", () => {
    assert.equal(fit(2, "fit-width", { ...column, spread: "odd" }), (1000 - 3 * GAP) / (2 * 612));
    assert.equal(fit(0, "fit-width", { ...column, spread: "even" }), (1000 - 3 * GAP) / (2 * 612));
  });

  it("fits pages one by one where they share one row", () => {
    const row: Arrangement = { rotation: 0, spread: "odd", scrollMode: "horizontal" };
    assert.equal(fit(0, "fit-width", row), (1000 - 2 * GAP) / 612);
  });

  it("keeps the fit within the scale limits", () => {
    assert.equal(fit(0, "fit-width", column, viewport, [0.25, 1]), 1);
    assert.equal(fit(0, "fit-width", column, viewport, [2, 10]), 2);
  });

  it("is null while a page of the row has no size", () => {
    assert.equal(fit(3, "fit-width"), null);
    assert.equal(
      fitScale([{ width: 0, height: 0 }], column, 0, "fit-width", viewport, GAP, 0.25, 10),
      null,
    );
  });

  it("reads the viewport only once the pages' sizes are known", () => {
    let reads = 0;
    const counted = {
      get clientWidth() {
        reads++;
        return 1000;
      },
      get clientHeight() {
        reads++;
        return 800;
      },
    };
    fitScale([], column, 0, "fit-page", counted, GAP, 0.25, 10);
    assert.equal(reads, 0);
    fitScale(sizes, column, 0, "fit-page", counted, GAP, 0.25, 10);
    assert.equal(reads, 2);
  });
});

describe("destinationScale", () => {
  it("shows a zoom of 1 at the page's printed size", () => {
    assert.deepEqual(destination({ pageIndex: 0, x: 0, y: 0, view: { fit: "zoom", zoom: 1 } }), {
      scale: 96 / 72,
      mode: "custom",
    });
  });

  it("keeps the zoom without a view or a zoom factor", () => {
    assert.equal(destination({ pageIndex: 0, x: 0, y: 0 }), null);
    assert.equal(
      destination({ pageIndex: 0, x: 0, y: 0, view: { fit: "zoom", zoom: null } }),
      null,
    );
  });

  it("fits the page or its width in the mode that keeps fitting it", () => {
    assert.deepEqual(destination({ pageIndex: 0, x: null, y: null, view: { fit: "page" } }), {
      scale: (800 - 2 * GAP) / 792,
      mode: "fit-page",
    });
    assert.deepEqual(destination({ pageIndex: 1, x: null, y: 0, view: { fit: "width" } }), {
      scale: (1000 - 2 * GAP) / 842,
      mode: "fit-width",
    });
  });

  it("fits the page's height, its width once turned a quarter", () => {
    const target: ResolvedDestination = { pageIndex: 1, x: 0, y: null, view: { fit: "height" } };
    assert.equal(destination(target)?.scale, (800 - 2 * GAP) / 595);
    assert.equal(destination(target, { ...column, rotation: 270 })?.scale, (800 - 2 * GAP) / 842);
  });

  it("fills the viewport with a rectangle", () => {
    const target: ResolvedDestination = {
      pageIndex: 0,
      x: 10,
      y: 10,
      view: { fit: "rect", width: 200, height: 100 },
    };
    assert.equal(destination(target)?.scale, Math.min(1000 / 200, 800 / 100));
    assert.equal(
      destination(target, { ...column, rotation: 90 })?.scale,
      Math.min(1000 / 100, 800 / 200),
    );
  });

  it("keeps the zoom for an empty rectangle and limits the others", () => {
    const empty: ResolvedDestination = {
      pageIndex: 0,
      x: 0,
      y: 0,
      view: { fit: "rect", width: 0, height: 0 },
    };
    assert.equal(destination(empty), null);
    assert.equal(
      destination({ pageIndex: 0, x: 0, y: 0, view: { fit: "zoom", zoom: 100 } })?.scale,
      10,
    );
  });

  it("keeps the zoom without a viewport or the page's size", () => {
    const target: ResolvedDestination = { pageIndex: 0, x: 0, y: 0, view: { fit: "page" } };
    assert.equal(destinationScale(sizes, column, target, null, GAP, 0.25, 10), null);
    assert.equal(destination({ ...target, pageIndex: 5 }), null);
  });
});

describe("requestedZoom", () => {
  const before = { zoomMode: "fit-width" as const, scale: 1.5 };

  it("takes a fitted mode, whose scale the viewer fits next", () => {
    assert.deepEqual(requestedZoom("fit-page", before, 0.25, 10), {
      scale: 1.5,
      mode: "fit-page",
    });
  });

  it("takes a scale as a custom zoom within the limits", () => {
    assert.deepEqual(requestedZoom(2, before, 0.25, 10), { scale: 2, mode: "custom" });
    assert.deepEqual(requestedZoom(20, before, 0.25, 10), { scale: 10, mode: "custom" });
    assert.deepEqual(requestedZoom(0.1, before, 0.25, 10), { scale: 0.25, mode: "custom" });
  });

  it("keeps the zoom when the scale is left out or not a positive number", () => {
    for (const requested of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(requestedZoom(requested, before, 0.25, 10), {
        scale: 1.5,
        mode: "fit-width",
      });
    }
  });
});

describe("refits", () => {
  it("fits the width again when the width changes", () => {
    assert.equal(refits("fit-width", { clientWidth: 900, clientHeight: 800 }, 1000, 800), true);
    assert.equal(refits("fit-width", { clientWidth: 1000, clientHeight: 600 }, 1000, 800), false);
  });

  it("fits the whole page again when either side changes", () => {
    assert.equal(refits("fit-page", { clientWidth: 1000, clientHeight: 600 }, 1000, 800), true);
    assert.equal(refits("fit-page", { clientWidth: 1000, clientHeight: 800 }, 1000, 800), false);
  });

  it("never fits a custom zoom again", () => {
    assert.equal(refits("custom", { clientWidth: 1, clientHeight: 1 }, 1000, 800), false);
  });
});
