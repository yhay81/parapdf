"use client";

import { useMemo } from "react";
import type { SearchState } from "../runtime/viewer.ts";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfSearch extends SearchState {
  search(query: string): void;
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
      search: (query: string) => viewer.search(query),
      next: () => viewer.nextMatch(),
      previous: () => viewer.previousMatch(),
      clear: () => viewer.clearSearch(),
    }),
    [viewer, state],
  );
}
