"use client";

import { useMemo } from "react";
import type { OutlineNode } from "../document/session.ts";
import type { Destination } from "../pdfjs/destinations.ts";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfNavigation {
  canGoBack: boolean;
  back(): void;
  canGoForward: boolean;
  forward(): void;
  goToPage(pageIndex: number): void;
  goToDestination(dest: Destination | null): Promise<boolean>;
}

/** Page and destination navigation with back and forward stacks for link jumps. */
export function usePdfNavigation(): PdfNavigation {
  const viewer = usePdfViewer();
  const canGoBack = usePdfState((state) => state.canGoBack);
  const canGoForward = usePdfState((state) => state.canGoForward);
  return useMemo(
    () => ({
      canGoBack,
      back: () => viewer.back(),
      canGoForward,
      forward: () => viewer.forward(),
      goToPage: (pageIndex: number) => viewer.goToPage(pageIndex),
      goToDestination: (dest: Destination | null) => viewer.goToDestination(dest),
    }),
    [viewer, canGoBack, canGoForward],
  );
}

/** The document outline; null while it loads, empty when the PDF has none. */
export function usePdfOutline(): readonly OutlineNode[] | null {
  return usePdfState((state) => state.outline);
}
