import { createHybridEngine, createPdfjsEngine, type HybridEvent, type PdfEngine } from "parapdf";

/**
 * `pdfjs` is released pdfjs-dist (main-thread drawing); `pdfjs-next` is pdf.js
 * master with its renderer worker; `hybrid` is `pdfjs-next` with image-only
 * pages rendered by hayro. All load lazily so none inflates the others'
 * startup.
 */
export async function loadEngine(
  kind: string,
  enableHWA: boolean,
  onHybridEvent?: (event: HybridEvent) => void,
): Promise<PdfEngine> {
  if (kind === "hybrid") {
    // Start the hybrid worker before pdf.js loads, so the classifier module
    // and pdf.js's modules download in parallel.
    const worker = new Worker(new URL("./hybrid.worker.ts", import.meta.url), { type: "module" });
    return createHybridEngine({
      base: await loadEngine("pdfjs-next", enableHWA),
      createWorker: () => worker,
      onEvent: onHybridEvent,
    });
  }
  if (kind === "pdfjs-next") {
    const [pdfjs, worker, renderer] = await Promise.all([
      import("pdfjs-next/pdf.mjs"),
      import("pdfjs-next/pdf.worker.mjs?url"),
      import("pdfjs-next/pdf.renderer.mjs?url"),
    ]);
    if ("unavailable" in pdfjs) {
      throw new Error("pdf.js master is not built; run bench/scripts/build-pdfjs-next.sh");
    }
    return createPdfjsEngine({
      pdfjs,
      workerSrc: worker.default,
      rendererSrc: renderer.default,
      assetBase: "/pdfjs-next/",
      enableHWA,
    });
  }
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  return createPdfjsEngine({ pdfjs, workerSrc: worker.default, assetBase: "/pdfjs/", enableHWA });
}
