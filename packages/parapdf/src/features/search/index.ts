"use client";

import type { DocumentSession } from "../../document/session.ts";
import { createSlotKey, type ReadableStore, Store } from "../../document/store.ts";
import { linked } from "../../view/signals.ts";
import type { ViewerController } from "../../view/viewer.ts";
import { SearchHighlights } from "./highlights.ts";
import { matchRects, pageIndex } from "./page-index.ts";
import {
  findMatches,
  normalizeQuery,
  type SearchMatch,
  type SearchOptions,
} from "./text-search.ts";

export { pageIndex } from "./page-index.ts";

export interface SearchState {
  query: string;
  /** How the query compares with the text. */
  options: SearchOptions;
  status: "idle" | "searching" | "done";
  /** Matches in page order. */
  matches: readonly SearchMatch[];
  /** Index into `matches` of the selected result, -1 when none. */
  current: number;
  pagesSearched: number;
}

export interface SearchControls extends SearchState {
  /**
   * Search from the current page, wrapping at the end. The first match is
   * selected and scrolled into view. Each update lists matches in document
   * order and preserves the selection. By default case and diacritics are
   * ignored and matches may be parts of words.
   */
  search(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
}

export const IDLE_SEARCH: SearchState = {
  query: "",
  options: {},
  status: "idle",
  matches: [],
  current: -1,
  pagesSearched: 0,
};

/** Search publishes partial results at most this often. */
const SEARCH_PUBLISH_INTERVAL = 100;

const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

/** Each viewer's own search store, which `useSearch()` shows. */
const SEARCH_SLOT = createSlotKey<ReadableStore<SearchControls>>("parapdf.search");

function firstMatchOnPage(matches: readonly SearchMatch[], pageIndex: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((matches[mid]?.pageIndex ?? 0) < pageIndex) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** `viewer`'s own search store, attached at first use for the lifetime of `viewer`. */
export function searchOf(viewer: ViewerController): ReadableStore<SearchControls> {
  return viewer.slot(SEARCH_SLOT, () => createSearchStore(viewer));
}

function createSearchStore(viewer: ViewerController): ReadableStore<SearchControls> {
  const highlights = new SearchHighlights();
  /** Stops the search in progress. */
  let control: AbortController | null = null;

  const stop = () => {
    control?.abort();
    control = null;
    highlights.clear();
  };

  const search = (query: string, options: SearchOptions = {}) => {
    // A new search stops the one in progress.
    stop();
    const normalized = normalizeQuery(query, options);
    const session = viewer.session;
    const work = viewer.workSignal;
    if (!normalized || !session || !work || work.aborted) {
      store.set({ ...IDLE_SEARCH, query, options });
      return;
    }
    // Clearing the search stops it, and so does closing the document.
    const searching = linked(work);
    control = searching;
    const { signal } = searching;
    store.set({
      query,
      options,
      status: "searching",
      matches: [],
      current: -1,
      pagesSearched: 0,
    });
    run(session, normalized, options, signal).catch((error: unknown) => {
      if (signal.aborted) return;
      console.error("search failed", error);
      store.set({ status: "done" });
    });
  };

  const next = () => {
    const { matches, current } = store.get();
    if (matches.length > 0) selectMatch((current + 1) % matches.length);
  };

  const previous = () => {
    const { matches, current } = store.get();
    // From the first match or none, the last.
    if (matches.length > 0) selectMatch(current > 0 ? current - 1 : matches.length - 1);
  };

  const clear = () => {
    stop();
    store.set(IDLE_SEARCH);
  };

  const store = new Store<SearchControls>({
    ...IDLE_SEARCH,
    search,
    next,
    previous,
    clear,
  });

  /** Scrolling to a match may outlive its document: it then fails quietly. */
  const background = (work: Promise<unknown>, signal: AbortSignal | null) => {
    work.catch((error: unknown) => {
      if (signal && !signal.aborted) console.error("scrolling to a match failed", error);
    });
  };

  const highlightPage = (pageIndex: number) => {
    const handle = viewer.textLayers.get(pageIndex);
    const { matches, current } = store.get();
    if (!handle || matches.length === 0) {
      highlights.clearPage(pageIndex);
      return;
    }
    highlights.setPage(
      pageIndex,
      handle.elements,
      matches,
      firstMatchOnPage(matches, pageIndex),
      current,
    );
  };

  const refreshHighlights = () => {
    for (const pageIndex of viewer.textLayers.keys()) highlightPage(pageIndex);
  };

  /** Scroll so a match sits in the upper third of the viewport. */
  const scrollToMatch = async (match: SearchMatch): Promise<void> => {
    const session = viewer.session;
    const signal = viewer.workSignal;
    if (!session || !signal || signal.aborted) return;
    const text = await session.text(match.pageIndex);
    const { matches, current } = store.get();
    if (signal.aborted || matches[current] !== match) return;
    viewer.revealRect(match.pageIndex, matchRects(text, match).bounds);
  };

  const selectMatch = (index: number) => {
    const search = store.get();
    const match = search.matches[index];
    if (!match) return;
    const previous = search.matches[search.current];
    if (previous && previous.pageIndex !== match.pageIndex)
      highlights.select(previous.pageIndex, -1);
    highlights.select(match.pageIndex, index);
    store.set({ current: index });
    background(scrollToMatch(match), viewer.workSignal);
  };

  const run = async (
    session: DocumentSession,
    normalized: string,
    options: SearchOptions,
    signal: AbortSignal,
  ): Promise<void> => {
    const startPage = viewer.store.get().currentPage;
    const fromStart: SearchMatch[] = [];
    const beforeStart: SearchMatch[] = [];
    let publishedAt = performance.now();
    const publish = (status: SearchState["status"], pagesSearched: number) => {
      const previous = store.get();
      const matches = beforeStart.concat(fromStart);
      const selected = previous.matches[previous.current] ?? matches[0];
      const current = selected ? matches.indexOf(selected) : -1;
      store.set({ status, matches, current, pagesSearched });
      refreshHighlights();
      if (previous.current === -1 && selected) background(scrollToMatch(selected), signal);
    };
    for (let offset = 0; offset < session.pageCount; offset++) {
      const page = (startPage + offset) % session.pageCount;
      const index = await pageIndex(session, page, options);
      if (signal.aborted) return;
      const found = findMatches(index, normalized, page, undefined, options);
      const group = page < startPage ? beforeStart : fromStart;
      for (const match of found) group.push(match);
      const now = performance.now();
      if (
        (found.length > 0 && store.get().current === -1) ||
        now - publishedAt > SEARCH_PUBLISH_INTERVAL
      ) {
        publish("searching", offset + 1);
        publishedAt = now;
        await yieldToMain();
        if (signal.aborted) return;
      }
    }
    publish("done", session.pageCount);
  };

  viewer.extend({
    ready(_session, signal) {
      // Letting go of the document or detaching the viewport stops the search.
      signal.addEventListener(
        "abort",
        () => {
          stop();
          if (store.get().status === "searching") store.set(IDLE_SEARCH);
        },
        { once: true },
      );
    },
    closed(kept) {
      // A finished search holds for the session: its matches are
      // highlighted again on the pages the viewer shows next.
      if (!kept) {
        stop();
        store.set(IDLE_SEARCH);
      }
    },
    textLayer(pageIndex, handle) {
      if (handle) highlightPage(pageIndex);
      else highlights.clearPage(pageIndex);
    },
  });

  return store;
}
