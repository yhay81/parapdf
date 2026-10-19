"use client";

import { useMemo } from "react";
import type { DestinationRef, OutlineNode } from "../engine/types.ts";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfNavigation {
  canGoBack: boolean;
  back(): void;
  goToPage(pageIndex: number): void;
  goToDestination(dest: DestinationRef): Promise<boolean>;
}

/** Page and destination navigation with a back stack for link jumps. */
export function usePdfNavigation(): PdfNavigation {
  const viewer = usePdfViewer();
  const canGoBack = usePdfState((state) => state.canGoBack);
  return useMemo(
    () => ({
      canGoBack,
      back: () => viewer.back(),
      goToPage: (pageIndex: number) => viewer.goToPage(pageIndex),
      goToDestination: (dest: DestinationRef) => viewer.goToDestination(dest),
    }),
    [viewer, canGoBack],
  );
}

/** The document outline; null while it loads, empty when the PDF has none. */
export function usePdfOutline(): readonly OutlineNode[] | null {
  return usePdfState((state) => state.outline);
}
