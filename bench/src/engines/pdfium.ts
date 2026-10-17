import type { EngineAdapter } from "./types.ts";
import { createWorkerEngine } from "./worker-client.ts";

/** PDFium compiled to WebAssembly (the engine EmbedPDF ships), in a worker. */
export function createPdfiumEngine(): EngineAdapter {
  return createWorkerEngine(
    "pdfium",
    "@embedpdf/pdfium 2.15.1",
    () => new Worker(new URL("./pdfium.worker.ts", import.meta.url), { type: "module" }),
  );
}
