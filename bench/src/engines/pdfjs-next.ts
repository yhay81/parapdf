import * as pdfjsNext from "pdfjs-next/pdf.mjs";
import rendererUrl from "pdfjs-next/pdf.renderer.mjs?url";
import workerUrl from "pdfjs-next/pdf.worker.mjs?url";
import { createPdfjsAdapter } from "./pdfjs-common.ts";
import type { EngineAdapter } from "./types.ts";

/**
 * Unreleased pdf.js master with its renderer worker enabled, built by
 * `scripts/build-pdfjs-next.sh` into bench/vendor/. Pages are drawn into an
 * OffscreenCanvas on a third thread and returned as ImageBitmaps, which
 * pdf.js copies into the canvas it was given: the displayed one or, with
 * `frame`, an OffscreenCanvas shown as a frame.
 */
export function createPdfjsNextEngine({
  hwa,
  frame,
}: {
  hwa: boolean;
  frame: boolean;
}): EngineAdapter {
  if ("unavailable" in pdfjsNext) {
    throw new Error("pdf.js master is not built; run bench/scripts/build-pdfjs-next.sh");
  }
  return createPdfjsAdapter({
    id: `pdfjs-next${hwa ? "-hwa" : ""}${frame ? "-frame" : ""}`,
    lib: pdfjsNext,
    label: "pdf.js master",
    workerUrl,
    rendererUrl,
    assetBase: "/pdfjs-next/",
    hwa,
    frame,
  });
}
