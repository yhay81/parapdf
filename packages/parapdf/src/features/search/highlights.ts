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

/** Tracks which ranges each page contributed so a page can be cleared alone. */
export class SearchHighlights {
  readonly #pages = new Map<number, { all: Range[]; current: Range | null }>();

  /** Replace the highlights of one page. */
  setPage(
    pageIndex: number,
    elements: readonly HTMLElement[],
    matches: readonly SearchMatch[],
    current: SearchMatch | null,
  ): void {
    this.clearPage(pageIndex);
    const all = highlight(SEARCH_HIGHLIGHT, 0);
    const selected = highlight(CURRENT_HIGHLIGHT, 1);
    if (!all || !selected) return;
    const entry = { all: [] as Range[], current: null as Range | null };
    for (const match of matches) {
      const range = rangeForMatch(elements, match);
      if (!range) continue;
      if (match === current) {
        selected.add(range);
        entry.current = range;
      } else {
        all.add(range);
        entry.all.push(range);
      }
    }
    this.#pages.set(pageIndex, entry);
  }

  clearPage(pageIndex: number): void {
    const entry = this.#pages.get(pageIndex);
    if (!entry) return;
    const all = highlight(SEARCH_HIGHLIGHT, 0);
    for (const range of entry.all) all?.delete(range);
    if (entry.current) highlight(CURRENT_HIGHLIGHT, 1)?.delete(entry.current);
    this.#pages.delete(pageIndex);
  }

  clear(): void {
    for (const pageIndex of [...this.#pages.keys()]) this.clearPage(pageIndex);
  }
}
