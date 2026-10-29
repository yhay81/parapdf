import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CURRENT_HIGHLIGHT,
  rangeForMatch,
  SEARCH_HIGHLIGHT,
  SearchHighlights,
} from "../src/features/search/highlights.ts";
import type { SearchMatch } from "../src/features/search/text-search.ts";

/** The text node of a text layer's span. */
class FakeText {
  readonly data: string;
  constructor(data: string) {
    this.data = data;
  }
  get length(): number {
    return this.data.length;
  }
}

/** A DOM range: where it starts and ends. */
class FakeRange {
  start: [FakeText, number] | null = null;
  end: [FakeText, number] | null = null;
  setStart(node: FakeText, offset: number): void {
    this.start = [node, offset];
  }
  setEnd(node: FakeText, offset: number): void {
    this.end = [node, offset];
  }
}

/** A custom highlight: ranges painted at a priority. */
class FakeHighlight extends Set<FakeRange> {
  priority = 0;
}

/** A text layer's spans, a text node each but the empty ones, as pdf.js builds them. */
const spans = (...texts: string[]) =>
  texts.map((text) => ({
    firstChild: text ? new FakeText(text) : null,
  })) as unknown as HTMLElement[];

const match = (start: [number, number], end: [number, number], pageIndex = 0): SearchMatch => ({
  pageIndex,
  start: { item: start[0], offset: start[1] },
  end: { item: end[0], offset: end[1] },
});

/** Where a range starts and ends: text and offset. */
const ends = (range: unknown) => {
  const { start, end } = range as FakeRange;
  return [start?.[0].data, start?.[1], end?.[0].data, end?.[1]];
};

describe("search highlights", () => {
  const names = ["Text", "Range", "Highlight", "CSS"];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  let registry: Map<string, FakeHighlight>;

  const install = (values: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
  };

  beforeEach(() => {
    for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    registry = new Map();
    install({
      Text: FakeText,
      Range: FakeRange,
      Highlight: FakeHighlight,
      CSS: { highlights: registry },
    });
  });

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  it("cover a match over its items' text nodes, offsets kept within them", () => {
    const elements = spans("a rose", "", "tulip");
    assert.deepEqual(ends(rangeForMatch(elements, match([0, 2], [0, 6]))), [
      "a rose",
      2,
      "a rose",
      6,
    ]);
    assert.deepEqual(ends(rangeForMatch(elements, match([0, 2], [2, 9]))), [
      "a rose",
      2,
      "tulip",
      5,
    ]);
    // An item without a text node, or past the text layer's.
    assert.equal(rangeForMatch(elements, match([1, 0], [2, 1])), null);
    assert.equal(rangeForMatch(elements, match([2, 0], [3, 1])), null);
  });

  it("paint the selected match apart, and replace or clear a page's alone", () => {
    const highlights = new SearchHighlights();
    const first = [match([0, 0], [0, 1]), match([0, 2], [0, 3]), match([1, 0], [1, 0])];
    highlights.setPage(0, spans("abc", ""), first, first[1] ?? null);
    highlights.setPage(1, spans("xyz"), [match([0, 0], [0, 2], 1)], null);
    const all = registry.get(SEARCH_HIGHLIGHT);
    const current = registry.get(CURRENT_HIGHLIGHT);
    assert.deepEqual([all?.priority, current?.priority], [0, 1]);
    assert.deepEqual([...(all ?? [])].map(ends), [
      ["abc", 0, "abc", 1],
      ["xyz", 0, "xyz", 2],
    ]);
    assert.deepEqual([...(current ?? [])].map(ends), [["abc", 2, "abc", 3]]);
    // A page's matches replace its own, and the selected one leaves with them.
    highlights.setPage(0, spans("abc"), first.slice(0, 1), null);
    assert.deepEqual([all?.size, current?.size], [2, 0]);
    highlights.clearPage(1);
    assert.deepEqual([...(all ?? [])].map(ends), [["abc", 0, "abc", 1]]);
    highlights.clear();
    assert.equal(all?.size, 0);
  });

  it("do nothing where the browser has no custom highlights", () => {
    install({ CSS: {} });
    const highlights = new SearchHighlights();
    highlights.setPage(0, spans("abc"), [match([0, 0], [0, 1])], null);
    highlights.clearPage(0);
    highlights.clear();
    assert.equal(registry.size, 0);
  });
});
