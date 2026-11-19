"use client";

import { createSlotKey, type ReadableStore, Store } from "../../document/store.ts";
import { linked } from "../../view/signals.ts";
import { controllerOf, type Viewer, type ViewerController } from "../../view/viewer.ts";
import { permits } from "../permissions.ts";
import { type PrintOptions, printDocument } from "./print.ts";

export type { PrintOptions } from "./print.ts";

export interface PrintProgress {
  done: number;
  total: number;
}

export interface PrintControls {
  readonly printing: boolean;
  readonly progress: PrintProgress | null;
  /**
   * Prepare and print the document through the browser's print dialog.
   * Calling `cancel()` stops page preparation cleanly without rejecting.
   */
  print(options?: PrintOptions): Promise<void>;
  /** Abort page preparation in progress. */
  cancel(): void;
}

export type PrintState = Pick<PrintControls, "printing" | "progress">;

export const IDLE_PRINT: PrintState = { printing: false, progress: null };

interface PrintJob {
  readonly controller: AbortController;
  cancelled: boolean;
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
  if (!session || !work || work.aborted) return;
  options?.signal?.throwIfAborted();
  // Closing the document stops printing it, as the application's signal does.
  const control = linked(work, options?.signal);
  let willPrintSent = false;
  let ended = false;
  const end = () => {
    if (!willPrintSent || ended) return;
    ended = true;
    void session.output("DidPrint");
  };
  try {
    // Include editing and restoration in every viewer of the document.
    await session.commit();
    control.signal.throwIfAborted();
    willPrintSent = true;
    await session.output("WillPrint");
    const layers =
      controller.layers ?? session.loadedLayers ?? (await session.layers().catch(() => null));
    await printDocument(session, {
      ...options,
      signal: control.signal,
      layers,
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

export interface PrintSlot {
  readonly store: ReadableStore<PrintControls>;
  readonly initialControls: PrintControls;
  hold(): () => void;
}

const PRINT_SLOT = createSlotKey<PrintSlot>("parapdf.print");

export function printOf(viewer: ViewerController): PrintSlot {
  return viewer.slot(PRINT_SLOT, () => {
    let holders = 0;
    let activeJob: PrintJob | null = null;

    const cancel = () => {
      const job = activeJob;
      if (!job) return;
      job.cancelled = true;
      activeJob = null;
      job.controller.abort();
      store.set(IDLE_PRINT);
    };

    const runPrint = async (options?: PrintOptions): Promise<void> => {
      const doc = viewer.session;
      if (!doc || !viewer.workSignal || viewer.workSignal.aborted || !permits(viewer, "print")) {
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
      store.set({ printing: true, progress: { done: 0, total: doc.pageCount } });
      try {
        await print(viewer, {
          ...options,
          signal: job.controller.signal,
          onProgress(done, total) {
            if (activeJob === job) {
              store.set({ printing: true, progress: { done, total } });
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
          store.set(IDLE_PRINT);
        }
      }
    };

    const initialControls: PrintControls = {
      ...IDLE_PRINT,
      print: runPrint,
      cancel,
    };
    const store = new Store<PrintControls>(initialControls);
    return {
      store,
      initialControls,
      hold() {
        holders++;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--holders === 0) cancel();
        };
      },
    };
  });
}
