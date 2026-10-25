"use client";

import { useMemo } from "react";
import { type SearchState, searchOf } from "../features/search/index.ts";
import type { SearchOptions } from "../features/search/text-search.ts";
import { usePdfViewer } from "./context.ts";
import { useStore } from "./features.ts";

export interface PdfSearch extends SearchState {
  search(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
}

/**
 * Whole-document search with progressive results and match navigation: the
 * viewer's own search (`searchOf()`), shared by the components that use it.
 */
export function usePdfSearch(): PdfSearch {
  const search = searchOf(usePdfViewer());
  const state = useStore(search.store);
  return useMemo(
    () => ({
      ...state,
      search: (query: string, options?: SearchOptions) => search.search(query, options),
      next: () => search.next(),
      previous: () => search.previous(),
      clear: () => search.clear(),
    }),
    [search, state],
  );
}
