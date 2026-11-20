"use client";

import type { SearchMatch } from "./text-search.ts";

/**
 * Search results are painted with the CSS Custom Highlight API: ranges over
 * the text layer's own text nodes, styled by `::highlight()`. Nothing in the
 * text layer is split or wrapped, so selection and screen readers see the
 * same DOM with or without results.
 */
export const SEARCH_HIGHLIGHT = "parapdf-search";
export const CURRENT_HIGHLIGHT = "parapdf-search-current";

function highlight(name: string, priority: number): Highlight | undefined {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
    return undefined;
  }
  let entry = CSS.highlights.get(name);
  if (!entry) {
    entry = new Highlight();
    entry.priority = priority;
    CSS.highlights.set(name, entry);
  }
  return entry;
}

/** A DOM range for a match, or null when its items have no text nodes. */
export function rangeForMatch(elements: readonly HTMLElement[], match: SearchMatch): Range | null {
  const startNode = elements[match.start.item]?.firstChild;
  const endNode = elements[match.end.item]?.firstChild;
  if (!(startNode instanceof Text) || !(endNode instanceof Text)) return null;
  const range = new Range();
  range.setStart(startNode, Math.min(match.start.offset, startNode.length));
  range.setEnd(endNode, Math.min(match.end.offset, endNode.length));
  return range;
}

interface PageHighlightEntry {
  elements: readonly HTMLElement[];
  firstMatch: SearchMatch;
  /** Position in the published results, which can move when search wraps around. */
  first: number;
  ranges: (Range | null)[];
  current: Range | null;
}

/** Tracks which ranges each page contributed so a page can be cleared alone. */
export class SearchHighlights {
  readonly #pages = new Map<number, PageHighlightEntry>();

  /** Replace the highlights of one page. */
  setPage(
    pageIndex: number,
    elements: readonly HTMLElement[],
    matches: readonly SearchMatch[],
    first: number,
    current: number,
  ): void {
    const firstMatch = matches[first];
    if (!firstMatch || firstMatch.pageIndex !== pageIndex) {
      this.clearPage(pageIndex);
      return;
    }

    const existing = this.#pages.get(pageIndex);
    // A search publishes each page's complete result group once. Later
    // progress can shift its index in the document-order results.
    if (existing && existing.elements === elements && existing.firstMatch === firstMatch) {
      existing.first = first;
    } else {
      this.clearPage(pageIndex);
      const all = highlight(SEARCH_HIGHLIGHT, 0);
      if (!all) return;
      const ranges: (Range | null)[] = [];
      for (let i = first; i < matches.length; i++) {
        const match = matches[i];
        if (match?.pageIndex !== pageIndex) break;
        const range = rangeForMatch(elements, match);
        ranges.push(range);
        if (range) all.add(range);
      }
      this.#pages.set(pageIndex, { elements, firstMatch, first, ranges, current: null });
    }
    this.select(pageIndex, current);
  }

  /** Move the active range on one mounted page, including off that page. */
  select(pageIndex: number, index: number): void {
    const entry = this.#pages.get(pageIndex);
    if (!entry) return;
    const range = entry.ranges[index - entry.first] ?? null;
    if (entry.current === range) return;
    const all = highlight(SEARCH_HIGHLIGHT, 0);
    const selected = highlight(CURRENT_HIGHLIGHT, 1);
    if (entry.current) {
      selected?.delete(entry.current);
      all?.add(entry.current);
    }
    if (range) {
      all?.delete(range);
      selected?.add(range);
    }
    entry.current = range;
  }

  clearPage(pageIndex: number): void {
    const entry = this.#pages.get(pageIndex);
    if (!entry) return;
    const all = highlight(SEARCH_HIGHLIGHT, 0);
    for (const range of entry.ranges) {
      if (range && range !== entry.current) all?.delete(range);
    }
    if (entry.current) highlight(CURRENT_HIGHLIGHT, 1)?.delete(entry.current);
    this.#pages.delete(pageIndex);
  }

  clear(): void {
    for (const pageIndex of [...this.#pages.keys()]) this.clearPage(pageIndex);
  }
}
