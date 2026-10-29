import type * as Pdfjs from "pdfjs-dist";
import { fileUrls, iconUrls, pdfjsWorkerUrl, scriptingUrls } from "./files.ts";

/**
 * pdf.js getDocument parameters that ParaPDF does not set from the source,
 * such as canvasMaxAreaInBytes, maxImageSize, or disableAutoFetch.
 */
export type PdfjsDocumentOptions = Omit<
  Exclude<
    Parameters<(typeof Pdfjs)["getDocument"]>[0],
    string | URL | ArrayBuffer | ArrayBufferView | undefined
  >,
  "url" | "data" | "range" | "worker"
>;

/** A build of the pdf.js version the package ships, with its worker from the package. */
export interface PdfjsBuild {
  readonly name: string;
  readonly pdfjs: () => Promise<typeof Pdfjs>;
  readonly workerUrl: () => URL;
}

/**
 * How ParaPDF loads pdf.js. Everything is optional: by default it loads the
 * pdfjs-dist it depends on, and pdf.js's worker and the files it loads on
 * demand (CMaps, standard fonts, image decoders, an ICC profile) come from
 * the copies in the package, which bundlers emit with the application's
 * assets.
 */
export interface PdfjsConfig {
  /**
   * The pdf.js build to load: `legacyBuild` from `parapdf/legacy` for older
   * browsers. Its worker and files come from the package like the modern
   * build's, so it needs nothing else.
   */
  build?: PdfjsBuild;
  /**
   * Base URL of a copy of the package's `pdfjs/` directory, ending with a
   * slash, for bundlers that do not emit files referenced with
   * `new URL(…, import.meta.url)`, such as esbuild, Bun, and Parcel. The
   * worker is then `${assetBase}pdf.worker.js`.
   */
  assetBase?: string;
  /**
   * Base URL of pdf.js's annotation icons, ending with a slash; by default
   * the icons the package ships, or `${assetBase}web/images/` with
   * `assetBase`.
   */
  imageResourcesPath?: string;
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

/**
 * pdf.js as ParaPDF loaded it, which every document opens and draws with:
 * the module, the worker that parses every document, and the parameters
 * ParaPDF configured for it.
 */
export interface LoadedPdfjs {
  /**
   * The pdf.js module: the pdfjs-dist ParaPDF depends on, unless
   * configurePdfjs() loads another build, such as the legacy build older
   * Safari needs.
   */
  readonly pdfjs: typeof Pdfjs;
  /** One worker parses every document. */
  readonly worker: Pdfjs.PDFWorker;
  /**
   * getDocument parameters for every document: the files pdf.js loads on
   * demand, enableHWA, and `documentOptions`, which override the others. The
   * source and the worker come from ParaPDF.
   */
  readonly documentParameters: PdfjsDocumentOptions;
  /**
   * Base URL of pdf.js's annotation icons, ending with a slash or, without
   * one, a transparent image that `iconUrls` replaces.
   */
  readonly imageResourcesPath: string;
  /**
   * The annotation icons' own URLs, by file name, as bundlers emit them;
   * null when the icons come from `imageResourcesPath`.
   */
  readonly iconUrls: Readonly<Record<string, string>> | null;
  /** Where the worker loads from, for the error when it does not. */
  readonly workerLocation: string;
  /**
   * Where form scripts' engine loads from (src/pdfjs/scripting.ts): the
   * module pdf.js's sandbox imports QuickJS through, QuickJS's script, and
   * its WebAssembly. Functions, so that a page without form scripts never
   * resolves them.
   */
  readonly scriptingUrls: () => { module: string; quickjs: string; wasm: string };
}

let config: PdfjsConfig = {};
let loading: Promise<LoadedPdfjs> | null = null;

/** JSON of `value` with every object's keys sorted, so that their order does not count. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

/** Whether two configurations load pdf.js alike; loaders compare by presence. */
const sameConfig = (a: PdfjsConfig, b: PdfjsConfig): boolean =>
  canonical({ ...a, pdfjs: Boolean(a.pdfjs), build: a.build?.name }) ===
  canonical({ ...b, pdfjs: Boolean(b.pdfjs), build: b.build?.name });

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
  loadPdfjs().catch(() => {});
}

/**
 * The CORS mode of pdf.js's request for a URL source, which a preload must
 * match to be reused. The source's own headers and credentials replace those
 * of `documentOptions`, as they do in the request. Null when there is nothing
 * to preload: no preload carries headers (empty ones are none), without
 * streaming pdf.js reads only the ranges it needs, and WebKit downloads it
 * again (decision 0014).
 */
export function documentRequestMode(
  source: {
    readonly httpHeaders?: Readonly<Record<string, string>>;
    readonly withCredentials?: boolean;
  },
  userAgent: string | undefined = globalThis.navigator?.userAgent,
): "anonymous" | "use-credentials" | null {
  const options = config.documentOptions;
  const headers = source.httpHeaders ?? options?.httpHeaders;
  if ((headers && Object.keys(headers).length > 0) || options?.disableStream) return null;
  if (userAgent && isWebKit(userAgent)) return null;
  return (source.withCredentials ?? options?.withCredentials) ? "use-credentials" : "anonymous";
}

/**
 * Whether a user agent is WebKit's, every browser on iOS and iPadOS among
 * them, which gives a fetch a preloaded response only once it has finished
 * downloading: a fetch while it downloads starts another download. Headless
 * Chromium says `HeadlessChrome/`, so "Chrome/" may follow a letter.
 */
const isWebKit = (userAgent: string): boolean =>
  /\bAppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium)\//.test(userAgent);

const absolute = (url: URL | string): string => new URL(String(url), document.baseURI).href;

/**
 * A shipped file's URL without the query that keeps bundlers from inlining
 * it (scripts/pdfjs-files.ts). webpack keeps all of it in the URLs it emits
 * and Vite's build `?url`, but neither puts it in the names of the files it
 * writes, so without it the URLs are the ones they emitted before.
 */
const shippedUrl = (url: URL): string =>
  absolute(url).replace(/\?(?:no-inline&url|no-inline|url)$/, "");

/** pdf.js loaded on first use and shared by every viewer: one worker parses every document. */
export function loadPdfjs(): Promise<LoadedPdfjs> {
  loading ??= load(config).catch((error: unknown) => {
    loading = null;
    throw error;
  });
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
 * pdf.js appends the icon's file name to its image path: after a data URL's
 * fragment mark, the name changes nothing, and the icon is a transparent
 * image instead of a request for a file the application may not serve.
 */
const TRANSPARENT_ICONS = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E#";

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

async function load(options: PdfjsConfig): Promise<LoadedPdfjs> {
  const { assetBase } = options;
  const shipped = assetBase === undefined && options.workerSrc === undefined;
  const pdfjsLoading = options.pdfjs?.() ?? options.build?.pdfjs() ?? import("pdfjs-dist");
  // The shipped worker's prelude routes its requests for the shipped files
  // to the URLs in its own URL's fragment (see scripts/worker-prelude.js).
  // The list is in this bundle, 3 KB compressed, so the worker starts at
  // once; in a chunk of its own, it waited for a round trip.
  let workerSrc: string;
  let workerLocation: string;
  let started: Promise<Worker | null> = Promise.resolve(null);
  if (shipped) {
    workerLocation = absolute((options.build?.workerUrl ?? pdfjsWorkerUrl)());
    const urls = Object.entries(fileUrls()).map(([name, url]) => [name, shippedUrl(url)]);
    workerSrc = `${workerLocation}#${encodeURIComponent(JSON.stringify(Object.fromEntries(urls)))}`;
    started = startWorker(workerSrc);
  } else {
    workerSrc = options.workerSrc ?? `${assetBase}pdf.worker.js`;
    workerLocation = workerSrc;
  }
  // Without a started worker, pdf.js starts its own from workerSrc, and
  // parses on the page when that fails too.
  const [pdfjs, port] = await Promise.all([pdfjsLoading, started]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  if (options.rendererSrc) {
    (pdfjs.GlobalWorkerOptions as { rendererSrc?: string }).rendererSrc = options.rendererSrc;
  }
  const documentOptions: PdfjsDocumentOptions = {
    ...(shipped ? SHIPPED_FILE_OPTIONS : {}),
    ...options.documentOptions,
  };
  const imageResourcesPath =
    options.imageResourcesPath ?? (assetBase ? `${assetBase}web/images/` : TRANSPARENT_ICONS);
  return {
    pdfjs,
    // Started now, while React mounts, instead of when the first document
    // opens. pdf.js takes any Worker as its port; its typings infer the
    // type from the default, null.
    worker: new pdfjs.PDFWorker(
      (port ? { port } : {}) as ConstructorParameters<typeof pdfjs.PDFWorker>[0],
    ),
    documentParameters: {
      enableHWA: options.enableHWA ?? true,
      ...(assetBase
        ? {
            cMapUrl: `${assetBase}cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${assetBase}standard_fonts/`,
            wasmUrl: `${assetBase}wasm/`,
            iccUrl: `${assetBase}iccs/`,
          }
        : {}),
      ...documentOptions,
    },
    imageResourcesPath,
    // The icons do not come with the worker: one of the application's own
    // shows those the package ships, as the scripts' files are.
    iconUrls:
      assetBase === undefined && imageResourcesPath === TRANSPARENT_ICONS
        ? Object.fromEntries(
            Object.entries(iconUrls()).map(([name, url]) => [name, shippedUrl(url)]),
          )
        : null,
    workerLocation,
    scriptingUrls: assetBase
      ? () => ({
          module: `${assetBase}quickjs.js`,
          quickjs: `${assetBase}wasm/quickjs-eval.js`,
          wasm: `${assetBase}wasm/quickjs-eval.wasm`,
        })
      : () => {
          const { module, quickjs, wasm } = scriptingUrls();
          return {
            module: shippedUrl(module),
            quickjs: shippedUrl(quickjs),
            wasm: shippedUrl(wasm),
          };
        },
  };
}
