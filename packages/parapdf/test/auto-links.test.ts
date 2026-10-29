import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coveredByLink, findLinks } from "../src/features/auto-links.ts";
import { buildPageIndex } from "../src/features/search/text-search.ts";
import type { PageText } from "../src/pdfjs/text.ts";

/** A page of `lines`, an item each, each ending a line. */
function page(...lines: string[]): PageText {
  return {
    items: lines,
    endsLine: lines.map(() => true),
    boxes: new Float32Array(lines.length * 4),
  };
}

const links = (text: PageText) =>
  findLinks(buildPageIndex(text, { caseSensitive: true, matchDiacritics: true, keepDashes: true }));

describe("findLinks", () => {
  it("finds URLs, www. addresses, and e-mail addresses, with where they are", () => {
    const found = links(
      page(
        "See https://example.com/Guide?page=2.",
        "or www.example.org/mirror",
        "Mail me@example.net",
      ),
    );
    assert.deepEqual(
      found.map(({ url }) => url),
      [
        "https://example.com/Guide?page=2",
        "http://www.example.org/mirror",
        "mailto:me@example.net",
      ],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 4 });
    assert.deepEqual(found[0]?.end, { item: 0, offset: 36 });
    assert.deepEqual(found[2]?.start, { item: 2, offset: 5 });
    assert.deepEqual(found[2]?.end, { item: 2, offset: 19 });
  });

  it("leaves out what is no address", () => {
    assert.deepEqual(links(page("version 1.2.3", "a@b.", "user@10.0.0.1", "www.example")), []);
  });

  it("keeps a hyphen at a line's end inside a URL, as pdf.js's viewer does", () => {
    const found = links(page("https://example.com/long-", "path"));
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/long-path"],
    );
    assert.deepEqual(found[0]?.end, { item: 1, offset: 4 });
  });

  it("ends a link at a line end without a hyphen", () => {
    assert.deepEqual(
      links(page("https://example.com/a", "b")).map(({ url }) => url),
      ["https://example.com/a"],
    );
  });

  it("finds a link written in several items of one line, as search reads them", () => {
    const text: PageText = {
      items: ["Visit https://exa", "mple.com today"],
      endsLine: [false, true],
      boxes: new Float32Array(8),
    };
    const found = links(text);
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/"],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 6 });
    assert.deepEqual(found[0]?.end, { item: 1, offset: 8 });
  });

  it("maps a link back through compatibility forms and ligatures", () => {
    // Full-width letters and the fi ligature, which read as their plain letters.
    const found = links(page("Go to ｈｔｔｐｓ://example.com/ﬁle now"));
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/file"],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 6 });
    assert.deepEqual(found[0]?.end, { item: 0, offset: 29 });
  });

  it("keeps mailto: addresses as they are", () => {
    assert.deepEqual(
      links(page("mailto:me@example.net")).map(({ url }) => url),
      ["mailto:me@example.net"],
    );
  });
});

describe("coveredByLink", () => {
  const link = { rect: [100, 100, 200, 120] as [number, number, number, number] };

  it("leaves out a link the file covers by more than half", () => {
    assert.equal(coveredByLink(link, [{ rect: [90, 95, 180, 125] }]), true);
  });

  it("keeps a link the file covers by half or less, or not at all", () => {
    assert.equal(coveredByLink(link, [{ rect: [150, 95, 300, 125] }]), false);
    assert.equal(coveredByLink(link, [{ rect: [300, 300, 400, 320] }]), false);
    assert.equal(coveredByLink(link, []), false);
    // Two of the file's links that cover two fifths each: each counts on its own.
    const twoFifths: { rect: [number, number, number, number] }[] = [
      { rect: [100, 95, 140, 125] },
      { rect: [160, 95, 200, 125] },
    ];
    assert.equal(coveredByLink(link, twoFifths), false);
  });

  it("measures a link over two lines by both lines", () => {
    // Two lines of 100 by 20 points, as quadrilaterals.
    const twoLines = {
      rect: [0, 0, 100, 60] as [number, number, number, number],
      quadPoints: [0, 60, 100, 60, 0, 40, 100, 40, 0, 20, 100, 20, 0, 0, 100, 0],
    };
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 40, 100, 60] }]), false, "one line of two");
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 30, 100, 60] }]), false);
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 0, 100, 50] }]), true);
  });

  it("measures a file's link by its quadrilaterals", () => {
    // Two lines; only the second overlaps the link.
    const quadPoints = [0, 50, 50, 50, 0, 40, 50, 40, 100, 120, 200, 120, 100, 100, 200, 100];
    assert.equal(coveredByLink(link, [{ rect: [0, 40, 200, 120], quadPoints }]), true);
    const elsewhere = [0, 50, 50, 50, 0, 40, 50, 40, 0, 70, 50, 70, 0, 60, 50, 60];
    assert.equal(coveredByLink(link, [{ rect: [0, 40, 200, 120], quadPoints: elsewhere }]), false);
  });
});
