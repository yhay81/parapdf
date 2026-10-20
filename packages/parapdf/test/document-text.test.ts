import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageText } from "../src/engine/types.ts";
import { pageText } from "../src/runtime/document-text.ts";

/** A page of text items; `endsLine` marks the items a line end follows. */
const page = (items: string[], endsLine: boolean[] = items.map(() => false)): PageText => ({
  items,
  endsLine,
  boxes: new Float32Array(items.length * 4),
});

describe("pageText", () => {
  const lines = page(["First ", "line", "Second line", "Third"], [false, true, true, false]);

  it("joins items in order and ends lines with a line break", () => {
    assert.equal(pageText(lines), "First line\nSecond line\nThird");
  });

  it("drops the line break after the page's last item", () => {
    assert.equal(pageText(page(["Only"], [true])), "Only");
  });

  it("joins lines as search does", () => {
    assert.equal(pageText(lines, "join"), "First line Second line Third");
    // A word hyphenated across lines, a dash that stays, and a CJK run.
    assert.equal(
      pageText(
        page(
          ["hyphen-", "ated", "well-", "Known", "日本", "語"],
          [true, true, true, false, true, false],
        ),
        "join",
      ),
      "hyphenated well-Known日本語",
    );
  });

  it("writes no second space where a line already ends with one", () => {
    assert.equal(
      pageText(page(["Ends with space ", "next"], [true, false]), "join"),
      "Ends with space next",
    );
    assert.equal(
      pageText(page(["Line", " starts with one"], [true, false]), "join"),
      "Line starts with one",
    );
  });

  it("reads from and to points on the page", () => {
    // From "line" in item 1 to before "line" in item 2.
    assert.equal(
      pageText(lines, "keep", { item: 1, offset: 0 }, { item: 2, offset: 7 }),
      "line\nSecond ",
    );
    assert.equal(
      pageText(lines, "join", { item: 0, offset: 6 }, { item: 3, offset: 0 }),
      "line Second line",
    );
    assert.equal(pageText(lines, "keep", { item: 3, offset: 2 }), "ird");
    // A point at an item's end excludes the line end after it.
    assert.equal(pageText(lines, "keep", null, { item: 1, offset: 4 }), "First line");
  });

  it("reads surrogate pairs whole", () => {
    assert.equal(
      pageText(page(["𝐀𝐁", "c"], [true, false]), "keep", { item: 0, offset: 2 }),
      "𝐁\nc",
    );
  });
});
