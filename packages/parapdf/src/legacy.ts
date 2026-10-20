import type { PdfjsBuild } from "./engine/bundled.ts";
import { pdfjsLegacyWorkerUrl } from "./engine/pdfjs-legacy-files.ts";

/**
 * pdf.js's legacy build, for older browsers the modern one does not
 * support, with its worker from the package:
 * `configurePdfjs({ build: legacyBuild })`. Its worker, about 1.3 MB, is
 * emitted only by applications that import this module.
 */
export const legacyBuild: PdfjsBuild = {
  name: "legacy",
  pdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<typeof import("pdfjs-dist")>,
  workerUrl: pdfjsLegacyWorkerUrl,
};
