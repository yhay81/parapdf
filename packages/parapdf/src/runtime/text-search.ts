import type { PageText } from "../engine/types.ts";

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

/**
 * Per-character compatibility normalization and case folding. Matching
 * full-width Latin with ASCII, ligatures with their letters, and half-width
 * katakana with full-width katakana matters for CJK documents in particular.
 */
const normalizeChar = (char: string): string => char.normalize("NFKC").toLowerCase();
const SPACE = /\s/u;

export function normalizeQuery(query: string): string {
  let out = "";
  let lastWasSpace = true;
  for (const char of query) {
    for (const unit of normalizeChar(char)) {
      const space = SPACE.test(unit);
      if (space && lastWasSpace) continue;
      out += space ? " " : unit;
      lastWasSpace = space;
    }
  }
  return out.trimEnd();
}

export function buildPageIndex(page: PageText): PageIndex {
  const parts: string[] = [];
  const itemOf: number[] = [];
  const startOf: number[] = [];
  const endOf: number[] = [];
  let lastWasSpace = true;
  const append = (normalized: string, item: number, start: number, end: number) => {
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
  page.items.forEach((str, item) => {
    let offset = 0;
    for (const char of str) {
      append(normalizeChar(char), item, offset, offset + char.length);
      offset += char.length;
    }
    if (page.endsLine[item]) append(" ", item, offset, offset);
  });
  return {
    text: parts.join(""),
    itemOf: Uint32Array.from(itemOf),
    startOf: Uint32Array.from(startOf),
    endOf: Uint32Array.from(endOf),
  };
}

/** Non-overlapping matches of an already normalized query, at most `limit`. */
export function findMatches(
  index: PageIndex,
  query: string,
  pageIndex: number,
  limit = 10_000,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  let from = 0;
  while (matches.length < limit) {
    const at = index.text.indexOf(query, from);
    if (at < 0) break;
    const last = at + query.length - 1;
    matches.push({
      pageIndex,
      start: { item: index.itemOf[at] ?? 0, offset: index.startOf[at] ?? 0 },
      end: { item: index.itemOf[last] ?? 0, offset: index.endOf[last] ?? 0 },
    });
    from = at + query.length;
  }
  return matches;
}
