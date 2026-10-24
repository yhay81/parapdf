import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageText } from "../src/pdfjs/text.ts";
import {
  buildPageIndex,
  findMatches,
  normalizeQuery,
  type SearchMatch,
  type SearchOptions,
} from "../src/runtime/text-search.ts";

/** A page of text items; `endsLine` marks the items a line end follows. */
const page = (items: string[], endsLine: boolean[] = items.map(() => false)): PageText => ({
  items,
  endsLine,
  boxes: new Float32Array(items.length * 4),
});

/** The source text each match covers, read back through its item positions. */
function search(text: PageText, query: string, options: SearchOptions = {}): string[] {
  const matches = findMatches(
    buildPageIndex(text, options),
    normalizeQuery(query, options),
    0,
    undefined,
    options,
  );
  return matches.map(({ start, end }: SearchMatch) => {
    if (start.item === end.item)
      return text.items[start.item]?.slice(start.offset, end.offset) ?? "";
    let covered = text.items[start.item]?.slice(start.offset) ?? "";
    for (let item = start.item + 1; item < end.item; item++) covered += text.items[item];
    return covered + (text.items[end.item]?.slice(0, end.offset) ?? "");
  });
}

describe("normalizeQuery", () => {
  it("ignores compatibility forms, case, diacritics, and repeated spaces", () => {
    assert.equal(normalizeQuery("  Ｈｅｌｌｏ　 Wörld  "), "hello world");
  });

  it("replaces typographic quotes and fractions as pdf.js does", () => {
    assert.equal(normalizeQuery("“Quoted” ‘text’ ½"), "\"quoted\" 'text' 1/2");
  });

  it("is empty for a query of spaces", () => {
    assert.equal(normalizeQuery(" \t "), "");
  });
});

describe("findMatches", () => {
  it("matches across case, width, and diacritics", () => {
    const text = page(["Café ＣＭａｐ Résumé"]);
    assert.deepEqual(search(text, "cmap"), ["ＣＭａｐ"]);
    assert.deepEqual(search(text, "RESUME"), ["Résumé"]);
    assert.deepEqual(search(text, "cafe"), ["Café"]);
  });

  it("keeps the marks that make a different letter", () => {
    assert.deepEqual(search(page(["ガス"]), "カス"), []);
    assert.deepEqual(search(page(["ガス"]), "ガス"), ["ガス"]);
  });

  it("matches half-width katakana with separate voiced sound marks", () => {
    assert.deepEqual(search(page(["ﾃﾞｰﾀ"]), "データ"), ["ﾃﾞｰﾀ"]);
    assert.deepEqual(search(page(["データ"]), "ﾃﾞｰﾀ"), ["データ"]);
  });

  it("joins lines that end inside a Japanese word", () => {
    assert.deepEqual(search(page(["厚生", "労働省"], [true, false]), "厚生労働"), ["厚生労働"]);
  });

  it("joins a word hyphenated across lines", () => {
    assert.deepEqual(search(page(["divi-", "sions"], [true, false]), "divisions"), ["divi-sions"]);
  });

  it("keeps any other dash before a line end", () => {
    assert.deepEqual(search(page(["2010-", "2020"], [true, false]), "2010-2020"), ["2010-2020"]);
  });

  it("reads other line ends as spaces and collapses whitespace", () => {
    const text = page(["hello", "world", "a  \t b"], [true, false, false]);
    assert.deepEqual(search(text, "hello world"), ["helloworld"]);
    assert.deepEqual(search(text, "helloworld"), []);
    assert.deepEqual(search(text, "a b"), ["a  \t b"]);
  });

  it("counts offsets in UTF-16 code units, as DOM ranges do", () => {
    const index = buildPageIndex(page(["𠮷野家 𠮷"]));
    const matches = findMatches(index, normalizeQuery("𠮷"), 3);
    assert.deepEqual(matches, [
      { pageIndex: 3, start: { item: 0, offset: 0 }, end: { item: 0, offset: 2 } },
      { pageIndex: 3, start: { item: 0, offset: 5 }, end: { item: 0, offset: 7 } },
    ]);
  });

  it("finds non-overlapping matches up to the limit", () => {
    const index = buildPageIndex(page(["aaaaa"]));
    assert.equal(findMatches(index, "aa", 0).length, 2);
    assert.equal(findMatches(index, "a", 0, 3).length, 3);
    assert.deepEqual(findMatches(index, "", 0), []);
  });
});

describe("search options", () => {
  it("tells upper and lower case apart when case-sensitive", () => {
    const text = page(["Rose rose ROSE"]);
    assert.deepEqual(search(text, "rose", { caseSensitive: true }), ["rose"]);
    assert.deepEqual(search(text, "Rose", { caseSensitive: true }), ["Rose"]);
    assert.deepEqual(search(text, "rose"), ["Rose", "rose", "ROSE"]);
  });

  it("still ignores compatibility forms when case-sensitive", () => {
    assert.deepEqual(search(page(["ＰＤＦ"]), "PDF", { caseSensitive: true }), ["ＰＤＦ"]);
  });

  it("tells accented letters apart when diacritics match", () => {
    const text = page(["resume résumé"]);
    assert.deepEqual(search(text, "resume", { matchDiacritics: true }), ["resume"]);
    assert.deepEqual(search(text, "résumé", { matchDiacritics: true }), ["résumé"]);
    // The e of é is not an e on its own.
    assert.deepEqual(search(page(["café"]), "cafe", { matchDiacritics: true }), []);
    assert.deepEqual(search(text, "resume"), ["resume", "résumé"]);
  });

  it("finds whole words only when asked", () => {
    const text = page(["cat concatenate cat-like (cat) cats"]);
    assert.deepEqual(search(text, "cat", { entireWord: true }), ["cat", "cat", "cat"]);
    assert.equal(search(text, "cat").length, 5);
    // A query that starts or ends with a non-word character may touch a word there.
    assert.deepEqual(search(text, "(cat", { entireWord: true }), ["(cat"]);
  });

  it("treats accented letters as part of a word", () => {
    assert.deepEqual(search(page(["naïve nai"]), "nai", { entireWord: true }), ["nai"]);
  });
});
