import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { legacyBuild } from "../src/legacy.ts";
import { pdfjsRendererUrl } from "../src/pdfjs/files.ts";
import {
  configurePdfjs,
  documentRequestMode,
  loadPdfjs,
  type PdfjsConfig,
  preloadPdfjs,
} from "../src/pdfjs/loader.ts";

describe("documentRequestMode", () => {
  afterEach(() => configurePdfjs({}));

  it("preloads a plain URL anonymously", () => {
    assert.equal(documentRequestMode({}), "anonymous");
  });

  it("preloads with credentials when the source or documentOptions sends them", () => {
    assert.equal(documentRequestMode({ withCredentials: true }), "use-credentials");
    configurePdfjs({ documentOptions: { withCredentials: true } });
    assert.equal(documentRequestMode({}), "use-credentials");
    // The source's own setting replaces documentOptions', as in the request.
    assert.equal(documentRequestMode({ withCredentials: false }), "anonymous");
  });

  it("skips the preload when the request carries headers", () => {
    assert.equal(documentRequestMode({ httpHeaders: { Authorization: "Bearer t" } }), null);
    configurePdfjs({ documentOptions: { httpHeaders: { Authorization: "Bearer t" } } });
    assert.equal(documentRequestMode({}), null);
  });

  it("preloads a request whose headers are empty, which sends none", () => {
    assert.equal(documentRequestMode({ httpHeaders: {} }), "anonymous");
    configurePdfjs({ documentOptions: { httpHeaders: { Authorization: "Bearer t" } } });
    // The source's own headers replace documentOptions', as in the request.
    assert.equal(documentRequestMode({ httpHeaders: {} }), "anonymous");
  });

  it("skips the preload without streaming", () => {
    configurePdfjs({ documentOptions: { disableStream: true } });
    assert.equal(documentRequestMode({}), null);
  });

  it("skips the preload in WebKit, where a fetch downloads it again", () => {
    const agents = {
      safari:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Safari/605.1.15",
      iosChrome:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1",
      chrome:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      headlessChrome:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36",
      firefox:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0",
    };
    assert.equal(documentRequestMode({}, agents.safari), null);
    assert.equal(documentRequestMode({}, agents.iosChrome), null);
    assert.equal(documentRequestMode({}, agents.chrome), "anonymous");
    assert.equal(documentRequestMode({}, agents.headlessChrome), "anonymous");
    assert.equal(documentRequestMode({}, agents.firefox), "anonymous");
    // A server, which cannot tell the browser, keeps it.
    assert.equal(documentRequestMode({}, undefined), "anonymous");
  });
});

it("resolves the matching workers in a static copy of the package", () => {
  const base = "https://example.org/static/pdfjs/";
  assert.equal(pdfjsRendererUrl(base).href, `${base}pdf.renderer.js`);
  assert.equal(legacyBuild.workerUrl(base).href, `${base}pdf.worker.legacy.js`);
  assert.equal(legacyBuild.rendererUrl?.(base).href, `${base}pdf.renderer.legacy.js`);
  // Missing trailing slash still resolves inside the directory.
  const noSlash = "https://example.org/static/pdfjs";
  assert.equal(pdfjsRendererUrl(noSlash).href, `${base}pdf.renderer.js`);
  assert.equal(legacyBuild.workerUrl(noSlash).href, `${base}pdf.worker.legacy.js`);
  assert.equal(legacyBuild.rendererUrl?.(noSlash).href, `${base}pdf.renderer.legacy.js`);
});

// pdf.js loads once per page, so these come last and run in order: those
// that load nothing or fail first, then the one load, then what follows it.
describe("loadPdfjs", () => {
  /** A pdf.js module that records the workers started with it. */
  const fakeModule = () => {
    const workers: unknown[] = [];
    const module = {
      GlobalWorkerOptions: { workerSrc: "" },
      PDFWorker: class {
        constructor(options: unknown) {
          workers.push(options);
        }
      },
    } as unknown as typeof Pdfjs;
    return { module, workers };
  };
  const { module, workers } = fakeModule();
  let loads = 0;
  /** The configuration of the one load, a new object each time as hot module replacement passes it. */
  const loaded = (): PdfjsConfig => ({
    assetBase: "/assets/",
    workerSrc: "/workers/pdf.worker.js",
    pdfjs: async () => {
      loads++;
      return module;
    },
    rendererSrc: "/renderer.js",
    enableHWA: false,
    documentOptions: { cMapUrl: "/cmaps/", disableAutoFetch: true, enableWebGPU: true },
  });

  it("loads nothing on the server when asked to start early", async (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    configurePdfjs(loaded());
    preloadPdfjs();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loads, 0);
    configurePdfjs({ assetBase: "/other/" });
    assert.equal(warn.mock.callCount(), 0, "nothing loaded, so it is configured again");
  });

  it("forgets a failed load, terminates a started worker, catches synchronous CSP Worker errors, and normalizes assetBase", async (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    const savedGlobals = ["document", "location", "Worker"].map(
      (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
    );
    context.after(() => {
      for (const [name, desc] of savedGlobals) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else Reflect.deleteProperty(globalThis, name);
      }
    });

    // 1. Synchronous SecurityError from `new Worker()` (e.g. strict CSP) falls back instead of throwing synchronously.
    let workerConstructors = 0;
    Object.assign(globalThis, {
      document: { baseURI: "https://example.com/app/" },
      location: { origin: "https://example.com" },
      Worker: class {
        constructor() {
          workerConstructors++;
          throw new DOMException("Blocked by CSP", "SecurityError");
        }
      },
    });
    configurePdfjs({
      build: {
        name: "csp-test",
        pdfjs: async () => {
          throw new Error("pdfjs load error after CSP fallback");
        },
        workerUrl: () => new URL("https://example.com/pdf.worker.js"),
      },
    });
    await assert.rejects(loadPdfjs(), /pdfjs load error after CSP fallback/);
    assert.equal(workerConstructors, 1);

    // 2. If `pdfjsLoading` fails while a parallel `Worker` started, the worker is terminated instead of leaking.
    let terminated = 0;
    const workerUrls: string[] = [];
    let started!: EventTarget;
    let startupEvent = "message";
    Object.assign(globalThis, {
      Worker: class extends EventTarget {
        constructor(url: URL | string) {
          super();
          started = this;
          workerUrls.push(String(url));
          queueMicrotask(() => this.dispatchEvent(new Event(startupEvent)));
        }
        terminate() {
          terminated++;
        }
      },
    });
    configurePdfjs({
      build: {
        name: "leak-test",
        pdfjs: async () => {
          throw new Error("chunk load failed");
        },
        workerUrl: () => new URL("https://example.com/pdf.worker.js"),
      },
    });
    await assert.rejects(loadPdfjs(), /chunk load failed/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(terminated, 1);

    // A static copy starts its matching worker while the pdf.js module is still loading.
    let rejectModule!: (error: Error) => void;
    const pending = new Promise<typeof Pdfjs>((_, reject) => {
      rejectModule = reject;
    });
    const build = { ...legacyBuild, pdfjs: () => pending };
    configurePdfjs({ assetBase: "./pdfjs", build });
    const opening = loadPdfjs();
    assert.deepEqual(workerUrls.slice(1), ["https://example.com/app/pdfjs/pdf.worker.legacy.js"]);
    await Promise.resolve();
    started.dispatchEvent(new Event("error"));
    assert.equal(terminated, 1, "an error after startup must not terminate the shared worker");
    rejectModule(new Error("static module unavailable"));
    await assert.rejects(opening, /static module unavailable/);
    assert.equal(terminated, 2);

    // Cross-origin assets and an explicit worker keep pdf.js's normal startup path.
    for (const options of [
      { assetBase: "//cdn.example/pdfjs" },
      { assetBase: "/pdfjs", workerSrc: "/custom-worker.js" },
    ]) {
      configurePdfjs({ ...options, build });
      await assert.rejects(loadPdfjs(), /static module unavailable/);
    }
    assert.equal(workerUrls.length, 2);

    startupEvent = "error";
    configurePdfjs({ assetBase: "/pdfjs", build });
    await assert.rejects(loadPdfjs(), /static module unavailable/);
    assert.equal(terminated, 3, "a worker that failed to start is terminated once");

    for (const [name, desc] of savedGlobals) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else Reflect.deleteProperty(globalThis, name);
    }

    let attempts = 0;
    configurePdfjs({
      assetBase: "/assets",
      pdfjs: async () => {
        attempts++;
        throw new Error("offline");
      },
    });
    await assert.rejects(loadPdfjs(), /offline/);
    await assert.rejects(loadPdfjs(), /offline/);
    assert.equal(attempts, 2);
    // Pass assetBase without trailing slash into the real load below to verify normalization too.
    configurePdfjs({ ...loaded(), assetBase: "/assets" });
    assert.equal(warn.mock.callCount(), 0);
  });

  it("loads pdf.js once, with its files under assetBase and documentOptions over them", async () => {
    const loading = loadPdfjs();
    assert.equal(loadPdfjs(), loading);
    const pdfjs = await loading;
    assert.equal(loads, 1);
    assert.equal(pdfjs.pdfjs, module);
    assert.equal(module.GlobalWorkerOptions.workerSrc, "/workers/pdf.worker.js");
    assert.equal(pdfjs.workerLocation, "/workers/pdf.worker.js");
    assert.equal(
      (module.GlobalWorkerOptions as { rendererSrc?: string }).rendererSrc,
      "/renderer.js",
    );
    assert.deepEqual(workers, [{}], "one worker, which pdf.js starts itself");
    assert.deepEqual(pdfjs.documentParameters, {
      enableHWA: false,
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/assets/standard_fonts/",
      wasmUrl: "/assets/wasm/",
      iccUrl: "/assets/iccs/",
      disableAutoFetch: true,
      enableWebGPU: true,
    });
    assert.equal(pdfjs.imageResourcesPath, "/assets/web/images/");
    assert.equal(pdfjs.iconUrls, null);
    assert.deepEqual(pdfjs.scriptingUrls(), {
      module: "/assets/quickjs.js",
      quickjs: "/assets/wasm/quickjs-eval.js",
      wasm: "/assets/wasm/quickjs-eval.wasm",
    });
  });

  it("ignores another configuration once pdf.js loaded, with a warning, and the same one silently", async (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    configurePdfjs(loaded());
    assert.equal(warn.mock.callCount(), 0);
    configurePdfjs({ ...loaded(), enableHWA: true });
    assert.equal(warn.mock.callCount(), 1);
    // The same configuration with its keys in another order is the same.
    const { documentOptions, ...rest } = loaded();
    configurePdfjs({
      documentOptions: { enableWebGPU: true, disableAutoFetch: true, cMapUrl: "/cmaps/" },
      ...rest,
    });
    assert.equal(warn.mock.callCount(), 1);
    // The configuration it loaded with stays.
    assert.equal(documentRequestMode({}, undefined), "anonymous");
    assert.equal((await loadPdfjs()).documentParameters.enableHWA, false);
    assert.equal(loads, 1);
  });
});
