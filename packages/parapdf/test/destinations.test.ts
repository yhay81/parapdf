import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { resolveDestination, resolveExplicit } from "../src/pdfjs/destinations.ts";

/** pdf.js's PageViewport transform of each rotation: [a, b, c, d]. */
const TURNS: Record<number, [number, number, number, number]> = {
  0: [1, 0, 0, -1],
  90: [0, 1, 1, 0],
  180: [-1, 0, 0, 1],
  270: [0, -1, -1, 0],
};

/**
 * A page of `width` by `height` PDF points turned by its own /Rotate, whose
 * viewport at scale 1 converts points as pdf.js's PageViewport does.
 */
function page(width: number, height: number, rotate = 0): Pdfjs.PDFPageProxy {
  return {
    rotate,
    getViewport: ({ scale = 1 }: { scale?: number }) => {
      const [a, b, c, d] = TURNS[rotate] as [number, number, number, number];
      const [centerX, centerY] = [width / 2, height / 2];
      const [offsetX, offsetY] = a === 0 ? [centerY, centerX] : [centerX, centerY];
      const e = offsetX * scale - a * scale * centerX - c * scale * centerY;
      const f = offsetY * scale - b * scale * centerX - d * scale * centerY;
      return {
        rotation: rotate,
        convertToViewportPoint: (x: number, y: number) => [
          a * scale * x + c * scale * y + e,
          b * scale * x + d * scale * y + f,
        ],
      };
    },
  } as unknown as Pdfjs.PDFPageProxy;
}

const name = (value: string) => ({ name: value });

/**
 * A document of `pages`, whose page references are `{ num }` with `num` the
 * page's index, and whose named destinations are `named`; `loaded` lists the
 * pages loaded, in order.
 */
function documentOf(pages: Pdfjs.PDFPageProxy[], named: Record<string, unknown[]> = {}) {
  const loaded: number[] = [];
  const doc = {
    async getPageIndex(ref: { num: number }) {
      if (!pages[ref.num]) throw new Error("Invalid pageIndex request.");
      return ref.num;
    },
    getDestination: async (id: string) => named[id] ?? null,
  } as unknown as Pdfjs.PDFDocumentProxy;
  const getPage = (index: number) => {
    loaded.push(index);
    const found = pages[index];
    return found ? Promise.resolve(found) : Promise.reject(new Error("Invalid page request."));
  };
  return {
    doc,
    loaded,
    resolve: (dest: unknown) => resolveExplicit(doc, getPage, dest),
    resolveNamed: (dest: string | unknown[]) =>
      resolveDestination(doc, getPage, dest as Parameters<typeof resolveDestination>[2]),
  };
}

/** A US Letter page turned by `rotate`, alone in its document. */
const letter = (rotate = 0) => documentOf([page(612, 792, rotate)]);

describe("an explicit destination", () => {
  it("is null when it is not an array or names no page", async () => {
    const { resolve, loaded } = letter();
    for (const dest of [null, undefined, "Chapter", 3, { num: 0 }]) {
      assert.equal(await resolve(dest), null);
    }
    for (const target of [null, undefined, "0", 1.5, Number.NaN, true]) {
      assert.equal(await resolve([target, name("Fit")]), null, String(target));
    }
    assert.deepEqual(loaded, []);
  });

  it("names its page by index, from 0, or by reference", async () => {
    const { resolve } = documentOf([page(612, 792), page(595, 842)]);
    assert.deepEqual(await resolve([1, name("Fit")]), {
      pageIndex: 1,
      x: null,
      y: null,
      view: { fit: "page" },
    });
    assert.deepEqual(await resolve([{ num: 1, gen: 0 }, name("XYZ"), 0, 842, null]), {
      pageIndex: 1,
      x: 0,
      y: 0,
      view: { fit: "zoom", zoom: null },
    });
  });

  it("measures its point on the page it names, whatever the others' sizes", async () => {
    const { resolve, loaded } = documentOf([page(612, 792), page(842, 595, 90)]);
    assert.deepEqual(await resolve([1, name("XYZ"), 100, 500, 1]), {
      pageIndex: 1,
      x: 500,
      y: 100,
      view: { fit: "zoom", zoom: 1 },
    });
    assert.deepEqual(loaded, [1]);
  });

  it("goes to a point and zoom (XYZ), from the page's top-left corner as it turns", async () => {
    const expected: Record<number, [number, number]> = {
      0: [72, 72],
      90: [720, 72],
      180: [540, 720],
      270: [72, 540],
    };
    for (const [rotate, [x, y]] of Object.entries(expected)) {
      assert.deepEqual(
        await letter(Number(rotate)).resolve([0, name("XYZ"), 72, 720, 2]),
        { pageIndex: 0, x, y, view: { fit: "zoom", zoom: 2 } },
        `rotated ${rotate}`,
      );
    }
  });

  it("keeps what an XYZ destination leaves null or out, 0 as the zoom included", async () => {
    const { resolve, loaded } = letter();
    const keep = { pageIndex: 0, x: null, y: null, view: { fit: "zoom", zoom: null } };
    assert.deepEqual(await resolve([0, name("XYZ"), null, null, null]), keep);
    assert.deepEqual(await resolve([0, name("XYZ"), null, null, 0]), keep);
    assert.deepEqual(await resolve([0, name("XYZ")]), keep);
    assert.deepEqual(loaded, [], "no point, no page to measure it on");
    assert.deepEqual(await resolve([0, name("XYZ"), 72.5, null]), {
      pageIndex: 0,
      x: 72.5,
      y: null,
      view: { fit: "zoom", zoom: null },
    });
    assert.deepEqual(await resolve([0, name("XYZ"), null, 691.25, 0.5]), {
      pageIndex: 0,
      x: null,
      y: 100.75,
      view: { fit: "zoom", zoom: 0.5 },
    });
  });

  it("keeps a turned page's coordinate that the destination leaves null", async () => {
    // A quarter turn shows the page's y across and its x down.
    assert.deepEqual(await letter(90).resolve([0, name("XYZ"), null, 720, null]), {
      pageIndex: 0,
      x: 720,
      y: null,
      view: { fit: "zoom", zoom: null },
    });
    assert.deepEqual(await letter(270).resolve([0, name("XYZ"), 100, null, null]), {
      pageIndex: 0,
      x: null,
      y: 512,
      view: { fit: "zoom", zoom: null },
    });
    assert.deepEqual(await letter(180).resolve([0, name("XYZ"), 100, null, null]), {
      pageIndex: 0,
      x: 512,
      y: null,
      view: { fit: "zoom", zoom: null },
    });
  });

  it("fits the whole page (Fit, FitB) without measuring it", async () => {
    const { resolve, loaded } = letter(90);
    for (const fit of ["Fit", "FitB"]) {
      assert.deepEqual(await resolve([0, name(fit)]), {
        pageIndex: 0,
        x: null,
        y: null,
        view: { fit: "page" },
      });
    }
    assert.deepEqual(loaded, []);
  });

  it("fits the width at a top (FitH, FitBH), which a turned page shows across", async () => {
    const expected: Record<number, [number | null, number | null]> = {
      0: [null, 92],
      90: [700, null],
      180: [null, 700],
      270: [92, null],
    };
    for (const fit of ["FitH", "FitBH"]) {
      for (const [rotate, [x, y]] of Object.entries(expected)) {
        assert.deepEqual(
          await letter(Number(rotate)).resolve([0, name(fit), 700]),
          { pageIndex: 0, x, y, view: { fit: "width" } },
          `${fit} rotated ${rotate}`,
        );
      }
      const { resolve, loaded } = letter();
      const top = { pageIndex: 0, x: null, y: null, view: { fit: "width" } };
      assert.deepEqual(await resolve([0, name(fit), null]), top);
      assert.deepEqual(await resolve([0, name(fit)]), top);
      assert.deepEqual(loaded, []);
    }
  });

  it("fits the height at a left (FitV, FitBV), which a turned page shows down", async () => {
    const expected: Record<number, [number | null, number | null]> = {
      0: [100, null],
      90: [null, 100],
      180: [512, null],
      270: [null, 512],
    };
    for (const fit of ["FitV", "FitBV"]) {
      for (const [rotate, [x, y]] of Object.entries(expected)) {
        assert.deepEqual(
          await letter(Number(rotate)).resolve([0, name(fit), 100]),
          { pageIndex: 0, x, y, view: { fit: "height" } },
          `${fit} rotated ${rotate}`,
        );
      }
      assert.deepEqual(await letter().resolve([0, name(fit), null]), {
        pageIndex: 0,
        x: null,
        y: null,
        view: { fit: "height" },
      });
    }
  });

  it("fits a rectangle (FitR) given by any two opposite corners, as the page turns", async () => {
    // left 100, bottom 200, right 300, top 500.
    const expected: Record<number, [number, number, number, number]> = {
      0: [100, 292, 200, 300],
      90: [200, 100, 300, 200],
      180: [312, 200, 200, 300],
      270: [292, 312, 300, 200],
    };
    for (const [rotate, [x, y, width, height]] of Object.entries(expected)) {
      const { resolve } = letter(Number(rotate));
      const rect = { pageIndex: 0, x, y, view: { fit: "rect", width, height } };
      assert.deepEqual(await resolve([0, name("FitR"), 100, 200, 300, 500]), rect, rotate);
      assert.deepEqual(await resolve([0, name("FitR"), 300, 500, 100, 200]), rect, rotate);
      assert.deepEqual(await resolve([0, name("FitR"), 100, 500, 300, 200]), rect, rotate);
    }
  });

  it("goes to the page alone when a rectangle lacks a corner's coordinate", async () => {
    const { resolve, loaded } = letter();
    const page = { pageIndex: 0, x: null, y: null };
    assert.deepEqual(await resolve([0, name("FitR"), 100, 200, 300, null]), page);
    assert.deepEqual(await resolve([0, name("FitR"), 100, 200, 300]), page);
    assert.deepEqual(await resolve([0, name("FitR"), 100, "200", 300, 500]), page);
    assert.deepEqual(loaded, []);
  });

  it("goes to the page alone, asking no view, for a fit it does not know", async () => {
    const { resolve, loaded } = letter();
    const page = { pageIndex: 0, x: null, y: null };
    assert.deepEqual(await resolve([0, name("Zoom"), 72, 720, 2]), page);
    assert.deepEqual(await resolve([0, null, 72, 720]), page);
    assert.deepEqual(await resolve([0, "XYZ", 72, 720, 2]), page);
    assert.deepEqual(await resolve([0]), page);
    assert.deepEqual(loaded, []);
  });
});

describe("a destination", () => {
  it("looks a name up among the document's destinations, and an array not at all", async () => {
    const { resolveNamed } = documentOf([page(612, 792), page(612, 792)], {
      chapter: [{ num: 1, gen: 0 }, name("XYZ"), 72, 720, null],
    });
    assert.deepEqual(await resolveNamed("chapter"), {
      pageIndex: 1,
      x: 72,
      y: 72,
      view: { fit: "zoom", zoom: null },
    });
    assert.equal(await resolveNamed("missing"), null);
    assert.equal(await resolveNamed(""), null);
    assert.deepEqual(await resolveNamed([0, name("Fit")]), {
      pageIndex: 0,
      x: null,
      y: null,
      view: { fit: "page" },
    });
  });
});
