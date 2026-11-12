import type { EngineAdapter } from "./types.ts";
import { createWorkerEngine } from "./worker-client.ts";

/** Installed engine version embedded by Vite when building the harness. */
declare const PDFIUM_VERSION: string;

/** PDFium compiled to WebAssembly (the engine EmbedPDF ships), in a worker. */
export function createPdfiumEngine(): EngineAdapter {
  return createWorkerEngine(
    "pdfium",
    `@embedpdf/pdfium ${PDFIUM_VERSION}`,
    () => new Worker(new URL("./pdfium.worker.ts", import.meta.url), { type: "module" }),
  );
}
