"use client";

import { useMemo } from "react";
import { type SearchState, searchOf } from "../features/search/index.ts";
import type { SearchOptions } from "../features/search/text-search.ts";
import type { Viewer } from "../view/viewer.ts";
import { useStore } from "./context.ts";

export interface SearchControls extends SearchState {
  search(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
}

/**
 * Whole-document search in `viewer` with progressive results and match
 * navigation: the viewer's own search (`searchOf()`), shared by the
 * components that use it.
 */
export function useSearch(viewer: Viewer): SearchControls {
  const search = searchOf(viewer);
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
