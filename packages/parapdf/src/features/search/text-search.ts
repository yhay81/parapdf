import type { PageText } from "../../pdfjs/text.ts";

/** A position inside one text item; `offset` counts UTF-16 code units like DOM ranges. */
export interface TextPosition {
  item: number;
  offset: number;
}

export interface SearchMatch {
  pageIndex: number;
  start: TextPosition;
  /** Exclusive end. */
  end: TextPosition;
}

/** How a search compares text. Every option is off by default, as in pdf.js's find bar. */
export interface SearchOptions {
  /** Upper and lower case differ. */
  caseSensitive?: boolean;
  /** A match must be a whole word, not part of a longer one. */
  entireWord?: boolean;
  /** Accented letters differ from their base letters, and from each other. */
  matchDiacritics?: boolean;
}

/**
 * The searchable form of one page: normalized text plus, for every UTF-16
 * code unit of it, the item and source offsets it came from.
 */
export interface PageIndex {
  readonly text: string;
  readonly itemOf: Uint32Array;
  readonly startOf: Uint32Array;
  readonly endOf: Uint32Array;
}

/*
 * Search normalization follows normalize() and the matching options of
 * PDFFindController in PDF.js `web/pdf_find_controller.js` (pdfjs-dist
 * 6.4.299; Copyright Mozilla Foundation, Apache License 2.0; see NOTICE.md):
 * compatibility forms are ignored, and by default case and diacritics too; a
 * line end inside a CJK run or a hyphenated word joins the lines, and any
 * other line end reads as a space. pdf.js keeps diacritics in the page text
 * and lets its query regular expression skip them; stripping them from both
 * sides gives the same matches with plain substring search. With
 * `matchDiacritics`, both keep them, and a match may not end before a mark
 * that changes its last letter. Whole words are ParaPDF's own rule: the
 * characters around a match must not be letters, marks, digits, or
 * underscores where the match's own edge is one.
 */

/** pdf.js's CHARACTERS_TO_NORMALIZE: typographic quotes, the hyphen, and fractions. */
const CHARACTERS_TO_NORMALIZE = new Map([
  ["\u2010", "-"],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201A", "'"],
  ["\u201B", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u201E", '"'],
  ["\u201F", '"'],
  ["\u00BC", "1/4"],
  ["\u00BD", "1/2"],
  ["\u00BE", "3/4"],
]);

/**
 * pdf.js's DIACRITICS_EXCEPTION: combining marks that make a different
 * letter, such as Japanese voiced sound marks and Indic viramas, so they
 * still count when diacritics are ignored.
 */
const DIACRITICS_EXCEPTION = new Set([
  0x3099, 0x309a, 0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d3b, 0x0d3c,
  0x0d4d, 0x0dca, 0x0e3a, 0x0eba, 0x0f84, 0x1039, 0x103a, 0x1714, 0x1734, 0x17d2, 0x1a60, 0x1b44,
  0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f, 0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed,
  0x0c56, 0x0f71, 0x0f72, 0x0f7a, 0x0f7b, 0x0f7c, 0x0f7d, 0x0f80, 0x0f74,
]);

const SPACE = /\s/u;
const MARK = /\p{M}/u;
const LOWERCASE = /^\p{Ll}$/u;
const UPPERCASE = /^\p{Lu}$/u;
const LETTER = /^\p{L}$/u;
/** A line end after these joins the lines: CJK has no spaces between words. */
const JOINS_LINES = /^(?:\p{Ideographic}|[\u3040-\u30FF]|\u3099|\u309A)$/u;

/**
 * The searchable form of one character: possibly empty, possibly several.
 * It stays decomposed, as pdf.js's normalized text does: half-width katakana
 * write a voiced sound mark as a character of its own (ﾃﾞ), which matches the
 * composed letter (デ) only in decomposed form.
 */
function normalizeChar(char: string, options: SearchOptions): string {
  const replacement = CHARACTERS_TO_NORMALIZE.get(char);
  if (replacement) return replacement;
  let out = "";
  const compatible = char.normalize("NFKC");
  // The final sigma folds as in pdf.js's case-insensitive regular expression.
  const folded = options.caseSensitive ? compatible : compatible.toLowerCase().replaceAll("ς", "σ");
  for (const unit of folded.normalize("NFD")) {
    if (
      !options.matchDiacritics &&
      MARK.test(unit) &&
      !DIACRITICS_EXCEPTION.has(unit.codePointAt(0) ?? 0)
    ) {
      continue;
    }
    out += unit;
  }
  return out;
}

/** True when `char` decomposes into a letter followed by combining marks. */
const endsWithMark = (char: string): boolean => MARK.test(char.normalize("NFD").slice(-1));

export function normalizeQuery(query: string, options: SearchOptions = {}): string {
  let out = "";
  let lastWasSpace = true;
  for (const char of query) {
    for (const unit of normalizeChar(char, options)) {
      const space = SPACE.test(unit);
      if (space && lastWasSpace) continue;
      out += space ? " " : unit;
      lastWasSpace = space;
    }
  }
  return out.trimEnd();
}

export interface SourceChar {
  /** One code point, or "\n" for the end of a line. */
  char: string;
  item: number;
  start: number;
  end: number;
}

/**
 * The page as pdf.js's find controller sees it: the code points of its items
 * in order, and "\n" after each item that ends a line, at the item's end.
 */
export function sourceChars(page: PageText): SourceChar[] {
  const chars: SourceChar[] = [];
  page.items.forEach((str, item) => {
    let offset = 0;
    for (const char of str) {
      chars.push({ char, item, start: offset, end: offset + char.length });
      offset += char.length;
    }
    if (page.endsLine[item]) chars.push({ char: "\n", item, start: offset, end: offset });
  });
  return chars;
}

/**
 * `chars` with their line ends joined as search joins them: a line end
 * inside a CJK run or a word hyphenated across lines disappears, with the
 * hyphen; a dash before a line end stays and joins the lines; any other line
 * end becomes a space. With `keepDashes`, a hyphen across lines stays too,
 * as pdf.js's `normalize()` keeps it with `ignoreDashEOL`.
 */
export function* joinLines(
  chars: readonly SourceChar[],
  keepDashes = false,
): Generator<SourceChar> {
  for (let i = 0; i < chars.length; i++) {
    const source = chars[i] as SourceChar;
    const before = chars[i - 1]?.char ?? "";
    if (source.char === "\n") {
      if (!JOINS_LINES.test(before)) yield { ...source, char: " " };
      continue;
    }
    if (source.char === "-" && chars[i + 1]?.char === "\n") {
      const after = chars[i + 2]?.char ?? "";
      if (
        !keepDashes &&
        (endsWithMark(before) ||
          (LOWERCASE.test(before) && LOWERCASE.test(after)) ||
          (UPPERCASE.test(before) && LETTER.test(after)))
      ) {
        // A word hyphenated across lines: drop the hyphen and the line end.
        i++;
        continue;
      }
      if (before && !SPACE.test(before)) {
        // Any other dash right before a line end stays and joins the lines.
        yield source;
        i++;
        continue;
      }
    }
    yield source;
  }
}

/**
 * The page's searchable text; only `caseSensitive` and `matchDiacritics`
 * change it, and `keepDashes` (see `joinLines()`).
 */
export function buildPageIndex(
  page: PageText,
  options: SearchOptions & { keepDashes?: boolean } = {},
): PageIndex {
  const parts: string[] = [];
  const itemOf: number[] = [];
  const startOf: number[] = [];
  const endOf: number[] = [];
  let lastWasSpace = true;
  const append = (normalized: string, { item, start, end }: SourceChar) => {
    for (const unit of normalized) {
      const space = SPACE.test(unit);
      // Collapse whitespace runs, including the space a line end stands for.
      if (space && lastWasSpace) continue;
      const text = space ? " " : unit;
      parts.push(text);
      for (let k = 0; k < text.length; k++) {
        itemOf.push(item);
        startOf.push(start);
        endOf.push(end);
      }
      lastWasSpace = space;
    }
  };

  for (const source of joinLines(sourceChars(page), options.keepDashes)) {
    const normalized = normalizeChar(source.char, options);
    const last = endOf.length - 1;
    // An ignored mark belongs to the letter before it, where pdf.js's matches end.
    if (!normalized && itemOf[last] === source.item && endOf[last] === source.start) {
      endOf[last] = source.end;
    }
    append(normalized, source);
  }
  return {
    text: parts.join(""),
    itemOf: Uint32Array.from(itemOf),
    startOf: Uint32Array.from(startOf),
    endOf: Uint32Array.from(endOf),
  };
}

const WORD = /^[\p{L}\p{M}\p{N}_]/u;

/** The character (code point) of `text` that ends just before `at`, "" at the start. */
function charBefore(text: string, at: number): string {
  if (at <= 0) return "";
  const low = text.charCodeAt(at - 1);
  return low >= 0xdc00 && low <= 0xdfff && at >= 2 ? text.slice(at - 2, at) : text.charAt(at - 1);
}

/** Whether `text` from `at` for `length` code units is not part of a longer word. */
function isEntireWord(text: string, at: number, length: number): boolean {
  const first = String.fromCodePoint(text.codePointAt(at) ?? 0);
  const last = charBefore(text, at + length);
  const before = charBefore(text, at);
  const after =
    at + length < text.length ? String.fromCodePoint(text.codePointAt(at + length) ?? 0) : "";
  return !(WORD.test(before) && WORD.test(first)) && !(WORD.test(after) && WORD.test(last));
}

/**
 * Non-overlapping matches of a query normalized with the same options, at
 * most `limit`.
 */
export function findMatches(
  index: PageIndex,
  query: string,
  pageIndex: number,
  limit = 10_000,
  options: SearchOptions = {},
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  let from = 0;
  while (matches.length < limit) {
    const at = index.text.indexOf(query, from);
    if (at < 0) break;
    const end = at + query.length;
    if (
      (options.matchDiacritics && MARK.test(index.text.charAt(end))) ||
      (options.entireWord && !isEntireWord(index.text, at, query.length))
    ) {
      // A letter whose mark the query lacks, or part of a longer word: look on.
      from = at + 1;
      continue;
    }
    const last = end - 1;
    matches.push({
      pageIndex,
      start: { item: index.itemOf[at] ?? 0, offset: index.startOf[at] ?? 0 },
      end: { item: index.itemOf[last] ?? 0, offset: index.endOf[last] ?? 0 },
    });
    from = at + query.length;
  }
  return matches;
}
