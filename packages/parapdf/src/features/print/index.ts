"use client";

import { linked } from "../../view/signals.ts";
import { controllerOf, type Viewer, type ViewerController } from "../../view/viewer.ts";
import { permits } from "../permissions.ts";
import { type PrintOptions, printDocument } from "./print.ts";

export type { PrintOptions } from "./print.ts";

export interface PrintProgress {
  done: number;
  total: number;
}

export interface PrintState {
  readonly printing: boolean;
  readonly progress: PrintProgress | null;
}

export const IDLE_PRINT: PrintState = { printing: false, progress: null };

interface PrintJob {
  readonly controller: AbortController;
  cancelled: boolean;
}

export interface PrintController {
  print(options?: PrintOptions): Promise<void>;
  cancel(): void;
  dispose(): void;
}

/**
 * Print `viewer`'s document through the browser's print dialog: every page
 * is drawn for printing, with what was typed into its form fields and the
 * annotations created, and only those pages print. The document's scripts
 * hear `WillPrint` first, and what they change prints, and `DidPrint` once
 * printing ends. Resolves once the
 * browser returns from printing, and fails when the viewer follows
 * permissions and the document does not permit printing, and when the
 * document closes first.
 */
export async function print(viewer: Viewer, options?: PrintOptions): Promise<void> {
  const controller = controllerOf(viewer);
  const session = controller.session;
  if (session && !permits(controller, "print")) {
    throw new Error("The document does not permit printing");
  }
  const work = controller.workSignal;
  if (!session || !work) return;
  // Closing the document stops printing it, as the application's signal does.
  const control = linked(work, options?.signal);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    void session.output("DidPrint");
  };
  try {
    // Include editing and restoration in every viewer of the document.
    await session.commit();
    await session.output("WillPrint");
    await printDocument(session, {
      ...options,
      signal: control.signal,
      layers: controller.layers,
      onEnd: end,
    });
  } catch (error) {
    end();
    throw error;
  } finally {
    // Printed or stopped: the document's and the application's signals no longer follow it.
    control.abort();
  }
}

export function createPrintController(
  viewer: ViewerController,
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
    publish(IDLE_PRINT);
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
        await print(viewer, options);
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
        await print(viewer, {
          ...options,
          signal: job.controller.signal,
          onProgress(done, total) {
            if (activeJob === job) {
              publish({ printing: true, progress: { done, total } });
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
          publish(IDLE_PRINT);
        }
      }
    },
  };
}
