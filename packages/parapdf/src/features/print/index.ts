"use client";

import { linked } from "../../view/signals.ts";
import type { Viewer } from "../../view/viewer.ts";
import { permits } from "../permissions.ts";
import { type PrintOptions, printDocument } from "./print.ts";

export type { PrintOptions } from "./print.ts";

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
  const session = viewer.session;
  if (session && !permits(viewer, "print")) {
    throw new Error("The document does not permit printing");
  }
  // What is being typed, in any viewer of the document, prints.
  session?.commit();
  const work = viewer.workSignal;
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
    await session.output("WillPrint");
    await printDocument(session, {
      ...options,
      signal: control.signal,
      layers: viewer.layers,
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
