import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createPdfjsAdapter } from "./pdfjs-common.ts";
import type { EngineAdapter } from "./types.ts";

/** Released pdf.js: parsing in its worker, drawing on the main thread. */
export function createPdfjsEngine({ hwa }: { hwa: boolean }): EngineAdapter {
  return createPdfjsAdapter({
    id: hwa ? "pdfjs-hwa" : "pdfjs",
    lib: pdfjs,
    label: "pdfjs-dist",
    workerUrl,
    assetBase: "/pdfjs/",
    hwa,
  });
}
