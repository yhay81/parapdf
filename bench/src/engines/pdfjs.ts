import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createPdfjsAdapter } from "./pdfjs-common.ts";
import type { EngineAdapter } from "./types.ts";

/**
 * Released pdf.js: parsing in its worker, drawing on the main thread, into
 * the displayed canvas or, with `frame`, into an OffscreenCanvas shown as a
 * frame.
 */
export function createPdfjsEngine({
  hwa,
  frame,
  record = false,
}: {
  hwa: boolean;
  frame: boolean;
  record?: boolean;
}): EngineAdapter {
  return createPdfjsAdapter({
    id: `pdfjs${hwa ? "-hwa" : ""}${frame ? "-frame" : ""}${record ? "-record" : ""}`,
    lib: pdfjs,
    label: "pdfjs-dist",
    workerUrl,
    assetBase: "/pdfjs/",
    hwa,
    frame,
    record,
  });
}
