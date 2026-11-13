"use client";

import { useMemo } from "react";
import { historyOf } from "../features/history.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStore } from "./context.ts";

export interface HistoryControls {
  canGoBack: boolean;
  back(): void;
  canGoForward: boolean;
  forward(): void;
}

/**
 * Back and forward stacks for link and outline jumps in `viewer`, or in the
 * viewer of the nearest `<PdfView>` or `<PdfDocument>`: its own history
 * (`historyOf()`), kept from the first use.
 */
export function useHistory(viewer?: Viewer): HistoryControls {
  const resolved = useOptionalViewer(viewer);
  const history = historyOf(resolved);
  const { canGoBack, canGoForward } = useStore(history.store);
  return useMemo(
    () => ({
      canGoBack,
      back: () => history.back(),
      canGoForward,
      forward: () => history.forward(),
    }),
    [history, canGoBack, canGoForward],
  );
}
