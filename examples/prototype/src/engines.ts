import { configurePdfjs, type PdfjsDocumentOptions } from "parapdf";
import nextRendererSrc from "pdfjs-next/pdf.renderer.mjs?url";
import nextWorkerSrc from "pdfjs-next/pdf.worker.mjs?url";

export type Pdfjs = typeof import("pdfjs-dist");

/**
 * Sets how ParaPDF loads pdf.js for the demo's `engine` parameter. `pdfjs` is
 * the pdf.js ParaPDF ships (main-thread drawing) and needs nothing;
 * `pdfjs-next` is pdf.js master with its renderer worker, loaded lazily.
 * `instrument` wraps the module, for the lifecycle check's counters.
 */
export function configureEngine(
  kind: string,
  enableHWA: boolean,
  documentOptions: PdfjsDocumentOptions | undefined,
  instrument: ((pdfjs: Pdfjs) => Pdfjs) | undefined,
): void {
  const options = {
    ...(enableHWA ? {} : { enableHWA: false }),
    ...(documentOptions ? { documentOptions } : {}),
  };
  if (kind === "pdfjs-next") {
    configurePdfjs({
      ...options,
      async pdfjs() {
        const pdfjs = await import("pdfjs-next/pdf.mjs");
        if ("unavailable" in pdfjs) {
          throw new Error("pdf.js master is not built; run bench/scripts/build-pdfjs-next.sh");
        }
        return instrument ? instrument(pdfjs) : pdfjs;
      },
      workerSrc: nextWorkerSrc,
      rendererSrc: nextRendererSrc,
      assetBase: "/pdfjs-next/",
    });
  } else if (instrument || Object.keys(options).length > 0) {
    configurePdfjs({
      ...options,
      ...(instrument ? { pdfjs: () => import("pdfjs-dist").then(instrument) } : {}),
    });
  }
}
