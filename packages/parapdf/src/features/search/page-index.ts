import type { DocumentSession } from "../../document/session.ts";
import { createSlotKey } from "../../document/store.ts";
import type { PageText } from "../../pdfjs/text.ts";
import type { PdfRect } from "../selection.ts";
import {
  buildPageIndex,
  type PageIndex,
  type SearchMatch,
  type SearchOptions,
} from "./text-search.ts";

/**
 * Each session's page indexes, by the options that shape them
 * ("case-sensitive diacritics"), shared by `useSearch()` and `findText()`.
 */
const SEARCH_INDEX_SLOT =
  createSlotKey<Map<string, Map<number, Promise<PageIndex>>>>("parapdf.searchIndexes");

/** Page `pageIndex`'s index for `options`, read once per session unless the read fails. */
export function pageIndex(
  session: DocumentSession,
  pageIndex: number,
  options: SearchOptions,
): Promise<PageIndex> {
  const key = `${Boolean(options.caseSensitive)} ${Boolean(options.matchDiacritics)}`;
  const byOptions = session.slot(SEARCH_INDEX_SLOT, () => new Map());
  let pages = byOptions.get(key);
  if (!pages) {
    pages = new Map();
    byOptions.set(key, pages);
  }
  const read = pages;
  let index = read.get(pageIndex);
  if (!index) {
    index = session
      .text(pageIndex)
      .then((text) => buildPageIndex(text, options))
      .catch((error: unknown) => {
        read.delete(pageIndex);
        throw error;
      });
    read.set(pageIndex, index);
  }
  return index;
}

const SPACE = /\s/u;
const MARK = /\p{M}/u;

const isSpaceCodePoint = (cp: number, unit: string): boolean =>
  cp <= 0x7f ? cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) : SPACE.test(unit);

function trimSliceOffsets(str: string, rawFrom: number, rawTo: number): [number, number] {
  let from = Math.max(0, Math.min(rawFrom, str.length));
  let to = Math.max(from, Math.min(rawTo, str.length));
  while (from < to) {
    const cp = str.codePointAt(from) ?? 0;
    const step = cp > 0xffff ? 2 : 1;
    if (!isSpaceCodePoint(cp, str.slice(from, from + step))) break;
    from += step;
  }
  while (to > from) {
    const low = str.charCodeAt(to - 1);
    const step = low >= 0xdc00 && low <= 0xdfff && to - 2 >= from ? 2 : 1;
    const sub = str.slice(to - step, to);
    if (!isSpaceCodePoint(sub.codePointAt(0) ?? 0, sub)) break;
    to -= step;
  }
  return [from, to];
}

function codePointWeight(cp: number, char: string): number {
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0xfeff ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp > 0x036f && MARK.test(char))
  ) {
    return 0;
  }
  // East Asian Wide and Fullwidth blocks occupy roughly twice an ASCII advance.
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function sliceRange(str: string, start: number, end: number): [number, number] {
  if (start <= 0 && end >= str.length) return [0, 1];
  let beforeWeight = 0;
  let matchWeight = 0;
  let totalWeight = 0;
  let offset = 0;
  for (const char of str) {
    const next = offset + char.length;
    const weight = codePointWeight(char.codePointAt(0) ?? 0, char);
    totalWeight += weight;
    if (next <= start) {
      beforeWeight += weight;
    } else if (offset < end) {
      matchWeight += weight;
    }
    offset = next;
  }
  if (totalWeight <= 0) {
    return str.length > 0 ? [start / str.length, end / str.length] : [0, 1];
  }
  return [beforeWeight / totalWeight, (beforeWeight + matchWeight) / totalWeight];
}

function sliceItemBox(page: PageText, item: number, t0: number, t1: number): PdfRect {
  const at = item * 4;
  const x = page.boxes[at] ?? 0;
  const y = page.boxes[at + 1] ?? 0;
  const width = page.boxes[at + 2] ?? 0;
  const height = page.boxes[at + 3] ?? 0;
  if (t0 <= 0 && t1 >= 1) return { x, y, width, height };
  const span = Math.max(0, t1 - t0);
  switch (page.directions?.[item] ?? 0) {
    case 1:
      return { x: x + width * (1 - t1), y, width: width * span, height };
    case 2:
      return { x, y: y + height * t0, width, height: height * span };
    case 3:
      return { x, y: y + height * (1 - t1), width, height: height * span };
    default:
      return { x: x + width * t0, y, width: width * span, height };
  }
}

function canCoalesce(prev: PdfRect, prevDir: number, next: PdfRect, nextDir: number): boolean {
  if (prevDir !== nextDir) return false;
  if (prevDir <= 1) {
    const thickness = Math.max(prev.height, next.height);
    const prevMidY = prev.y + prev.height / 2;
    const nextMidY = next.y + next.height / 2;
    if (Math.abs(prevMidY - nextMidY) > 0.5 * thickness) return false;
    const gap = prevDir === 0 ? next.x - (prev.x + prev.width) : prev.x - (next.x + next.width);
    return gap >= -0.5 * thickness && gap <= 1.5 * thickness;
  }
  const thickness = Math.max(prev.width, next.width);
  const prevMidX = prev.x + prev.width / 2;
  const nextMidX = next.x + next.width / 2;
  if (Math.abs(prevMidX - nextMidX) > 0.5 * thickness) return false;
  const gap = prevDir === 2 ? next.y - (prev.y + prev.height) : prev.y - (next.y + next.height);
  return gap >= -0.5 * thickness && gap <= 1.5 * thickness;
}

/**
 * The unturned PDF-point rectangles and union bounding box covering `match` on
 * `page`, sliced proportionally within partial first and last items and merged
 * along contiguous runs on the same line.
 */
export function matchRects(
  page: PageText,
  match: SearchMatch,
): { rects: PdfRect[]; bounds: PdfRect } {
  const rects: PdfRect[] = [];
  let lastDir = -1;
  const firstItem = Math.max(0, match.start.item);
  const lastItem = Math.min(page.items.length - 1, match.end.item);

  for (let item = firstItem; item <= lastItem; item++) {
    const str = page.items[item] ?? "";
    const rawFrom = item === match.start.item ? match.start.offset : 0;
    const rawTo = item === match.end.item ? match.end.offset : str.length;
    const [from, to] = trimSliceOffsets(str, rawFrom, rawTo);
    if (from >= to) continue;
    const [t0, t1] = sliceRange(str, from, to);
    const rect = sliceItemBox(page, item, t0, t1);
    const dir = page.directions?.[item] ?? 0;
    const prev = rects.at(-1);
    if (prev && canCoalesce(prev, lastDir, rect, dir)) {
      const right = Math.max(prev.x + prev.width, rect.x + rect.width);
      const bottom = Math.max(prev.y + prev.height, rect.y + rect.height);
      const minX = Math.min(prev.x, rect.x);
      const minY = Math.min(prev.y, rect.y);
      prev.x = minX;
      prev.y = minY;
      prev.width = right - minX;
      prev.height = bottom - minY;
    } else {
      rects.push(rect);
      lastDir = dir;
    }
  }

  if (rects.length === 0) {
    if (match.start.item >= 0 && match.start.item < page.items.length) {
      const str = page.items[match.start.item] ?? "";
      const rawTo = match.start.item === match.end.item ? match.end.offset : str.length;
      const [t0, t1] = sliceRange(
        str,
        Math.max(0, Math.min(match.start.offset, str.length)),
        Math.max(0, Math.min(rawTo, str.length)),
      );
      const fallback = sliceItemBox(page, match.start.item, t0, t1);
      return { rects: [fallback], bounds: { ...fallback } };
    }
    return { rects: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
  }

  const first = rects[0] as PdfRect;
  if (rects.length === 1) {
    return { rects, bounds: { ...first } };
  }
  let minX = first.x;
  let minY = first.y;
  let maxRight = first.x + first.width;
  let maxBottom = first.y + first.height;
  for (let i = 1; i < rects.length; i++) {
    const rect = rects[i] as PdfRect;
    if (rect.x < minX) minX = rect.x;
    if (rect.y < minY) minY = rect.y;
    if (rect.x + rect.width > maxRight) maxRight = rect.x + rect.width;
    if (rect.y + rect.height > maxBottom) maxBottom = rect.y + rect.height;
  }
  return {
    rects,
    bounds: { x: minX, y: minY, width: maxRight - minX, height: maxBottom - minY },
  };
}
