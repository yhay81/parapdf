"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { permits } from "../features/permissions.ts";
import { type PrintOptions, print as printViewer } from "../features/print/index.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";

export interface PrintProgress {
  done: number;
  total: number;
}

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

export interface PrintState {
  readonly printing: boolean;
  readonly progress: PrintProgress | null;
}

interface PrintJob {
  readonly controller: AbortController;
  cancelled: boolean;
}

const IDLE: PrintState = { printing: false, progress: null };

export interface PrintController {
  print(options?: PrintOptions): Promise<void>;
  cancel(): void;
  dispose(): void;
}

export function createPrintController(
  viewer: Viewer,
  onChange: (state: PrintState) => void,
): PrintController {
  let activeJob: PrintJob | null = null;
  let disposed = false;

  const publish = (next: PrintState) => {
    if (!disposed) onChange(next);
  };

  const cancel = () => {
    const job = activeJob;
    if (!job) return;
    job.cancelled = true;
    activeJob = null;
    job.controller.abort();
    publish(IDLE);
  };

  return {
    cancel,
    dispose() {
      disposed = true;
      const job = activeJob;
      if (job) {
        job.cancelled = true;
        activeJob = null;
        job.controller.abort();
      }
    },
    async print(options?: PrintOptions): Promise<void> {
      const doc = viewer.session;
      if (!doc || !viewer.workSignal || !permits(viewer, "print")) {
        await printViewer(viewer, options);
        return;
      }
      if (options?.signal?.aborted) {
        options.signal.throwIfAborted();
      }
      if (activeJob) {
        activeJob.cancelled = true;
        activeJob.controller.abort();
      }
      const job: PrintJob = { controller: new AbortController(), cancelled: false };
      activeJob = job;
      const onCallerAbort = () => job.controller.abort(options?.signal?.reason);
      options?.signal?.addEventListener("abort", onCallerAbort, { once: true });
      publish({ printing: true, progress: { done: 0, total: doc.pageCount } });
      try {
        await printViewer(viewer, {
          ...options,
          signal: job.controller.signal,
          onProgress(done, total) {
            if (activeJob === job) {
              publish({ printing: true, progress: { done: done, total } });
            }
            options?.onProgress?.(done, total);
          },
        });
      } catch (error) {
        if (job.cancelled && !options?.signal?.aborted) return;
        throw error;
      } finally {
        options?.signal?.removeEventListener("abort", onCallerAbort);
        if (activeJob === job) {
          activeJob = null;
          publish(IDLE);
        }
      }
    },
  };
}

/**
 * Print the document of `viewer`, or of the nearest `<PdfView>` or
 * `<PdfDocument>`, with reactive `printing` and `progress` state and a
 * `cancel()` action that stops page preparation cleanly.
 */
export function usePrint(viewer?: Viewer): PrintControls {
  const resolved = useOptionalViewer(viewer);
  const [state, setState] = useState<PrintState>(IDLE);
  const controllerRef = useRef<PrintController | null>(null);

  useEffect(() => {
    const controller = createPrintController(resolved, setState);
    controllerRef.current = controller;
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
