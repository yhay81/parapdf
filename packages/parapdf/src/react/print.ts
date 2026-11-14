"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPrintController,
  IDLE_PRINT,
  type PrintController,
  type PrintOptions,
  type PrintProgress,
  type PrintState,
  print as printViewer,
} from "../features/print/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

export type { PrintProgress } from "../features/print/index.ts";

export interface PrintControls {
  /**
   * Prepare and print the document through the browser's print dialog.
   * Calling `cancel()` stops page preparation cleanly without rejecting.
   */
  print(options?: PrintOptions): Promise<void>;
  /** True while pages are being prepared or printed. */
  printing: boolean;
  /** Pages drawn so far while `printing` is true; null when idle. */
  progress: PrintProgress | null;
  /** Abort page preparation in progress. */
  cancel(): void;
}

/**
 * Print the document of `viewer`, or of the nearest `<PdfView>` or
 * `<PdfDocument>`, with reactive `printing` and `progress` state and a
 * `cancel()` action that stops page preparation cleanly.
 */
export function usePrint(viewer?: Viewer): PrintControls {
  const resolved = useOptionalViewer(viewer);
  const [state, setState] = useState<PrintState>(IDLE_PRINT);
  const controllerRef = useRef<PrintController | null>(null);

  useEffect(() => {
    const controller = createPrintController(resolved, setState);
    controllerRef.current = controller;
    // Replacing or reconnecting the controller starts with no active job.
    setState(IDLE_PRINT);
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [resolved]);

  const print = useCallback(
    async (options?: PrintOptions): Promise<void> => {
      if (controllerRef.current) {
        await controllerRef.current.print(options);
        return;
      }
      await printViewer(resolved, options);
    },
    [resolved],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);

  return useMemo(
    () => ({
      print,
      printing: state.printing,
      progress: state.progress,
      cancel,
    }),
    [print, state.printing, state.progress, cancel],
  );
}
