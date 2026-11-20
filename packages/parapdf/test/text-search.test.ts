import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPageIndex,
  findMatches,
  joinLines,
  normalizeQuery,
  type SearchMatch,
  type SearchOptions,
  sourceChars,
} from "../src/features/search/text-search.ts";
import type { PageText } from "../src/pdfjs/text.ts";

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

describe("search index position widths", () => {
  it("keeps full source positions across integer widths and normalization growth", () => {
    for (const [max, bytes] of [
      [255, 1],
      [256, 2],
      [65535, 2],
      [65536, 4],
    ] as const) {
      const items = Array<string>(max + 1).fill("");
      // Each fraction expands to three UTF-16 units, also exercising buffer growth.
      items[max] = "½".repeat(max);
      const index = buildPageIndex(page(items));
      assert.equal(index.itemOf.BYTES_PER_ELEMENT, bytes);
      assert.equal(index.startOf.BYTES_PER_ELEMENT, bytes);
      assert.equal(index.endOf.BYTES_PER_ELEMENT, bytes);
      assert.equal(index.itemOf.at(-1), max);
      assert.equal(index.startOf.at(-1), max - 1);
      assert.equal(index.endOf.at(-1), max);
      assert.equal(index.text.length, 3 * max);
    }
    const manyShort = buildPageIndex(page(Array<string>(257).fill("A")));
    assert.equal(manyShort.itemOf.BYTES_PER_ELEMENT, 2);
    assert.equal(manyShort.endOf.BYTES_PER_ELEMENT, 1);
  });
});

describe("findMatches", () => {
  it("matches across case, width, and diacritics", () => {
    const text = page(["Café ＣＭａｐ Résumé"]);
    assert.deepEqual(search(text, "cmap"), ["ＣＭａｐ"]);
    assert.deepEqual(search(text, "RESUME"), ["Résumé"]);
    assert.deepEqual(search(text, "cafe"), ["Café"]);
  });

  it("folds the final sigma as pdf.js's case-insensitive search does", () => {
    const text = page(["ΟΔΟΣ οδος"]);
    assert.deepEqual(search(text, "οδος"), ["ΟΔΟΣ", "οδος"]);
    assert.deepEqual(search(text, "ΟΔΟΣ"), ["ΟΔΟΣ", "οδος"]);
    assert.deepEqual(search(text, "οδος", { caseSensitive: true }), ["οδος"]);
  });

  it("ends a match after the marks of its last letter, as pdf.js's matches do", () => {
    // é written as e and a combining accent, and Hindi's vowel signs, which are marks.
    assert.deepEqual(search(page(["café noir"]), "café"), ["café"]);
    assert.deepEqual(search(page(["हिंदी भाषा"]), "हिंदी"), ["हिंदी"]);
  });

  it("matches the letters of a ligature, taking it whole", () => {
    assert.deepEqual(search(page(["ﬁnd the ﬂow"]), "find"), ["ﬁnd"]);
    assert.deepEqual(search(page(["ﬁnd"]), "ind"), ["ﬁnd"]);
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
    const text = page(["self-", "Esteem"], [true, false]);
    assert.deepEqual(search(text, "self-esteem"), ["self-Esteem"]);
    assert.deepEqual(search(text, "selfesteem"), []);
  });

  it("joins upper-case words, and words broken after an accented letter, as pdf.js does", () => {
    assert.deepEqual(search(page(["PRE-", "VIEW"], [true, false]), "preview"), ["PRE-VIEW"]);
    assert.deepEqual(search(page(["Café-", "Bar"], [true, false]), "cafébar"), ["Café-Bar"]);
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

  it("counts digits, underscores, and letters beyond the BMP as parts of words", () => {
    const text = page(["x1 x_y 𐐨x x𐐨 x😀 x"]);
    assert.deepEqual(search(text, "x", { entireWord: true }), ["x", "x"]);
  });

  it("matches composed and decomposed accents alike when diacritics match", () => {
    const text = page(["café café cafe"]);
    assert.deepEqual(search(text, "café", { matchDiacritics: true }), ["café", "café"]);
    assert.deepEqual(search(text, "café", { matchDiacritics: true }), ["café", "café"]);
  });

  it("respects supplementary combining marks (such as CJK variation selectors) when diacritics match", () => {
    const ivs = "\u{E0100}";
    const text = page([`葛${ivs} 葛`]);
    assert.deepEqual(search(text, "葛", { matchDiacritics: true }), ["葛"]);
    assert.deepEqual(search(text, `葛${ivs}`, { matchDiacritics: true }), [`葛${ivs}`]);
  });

  it("matches joinLines(sourceChars(page)) exactly across ASCII, CJK, hyphens, ligatures, and marks", () => {
    const samples: PageText[] = [
      page([], []),
      page(["", ""], [true, true]),
      page(
        [
          "  ASCII\tlines-\n",
          "joined",
          "PRE-",
          "VIEW",
          "2020-",
          "",
          "2025",
          "Café-",
          "Bar ﬁnd ½ “quote” ΟΔΟΣ ς",
          "厚生",
          "労働省 ﾃﾞｰﾀ 𠮷野家 葛\u{E0100} cafe\u0301",
          "-",
          "end-",
        ],
        [false, true, true, true, true, true, true, true, true, true, true, true, true],
      ),
    ];

    for (const sample of samples) {
      for (const caseSensitive of [false, true]) {
        for (const matchDiacritics of [false, true]) {
          for (const keepDashes of [false, true]) {
            const options = { caseSensitive, matchDiacritics, keepDashes };
            const actual = buildPageIndex(sample, options);

            const parts: string[] = [];
            const itemOf: number[] = [];
            const startOf: number[] = [];
            const endOf: number[] = [];
            let lastWasSpace = true;
            for (const source of joinLines(sourceChars(sample), keepDashes)) {
              const single = buildPageIndex(page([source.char], [false]), {
                caseSensitive,
                matchDiacritics,
              }).text;
              const rawSpace = /\s/u.test(source.char);
              const normalized = !single && rawSpace ? " " : single;
              const last = endOf.length - 1;
              if (!normalized && itemOf[last] === source.item && endOf[last] === source.start) {
                endOf[last] = source.end;
              }
              for (const unit of normalized) {
                const space = unit === " ";
                if (space && lastWasSpace) continue;
                parts.push(unit);
                for (let k = 0; k < unit.length; k++) {
                  itemOf.push(source.item);
                  startOf.push(source.start);
                  endOf.push(source.end);
                }
                lastWasSpace = space;
              }
            }

            assert.equal(actual.text, parts.join(""));
            assert.deepEqual([...actual.itemOf], itemOf);
            assert.deepEqual([...actual.startOf], startOf);
            assert.deepEqual([...actual.endOf], endOf);
          }
        }
      }
    }
  });
});
