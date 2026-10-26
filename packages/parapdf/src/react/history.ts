"use client";

import { useMemo } from "react";
import { historyOf } from "../features/history.ts";
import type { Viewer } from "../view/viewer.ts";
import { useStore } from "./features.ts";

export interface HistoryControls {
  canGoBack: boolean;
  back(): void;
  canGoForward: boolean;
  forward(): void;
}

/**
 * Back and forward stacks for `viewer`'s link and outline jumps: its own
 * history (`historyOf()`), kept from the first use.
 */
export function useHistory(viewer: Viewer): HistoryControls {
  const history = historyOf(viewer);
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
