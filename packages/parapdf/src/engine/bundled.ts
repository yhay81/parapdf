import type * as Pdfjs from "pdfjs-dist";
import { createPdfjsEngine, type PdfjsDocumentOptions } from "./pdfjs.ts";
import { fileUrls, pdfjsWorkerUrl } from "./pdfjs-files.ts";
import type { PdfEngine } from "./types.ts";

/**
 * How ParaPDF loads pdf.js. Everything is optional: by default it loads the
 * pdfjs-dist it depends on, and pdf.js's worker and the files it loads on
 * demand (CMaps, standard fonts, image decoders, an ICC profile) come from
 * the copies in the package, which bundlers emit with the application's
 * assets.
 */
export interface PdfjsConfig {
  /**
   * Base URL of a copy of the package's `pdfjs/` directory, ending with a
   * slash, for bundlers that do not emit files referenced with
   * `new URL(…, import.meta.url)`, such as esbuild, Bun, and Parcel. The
   * worker is then `${assetBase}pdf.worker.js`.
   */
  assetBase?: string;
  /** URL of pdf.js's worker script, when it is not `${assetBase}pdf.worker.js`. */
  workerSrc?: string;
  /**
   * Loads another build of the same pdf.js version, such as the legacy build
   * older Safari needs (`() => import("pdfjs-dist/legacy/build/pdf.mjs")`);
   * give its worker as `workerSrc` and the files it loads as `assetBase`.
   */
  pdfjs?: () => Promise<typeof Pdfjs>;
  /**
   * Renderer worker script (pdf.js master and later). When set, pdf.js draws
   * pages into an OffscreenCanvas on its own thread instead of the main thread.
   */
  rendererSrc?: string;
  /**
   * Draw on GPU-backed canvases, pdf.js's enableHWA (default true); false
   * keeps pdf.js's own default of CPU-backed canvases.
   */
  enableHWA?: boolean;
  /** More getDocument parameters for every document, such as withCredentials or httpHeaders. */
  documentOptions?: PdfjsDocumentOptions;
}

let config: PdfjsConfig = {};
let loading: Promise<PdfEngine> | null = null;
let loaded: PdfEngine | null = null;
/** Where the worker loads from, for error messages. */
let workerLocation = "";

/** Whether two configurations load pdf.js alike; loaders compare by presence. */
const sameConfig = (a: PdfjsConfig, b: PdfjsConfig): boolean =>
  JSON.stringify({ ...a, pdfjs: Boolean(a.pdfjs) }) ===
  JSON.stringify({ ...b, pdfjs: Boolean(b.pdfjs) });

/**
 * Sets how ParaPDF loads pdf.js. Call it before the first document opens;
 * most applications never need it. Once pdf.js has loaded, a different
 * configuration is ignored with a warning, and the same one, as hot module
 * replacement passes again, silently.
 */
export function configurePdfjs(next: PdfjsConfig): void {
  if (loading) {
    if (!sameConfig(config, next)) {
      console.warn("ParaPDF: configurePdfjs() after pdf.js loaded has no effect.");
    }
    return;
  }
  config = { ...next };
}

/**
 * Starts loading pdf.js and its worker, once. `PdfDocument` calls it when it
 * first renders; call it earlier, such as when a link to a document is
 * hovered, to have pdf.js ready sooner. Does nothing on the server.
 */
export function preloadPdfjs(): void {
  if (typeof window === "undefined" || loading) return;
  // A failed load is forgotten and surfaces when a document opens.
  loadEngine().catch(() => {});
}

/**
 * The CORS mode of pdf.js's request for a document's URL, which a preload
 * must match to be reused. Null when there is nothing to preload: no preload
 * carries headers, and without streaming pdf.js reads only the ranges it needs.
 */
export function documentRequestMode(): "anonymous" | "use-credentials" | null {
  const options = config.documentOptions;
  if (options?.httpHeaders || options?.disableStream) return null;
  return options?.withCredentials ? "use-credentials" : "anonymous";
}

const absolute = (url: URL | string): string => new URL(String(url), document.baseURI).href;

function loadEngine(): Promise<PdfEngine> {
  loading ??= createEngine(config).then(
    (engine) => {
      loaded = engine;
      return engine;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * The directory URL pdf.js gets for the files ParaPDF ships. No request
 * reaches it: the worker's prelude sends requests for those files to the
 * URLs bundlers gave them.
 */
const SHIPPED_FILES = "parapdf:/";

/**
 * The worker fetches the files itself, as pdf.js requires to manage ICC
 * colors: when the main thread fetched them for it, CMYK red came out as
 * rgb(255 46 23) instead of rgb(236 31 37). The standard fonts' directory
 * stays unset, because pdf.js also adds fonts from it to the page as a CSS
 * fallback for missing system fonts, and the page cannot load those URLs.
 */
const SHIPPED_FILE_OPTIONS: PdfjsDocumentOptions = {
  useWorkerFetch: true,
  cMapUrl: SHIPPED_FILES,
  cMapPacked: true,
  wasmUrl: SHIPPED_FILES,
  iccUrl: SHIPPED_FILES,
};

/**
 * Starts pdf.js's worker from `url`, resolving to it once its script runs,
 * or to null when it fails to load. pdf.js would start it only once its own
 * module has loaded; started earlier, the worker's 1.2 MB download overlaps
 * pdf.js's. Cross-origin worker scripts cannot start this way, so pdf.js
 * starts those itself, through a blob: URL.
 */
function startWorker(url: string): Promise<Worker | null> {
  if (new URL(url).origin !== location.origin) return Promise.resolve(null);
  const worker = new Worker(url, { type: "module" });
  return new Promise((resolve) => {
    // pdf.js's worker posts "ready" when its script has run.
    worker.addEventListener("message", () => resolve(worker), { once: true });
    worker.addEventListener(
      "error",
      () => {
        worker.terminate();
        resolve(null);
      },
      { once: true },
    );
  });
}

async function createEngine(options: PdfjsConfig): Promise<PdfEngine> {
  const { assetBase } = options;
  const shipped = assetBase === undefined && options.workerSrc === undefined;
  const pdfjsLoading = options.pdfjs?.() ?? import("pdfjs-dist");
  // The shipped worker's prelude routes its requests for the shipped files
  // to the URLs in its own URL's fragment (see scripts/worker-prelude.js).
  // The list is in this bundle, 3 KB compressed, so the worker starts at
  // once; in a chunk of its own, it waited for a round trip.
  let workerSrc: string;
  let started: Promise<Worker | null> = Promise.resolve(null);
  if (shipped) {
    workerLocation = absolute(pdfjsWorkerUrl());
    const urls = Object.entries(fileUrls()).map(([name, url]) => [name, absolute(url)]);
    workerSrc = `${workerLocation}#${encodeURIComponent(JSON.stringify(Object.fromEntries(urls)))}`;
    started = startWorker(workerSrc);
  } else {
    workerSrc = options.workerSrc ?? `${assetBase}pdf.worker.js`;
    workerLocation = workerSrc;
  }
  // Without a started worker, pdf.js starts its own from workerSrc, and
  // parses on the page when that fails too.
  const [pdfjs, port] = await Promise.all([pdfjsLoading, started]);
  return createPdfjsEngine({
    pdfjs,
    workerSrc,
    ...(port ? { port } : {}),
    rendererSrc: options.rendererSrc,
    assetBase,
    enableHWA: options.enableHWA,
    documentOptions: {
      ...(shipped ? SHIPPED_FILE_OPTIONS : {}),
      ...options.documentOptions,
    },
  });
}

/**
 * pdf.js loaded on first use and shared by every viewer: one worker parses
 * every document.
 */
export const pdfjsEngine: PdfEngine = {
  get name() {
    return loaded?.name ?? "pdf.js";
  },
  async open(...args: Parameters<PdfEngine["open"]>) {
    const engine = await loadEngine();
    try {
      return await engine.open(...args);
    } catch (error) {
      // pdf.js tries to parse on the main thread when its worker does not
      // start, and that fails too when the script is missing.
      if (error instanceof Error && error.message.includes("fake worker")) {
        throw new Error(
          `pdf.js's worker did not load from ${workerLocation}. Bundlers that do not emit files ` +
            "referenced with new URL(…, import.meta.url), such as esbuild, Bun, and Parcel, " +
            "need configurePdfjs({ assetBase }) and a copy of parapdf/pdfjs/: see the README.",
          { cause: error },
        );
      }
      throw error;
    }
  },
};
