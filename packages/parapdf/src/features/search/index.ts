"use client";

import type { DocumentSession } from "../../document/session.ts";
import { linked } from "../../view/signals.ts";
import { type ReadableStore, Store } from "../../view/state.ts";
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
   * Search the whole document. Results arrive progressively; the first match
   * at or after the current page is selected and scrolled into view. By
   * default case and diacritics are ignored and matches may be parts of words.
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
    if (signal.aborted) return;
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
    query: string,
    normalized: string,
    options: SearchOptions,
    signal: AbortSignal,
  ): Promise<void> => {
    const matches: SearchMatch[] = [];
    const startPage = viewer.store.get().currentPage;
    let current = -1;
    let pagesSearched = 0;
    let publishedAt = performance.now();
    const publish = (status: SearchState["status"]) => {
      store.set({ query, options, status, matches: [...matches], current, pagesSearched });
      refreshHighlights();
    };
    for (let page = 0; page < session.pageCount; page++) {
      const index = await pageIndex(session, page, options);
      if (signal.aborted) return;
      const found = findMatches(index, normalized, page, undefined, options);
      const select = current === -1 && page >= startPage && found.length > 0;
      if (select) current = matches.length;
      matches.push(...found);
      pagesSearched = page + 1;
      const now = performance.now();
      if (select || now - publishedAt > SEARCH_PUBLISH_INTERVAL) {
        publish("searching");
        const match = matches[current];
        if (select && match) background(scrollToMatch(match), viewer.workSignal);
        publishedAt = now;
        await yieldToMain();
        if (signal.aborted) return;
      }
    }
    if (current === -1 && matches.length > 0) {
      current = 0;
      const match = matches[0];
      if (match) background(scrollToMatch(match), viewer.workSignal);
    }
    publish("done");
  };

  const stop = () => {
    control?.abort();
    control = null;
    highlights.clear();
  };

  const detachExtension = viewer.extend({
    ready(_session, signal) {
      // Closing the document or detaching the viewport stops the search.
      signal.addEventListener(
        "abort",
        () => {
          stop();
          if (store.get().status === "searching") store.set(IDLE_SEARCH);
        },
        { once: true },
      );
    },
    closed() {
      store.set(IDLE_SEARCH);
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
      run(session, query, normalized, options, signal).catch((error: unknown) => {
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
      if (matches.length > 0) selectMatch((current - 1 + matches.length) % matches.length);
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

/** Each viewer's own search, which `usePdfSearch()` shows. */
const shared = new WeakMap<Viewer, Search>();

/**
 * `viewer`'s own search, which `usePdfSearch()` shows: attached at the
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
