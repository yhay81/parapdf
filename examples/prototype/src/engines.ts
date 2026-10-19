import { createPdfjsEngine, type PdfEngine, type PdfjsDocumentOptions } from "parapdf";

/**
 * `pdfjs` is released pdfjs-dist (main-thread drawing); `pdfjs-next` is pdf.js
 * master with its renderer worker. Both load lazily so neither inflates the
 * other's startup.
 */
export async function loadEngine(
  kind: string,
  enableHWA: boolean,
  documentOptions?: PdfjsDocumentOptions,
): Promise<PdfEngine> {
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
      documentOptions,
    });
  }
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  return createPdfjsEngine({
    pdfjs,
    workerSrc: worker.default,
    assetBase: "/pdfjs/",
    enableHWA,
    documentOptions,
  });
}
