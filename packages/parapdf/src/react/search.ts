"use client";

import { useMemo } from "react";
import type { SearchOptions } from "../runtime/text-search.ts";
import type { SearchState } from "../view/viewer.ts";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfSearch extends SearchState {
  search(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
}

/** Whole-document search with progressive results and match navigation. */
export function usePdfSearch(): PdfSearch {
  const viewer = usePdfViewer();
  const state = usePdfState((viewerState) => viewerState.search);
  return useMemo(
    () => ({
      ...state,
      search: (query: string, options?: SearchOptions) => viewer.search(query, options),
      next: () => viewer.nextMatch(),
      previous: () => viewer.previousMatch(),
      clear: () => viewer.clearSearch(),
    }),
    [viewer, state],
  );
}
