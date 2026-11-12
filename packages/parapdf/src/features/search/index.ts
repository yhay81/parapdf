"use client";

import type { DocumentSession } from "../../document/session.ts";
import { type ReadableStore, Store } from "../../document/store.ts";
import { linked } from "../../view/signals.ts";
import type { Viewer } from "../../view/viewer.ts";
import { SearchHighlights } from "./highlights.ts";
import {
  buildPageIndex,
  findMatches,
  normalizeQuery,
  type PageIndex,
  type SearchMatch,
  type SearchOptions,
} from "./text-search.ts";

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

/** Whole-document search in one viewer, with its matches highlighted on the mounted pages. */
export interface Search {
  readonly store: ReadableStore<SearchState>;
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
  /** Stop searching and take the highlights down; the viewer hears nothing more of it. */
  detach(): void;
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

/**
 * Each session's page indexes, by the options that shape them
 * ("case-sensitive diacritics"), shared by the searches of its viewers.
 */
const indexes = new WeakMap<DocumentSession, Map<string, Map<number, Promise<PageIndex>>>>();

/** Page `pageIndex`'s index for `options`, read once per session unless the read fails. */
export function pageIndex(
  session: DocumentSession,
  pageIndex: number,
  options: SearchOptions,
): Promise<PageIndex> {
  const key = `${Boolean(options.caseSensitive)} ${Boolean(options.matchDiacritics)}`;
  let byOptions = indexes.get(session);
  if (!byOptions) {
    byOptions = new Map();
    indexes.set(session, byOptions);
  }
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

/** Search `viewer`'s document; `detach()` undoes it. */
export function attachSearch(viewer: Viewer): Search {
  const store = new Store<SearchState>(IDLE_SEARCH);
  const highlights = new SearchHighlights();
  /** Stops the search in progress. */
  let control: AbortController | null = null;

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
    const pageMatches = matches.filter((match) => match.pageIndex === pageIndex);
    highlights.setPage(pageIndex, handle.elements, pageMatches, matches[current] ?? null);
  };

  const refreshHighlights = () => {
    for (const pageIndex of viewer.textLayers.keys()) highlightPage(pageIndex);
  };

  /** Scroll so a match sits in the upper third of the viewport. */
  const scrollToMatch = async (match: SearchMatch): Promise<void> => {
    const session = viewer.session;
    const signal = viewer.workSignal;
    if (!session || !signal) return;
    const text = await session.text(match.pageIndex);
    const { matches, current } = store.get();
    if (signal.aborted || matches[current] !== match) return;
    const at = match.start.item * 4;
    viewer.revealRect(match.pageIndex, {
      x: text.boxes[at] ?? 0,
      y: text.boxes[at + 1] ?? 0,
      width: text.boxes[at + 2] ?? 0,
      height: text.boxes[at + 3] ?? 0,
    });
  };

  const selectMatch = (index: number) => {
    const search = store.get();
    const match = search.matches[index];
    if (!match) return;
    store.set({ current: index });
    refreshHighlights();
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

  const stop = () => {
    control?.abort();
    control = null;
    highlights.clear();
  };

  const detachExtension = viewer.extend({
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
      if (!kept) store.set(IDLE_SEARCH);
    },
    textLayer(pageIndex, handle) {
      if (handle) highlightPage(pageIndex);
      else highlights.clearPage(pageIndex);
    },
  });

  return {
    store,
    search(query, options = {}) {
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
    },
    next() {
      const { matches, current } = store.get();
      if (matches.length > 0) selectMatch((current + 1) % matches.length);
    },
    previous() {
      const { matches, current } = store.get();
      // From the first match or none, the last.
      if (matches.length > 0) selectMatch(current > 0 ? current - 1 : matches.length - 1);
    },
    clear() {
      stop();
      store.set(IDLE_SEARCH);
    },
    detach() {
      stop();
      detachExtension();
      store.set(IDLE_SEARCH);
    },
  };
}

/** Each viewer's own search, which `useSearch()` shows. */
const shared = new WeakMap<Viewer, Search>();

/**
 * `viewer`'s own search, which `useSearch()` shows: attached at the
 * first call, and kept until its `detach()`.
 */
export function searchOf(viewer: Viewer): Search {
  let search = shared.get(viewer);
  if (!search) {
    const attached = attachSearch(viewer);
    const own: Search = {
      ...attached,
      detach() {
        attached.detach();
        if (shared.get(viewer) === own) shared.delete(viewer);
      },
    };
    shared.set(viewer, own);
    search = own;
  }
  return search;
}
