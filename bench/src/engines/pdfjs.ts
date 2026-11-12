import * as pdfjs from "pdfjs-dist";
import rendererUrl from "pdfjs-dist/build/pdf.renderer.min.mjs?url";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createPdfjsAdapter } from "./pdfjs-common.ts";
import type { EngineAdapter } from "./types.ts";

/**
 * Released pdf.js parses in its worker. The renderer variant also draws in
 * a worker. The frame variant presents an OffscreenCanvas as a bitmap.
 */
export function createPdfjsEngine({
  hwa,
  frame,
  record = false,
  pathText = false,
  renderer = false,
}: {
  hwa: boolean;
  frame: boolean;
  record?: boolean;
  pathText?: boolean;
  renderer?: boolean;
}): EngineAdapter {
  return createPdfjsAdapter({
    id: `pdfjs${hwa ? "-hwa" : ""}${frame ? "-frame" : ""}${record ? "-record" : ""}${pathText ? "-pathtext" : ""}${renderer ? "-renderer" : ""}`,
    lib: pdfjs,
    label: "pdfjs-dist",
    workerUrl,
    rendererUrl: renderer ? rendererUrl : undefined,
    assetBase: "/pdfjs/",
    hwa,
    frame,
    record,
    pathText,
  });
}
