"use client";

import { useMemo } from "react";
import type { OutlineNode } from "../document/session.ts";
import { historyOf } from "../features/history.ts";
import type { Destination } from "../pdfjs/destinations.ts";
import { usePdfState, usePdfViewer } from "./context.ts";
import { useStore } from "./features.ts";

export interface PdfNavigation {
  canGoBack: boolean;
  back(): void;
  canGoForward: boolean;
  forward(): void;
  goToPage(pageIndex: number): void;
  goToDestination(dest: Destination | null): Promise<boolean>;
}

/**
 * Page and destination navigation, with back and forward stacks for the
 * viewer's link and outline jumps: its own history (`historyOf()`), kept
 * from the first use.
 */
export function usePdfNavigation(): PdfNavigation {
  const viewer = usePdfViewer();
  const history = historyOf(viewer);
  const { canGoBack, canGoForward } = useStore(history.store);
  return useMemo(
    () => ({
      canGoBack,
      back: () => history.back(),
      canGoForward,
      forward: () => history.forward(),
      goToPage: (pageIndex: number) => viewer.goToPage(pageIndex),
      goToDestination: (dest: Destination | null) => viewer.goToDestination(dest),
    }),
    [viewer, history, canGoBack, canGoForward],
  );
}

/** The document outline; null while it loads, empty when the PDF has none. */
export function usePdfOutline(): readonly OutlineNode[] | null {
  return usePdfState((state) => state.outline);
}
