import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
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
    documentOptions: { cMapUrl: "/cmaps/", disableAutoFetch: true },
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

  it("forgets a failed load, and its configuration may still change", async (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    let attempts = 0;
    configurePdfjs({
      assetBase: "/assets/",
      pdfjs: async () => {
        attempts++;
        throw new Error("offline");
      },
    });
    await assert.rejects(loadPdfjs(), /offline/);
    await assert.rejects(loadPdfjs(), /offline/);
    assert.equal(attempts, 2);
    configurePdfjs(loaded());
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
    configurePdfjs({ documentOptions: { disableAutoFetch: true, cMapUrl: "/cmaps/" }, ...rest });
    assert.equal(warn.mock.callCount(), 1);
    // The configuration it loaded with stays.
    assert.equal(documentRequestMode({}, undefined), "anonymous");
    assert.equal((await loadPdfjs()).documentParameters.enableHWA, false);
    assert.equal(loads, 1);
  });
});
