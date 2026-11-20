// Derived from PDF.js `web/pdf_find_controller.js` (pdfjs-dist 6.4.299),
// Copyright Mozilla Foundation, Apache License 2.0, and changed for ParaPDF;
// see NOTICE.md.

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
  readonly itemOf: PositionArray;
  readonly startOf: PositionArray;
  readonly endOf: PositionArray;
}

/*
 * Search normalization follows normalize() and the matching options of
 * PDFFindController in PDF.js `web/pdf_find_controller.js`: compatibility
 * forms are ignored, and by default case and diacritics too; a line end
 * inside a CJK run or a hyphenated word joins the lines, and any other line
 * end reads as a space. pdf.js keeps diacritics in the page text
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

const MAX_NORMALIZE_CACHE = 4096;
const normalizeCaches: [
  Map<number, string>,
  Map<number, string>,
  Map<number, string>,
  Map<number, string>,
] = [new Map(), new Map(), new Map(), new Map()];

export function isSpaceCodePoint(cp: number): boolean {
  if (cp < 0x80) return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
  if (cp === 0x00a0 || cp === 0x3000 || (cp >= 0x2000 && cp <= 0x200a)) return true;
  if (cp < 0x0085) return false;
  return SPACE.test(String.fromCodePoint(cp));
}

function joinsLinesCodePoint(cp: number): boolean {
  if (cp < 0x2e80) return false;
  if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff)) return true;
  return JOINS_LINES.test(String.fromCodePoint(cp));
}

function shouldDropHyphenCodePoints(beforeCp: number, afterCp: number): boolean {
  if (beforeCp < 0) return false;
  if (beforeCp < 0x80 && afterCp >= 0 && afterCp < 0x80) {
    const beforeLower = beforeCp >= 0x61 && beforeCp <= 0x7a;
    const afterLower = afterCp >= 0x61 && afterCp <= 0x7a;
    if (beforeLower && afterLower) return true;
    const beforeUpper = beforeCp >= 0x41 && beforeCp <= 0x5a;
    const afterUpper = afterCp >= 0x41 && afterCp <= 0x5a;
    return beforeUpper && (afterLower || afterUpper);
  }
  const before = String.fromCodePoint(beforeCp);
  const after = afterCp >= 0 ? String.fromCodePoint(afterCp) : "";
  return (
    endsWithMark(before) ||
    (LOWERCASE.test(before) && LOWERCASE.test(after)) ||
    (UPPERCASE.test(before) && LETTER.test(after))
  );
}

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

function normalizeNonAsciiCodePoint(cp: number, options: SearchOptions): string {
  const mode = ((options.caseSensitive ? 1 : 0) | (options.matchDiacritics ? 2 : 0)) as
    | 0
    | 1
    | 2
    | 3;
  const cache = normalizeCaches[mode];
  const cached = cache.get(cp);
  if (cached !== undefined) return cached;
  const normalized = normalizeChar(String.fromCodePoint(cp), options);
  if (cache.size >= MAX_NORMALIZE_CACHE) cache.clear();
  cache.set(cp, normalized);
  return normalized;
}

/** True when `char` decomposes into a letter followed by combining marks. */
const endsWithMark = (char: string): boolean => /\p{M}$/u.test(char.normalize("NFD"));

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

function growUint16(array: Uint16Array<ArrayBuffer>, minLength: number) {
  const next = new Uint16Array(Math.max(minLength, array.length * 2, 64));
  next.set(array);
  return next;
}

type PositionArray = Uint8Array | Uint16Array | Uint32Array;

function positionArrayType(max: number) {
  if (max <= 0xff) return Uint8Array;
  return max <= 0xffff ? Uint16Array : Uint32Array;
}

function codesToString(codes: Uint16Array, length: number): string {
  if (length === 0) return "";
  const CHUNK = 8192;
  if (length <= CHUNK) {
    return String.fromCharCode(...codes.subarray(0, length));
  }
  let out = "";
  for (let offset = 0; offset < length; offset += CHUNK) {
    out += String.fromCharCode(...codes.subarray(offset, Math.min(length, offset + CHUNK)));
  }
  return out;
}

/**
 * The page's searchable text; only `caseSensitive` and `matchDiacritics`
 * change it, and `keepDashes` (see `joinLines()`).
 */
export function buildPageIndex(
  page: PageText,
  options: SearchOptions & { keepDashes?: boolean } = {},
): PageIndex {
  const { items, endsLine } = page;
  const caseSensitive = options.caseSensitive ?? false;
  const keepDashes = options.keepDashes ?? false;

  let estimated = 0;
  let longestItem = 0;
  for (let i = 0; i < items.length; i++) {
    const length = items[i]?.length ?? 0;
    estimated += length + (endsLine[i] ? 1 : 0);
    longestItem = Math.max(longestItem, length);
  }
  if (estimated === 0) {
    const empty = new Uint32Array(0);
    return { text: "", itemOf: empty, startOf: empty, endOf: empty };
  }

  let codes = new Uint16Array(estimated);
  const ItemArray = positionArrayType(items.length - 1);
  const OffsetArray = positionArrayType(longestItem);
  let itemOf = new ItemArray(estimated);
  let startOf = new OffsetArray(estimated);
  let endOf = new OffsetArray(estimated);
  let length = 0;
  let lastWasSpace = true;

  const ensure = (extra: number) => {
    const needed = length + extra;
    if (needed <= codes.length) return;
    codes = growUint16(codes, needed);
    const nextItems = new ItemArray(codes.length);
    const nextStarts = new OffsetArray(codes.length);
    const nextEnds = new OffsetArray(codes.length);
    nextItems.set(itemOf);
    nextStarts.set(startOf);
    nextEnds.set(endOf);
    itemOf = nextItems;
    startOf = nextStarts;
    endOf = nextEnds;
  };

  const writeUnit = (code: number, item: number, start: number, end: number) => {
    if (length >= codes.length) ensure(1);
    codes[length] = code;
    itemOf[length] = item;
    startOf[length] = start;
    endOf[length] = end;
    length++;
  };

  const emitJoined = (cp: number, item: number, start: number, end: number) => {
    if (cp < 0x80) {
      const space = cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
      if (space) {
        if (lastWasSpace) return;
        writeUnit(0x20, item, start, end);
        lastWasSpace = true;
        return;
      }
      const out = !caseSensitive && cp >= 0x41 && cp <= 0x5a ? cp + 32 : cp;
      writeUnit(out, item, start, end);
      lastWasSpace = false;
      return;
    }

    const normalized = normalizeNonAsciiCodePoint(cp, options);
    if (!normalized) {
      // An ignored mark belongs to the letter before it, where pdf.js's matches end.
      const last = length - 1;
      if (last >= 0 && itemOf[last] === item && endOf[last] === start) {
        endOf[last] = end;
      }
      return;
    }

    for (let u = 0; u < normalized.length; ) {
      const unitCp = normalized.codePointAt(u) ?? 0;
      const step = unitCp > 0xffff ? 2 : 1;
      u += step;
      const space = isSpaceCodePoint(unitCp);
      if (space && lastWasSpace) continue;
      if (space) {
        writeUnit(0x20, item, start, end);
      } else if (step === 1) {
        writeUnit(unitCp, item, start, end);
      } else {
        ensure(2);
        const offset = unitCp - 0x10000;
        writeUnit(0xd800 + (offset >> 10), item, start, end);
        writeUnit(0xdc00 + (offset & 0x3ff), item, start, end);
      }
      lastWasSpace = space;
    }
  };

  // Three-slot lookahead matching `joinLines(sourceChars(page), keepDashes)` without object allocations.
  let prevCp = -1;
  let has0 = false;
  let cp0 = 0;
  let item0 = 0;
  let start0 = 0;
  let end0 = 0;
  let has1 = false;
  let cp1 = 0;
  let item1 = 0;
  let start1 = 0;
  let end1 = 0;
  let has2 = false;
  let cp2 = 0;
  let item2 = 0;
  let start2 = 0;
  let end2 = 0;

  const stepQueue = () => {
    if (cp0 === 0x0a) {
      if (!joinsLinesCodePoint(prevCp)) emitJoined(0x20, item0, start0, end0);
      prevCp = 0x0a;
      has0 = has1;
      cp0 = cp1;
      item0 = item1;
      start0 = start1;
      end0 = end1;
      has1 = has2;
      cp1 = cp2;
      item1 = item2;
      start1 = start2;
      end1 = end2;
      has2 = false;
      return;
    }
    if (cp0 === 0x2d && has1 && cp1 === 0x0a) {
      const afterCp = has2 ? cp2 : -1;
      if (!keepDashes && shouldDropHyphenCodePoints(prevCp, afterCp)) {
        prevCp = 0x0a;
        has0 = has2;
        cp0 = cp2;
        item0 = item2;
        start0 = start2;
        end0 = end2;
        has1 = false;
        has2 = false;
        return;
      }
      if (prevCp >= 0 && !isSpaceCodePoint(prevCp)) {
        emitJoined(0x2d, item0, start0, end0);
        prevCp = 0x0a;
        has0 = has2;
        cp0 = cp2;
        item0 = item2;
        start0 = start2;
        end0 = end2;
        has1 = false;
        has2 = false;
        return;
      }
    }
    emitJoined(cp0, item0, start0, end0);
    prevCp = cp0;
    has0 = has1;
    cp0 = cp1;
    item0 = item1;
    start0 = start1;
    end0 = end1;
    has1 = has2;
    cp1 = cp2;
    item1 = item2;
    start1 = start2;
    end1 = end2;
    has2 = false;
  };

  const pushToken = (cp: number, item: number, start: number, end: number) => {
    if (!has0) {
      has0 = true;
      cp0 = cp;
      item0 = item;
      start0 = start;
      end0 = end;
      return;
    }
    if (!has1) {
      has1 = true;
      cp1 = cp;
      item1 = item;
      start1 = start;
      end1 = end;
      return;
    }
    has2 = true;
    cp2 = cp;
    item2 = item;
    start2 = start;
    end2 = end;
    stepQueue();
  };

  for (let item = 0; item < items.length; item++) {
    const str = items[item] ?? "";
    for (let offset = 0; offset < str.length; ) {
      const cp = str.codePointAt(offset) ?? 0;
      const next = offset + (cp > 0xffff ? 2 : 1);
      pushToken(cp, item, offset, next);
      offset = next;
    }
    if (endsLine[item]) pushToken(0x0a, item, str.length, str.length);
  }
  while (has0) stepQueue();

  return {
    text: codesToString(codes, length),
    itemOf: itemOf.length === length ? itemOf : itemOf.slice(0, length),
    startOf: startOf.length === length ? startOf : startOf.slice(0, length),
    endOf: endOf.length === length ? endOf : endOf.slice(0, length),
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
      (options.matchDiacritics &&
        end < index.text.length &&
        MARK.test(String.fromCodePoint(index.text.codePointAt(end) ?? 0))) ||
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
