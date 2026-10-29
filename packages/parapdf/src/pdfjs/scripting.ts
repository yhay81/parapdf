/// <reference path="./sandbox.d.ts" />
"use client";

import type * as Pdfjs from "pdfjs-dist";
import type { LoadedPdfjs } from "./loader.ts";

/** What the document's scripts change of a field, as pdf.js's annotation elements take it. */
export type FieldUpdate = Record<string, unknown>;

export interface ScriptingHandlers {
  /** The scripts changed the field `id`; only fields of the document are passed. */
  field(id: string, update: FieldUpdate): void;
  /** The scripts asked the viewer for something: `page-num`, `zoom`, `print`, … */
  command(command: string, value: unknown): void;
}

/** The document's scripts running in pdf.js's sandbox. */
export interface DocumentScripting {
  /** Hand the scripts an event, as a field's element dispatches it. */
  dispatch(event: object, before?: () => boolean): void;
  /**
   * Hand the scripts one of the document's events, `WillSave`, `DidSave`,
   * `WillPrint`, or `DidPrint`; resolves once they ran it, and what they
   * changed reached the handlers.
   */
  documentEvent(name: string): Promise<void>;
  /** The reader turned to page `index`, or, with null, left the pages. */
  showPage(index: number | null): void;
  /** Close the document for the scripts (`PageClose`, `WillClose`), then free the sandbox. */
  destroy(): void;
}

/** pdf.js's sandbox (`pdf.sandbox.mjs`), as ParaPDF uses it. */
interface PdfjsSandbox {
  /** What the sandbox calls the window with, which ParaPDF gives one of its own. */
  support: { win: unknown } | null;
  create(data: unknown): void;
  dispatchEvent(event: unknown): void;
  nukeSandbox(): void;
}

/** Where `quickjs.js`, the module the sandbox imports QuickJS through, finds its URLs. */
const QUICKJS = Symbol.for("parapdf.quickjs");

/**
 * Start a sandbox. pdf.js's sandbox imports `${wasmUrl}quickjs-eval.js` and
 * starts QuickJS without options, so QuickJS would look for its WebAssembly
 * next to its script, which the files bundlers emit are not. Instead it
 * imports `quickjs.js`, after a fragment mark that keeps its own file name
 * out of the URL, and that module starts QuickJS from the URLs here.
 */
async function createSandbox(
  urls: ReturnType<LoadedPdfjs["scriptingUrls"]>,
): Promise<PdfjsSandbox> {
  const { QuickJSSandbox } = (await import("pdfjs-dist/build/pdf.sandbox.min.mjs")) as {
    QuickJSSandbox(wasmUrl: string): Promise<PdfjsSandbox>;
  };
  (globalThis as Record<symbol, unknown>)[QUICKJS] = { quickjs: urls.quickjs, wasm: urls.wasm };
  return QuickJSSandbox(`${urls.module}#`);
}

/**
 * The document's properties the scripts read (`this.info`, `numPages`, …),
 * as pdf.js's viewer gives them; the document has no URL of its own here.
 */
async function documentInfo(doc: Pdfjs.PDFDocumentProxy, filename: string | null) {
  const { info, metadata, contentDispositionFilename, contentLength } =
    (await doc.getMetadata()) as Awaited<ReturnType<Pdfjs.PDFDocumentProxy["getMetadata"]>> & {
      contentDispositionFilename: string | null;
      contentLength: number | null;
    };
  return {
    ...info,
    baseURL: "",
    filesize: contentLength || (await doc.getDownloadInfo()).length,
    filename: contentDispositionFilename || filename || "",
    metadata: metadata?.getRaw(),
    authors: metadata?.get("dc:creator"),
    numPages: doc.numPages,
    URL: "",
  };
}

/**
 * Run the scripts of `doc` (its fields' and its own) in pdf.js's sandbox,
 * once loaded, as pdf.js's viewer does: the document opens, then its pages
 * open and close as `showPage()` tells. What the scripts change reaches
 * `handlers`. A document without scripts starts no sandbox. Once
 * `destroy()` is called, what the scripts change reaches nothing.
 */
export function startScripting(
  loaded: LoadedPdfjs,
  doc: Pdfjs.PDFDocumentProxy,
  filename: string | null,
  handlers: ScriptingHandlers,
): DocumentScripting {
  let destroyed = false;
  /** `destroy()` was called: the scripts hear the document close, and nothing else. */
  let closing = false;
  /** The fields of the document, the only elements the scripts change. */
  let fields = new Set<string>();
  /** The page open in the sandbox, and the pages it has had: their actions go once. */
  let page: number | null = null;
  const visited = new Set<number>();

  /**
   * The window the sandbox calls: the browser's, except that its updates,
   * which pdf.js's sandbox sends as window events every sandbox on the
   * page shares, come to this document alone.
   */
  const win = Object.assign(Object.create(null) as object, {
    setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
    clearTimeout: (id: number) => window.clearTimeout(id),
    setInterval: (callback: () => void, ms: number) => window.setInterval(callback, ms),
    clearInterval: (id: number) => window.clearInterval(id),
    alert: (message: string) => window.alert(message),
    confirm: (message: string) => window.confirm(message),
    prompt: (message: string, value: string) => window.prompt(message, value),
    URL,
    CustomEvent,
    console,
    dispatchEvent(event: CustomEvent<FieldUpdate>) {
      if (!closing) update(event.detail);
      return true;
    },
  });

  function update(detail: FieldUpdate): void {
    const { id, siblings, command, value } = detail as {
      id?: string;
      siblings?: string[];
      command?: string;
      value?: unknown;
    };
    if (!id) {
      if (command) handlers.command(command, value);
      return;
    }
    const { id: _, siblings: __, ...change } = detail;
    for (const field of siblings ? [id, ...siblings] : [id]) {
      if (fields.has(field)) handlers.field(field, change);
    }
  }

  const sandbox = (async (): Promise<PdfjsSandbox | null> => {
    const [objects, calculationOrder, actions] = await Promise.all([
      doc.getFieldObjects(),
      doc.getCalculationOrderIds(),
      doc.getJSActions(),
    ]);
    if (closing || (!objects && !actions)) return null;
    const [info, created] = await Promise.all([
      documentInfo(doc, filename),
      createSandbox(loaded.scriptingUrls()),
    ]);
    if (closing) {
      created.nukeSandbox();
      return null;
    }
    fields = new Set(
      [...(objects?.values() ?? [])].flatMap((widgets) =>
        (widgets as { id: string }[]).map(({ id }) => id),
      ),
    );
    if (created.support) created.support.win = win;
    created.create({
      objects,
      calculationOrder,
      appInfo: { platform: navigator.platform, language: navigator.language },
      docInfo: { ...info, actions },
    });
    return created;
  })().catch((error: unknown) => {
    console.error("starting the document's scripts failed", error);
    return null;
  });

  /** Events reach the sandbox in order, each in a task of its own, as in pdf.js's viewer. */
  let queue: Promise<unknown> = sandbox;
  const send = (
    event: object | (() => Promise<object | null>),
    before?: () => boolean,
  ): Promise<void> => {
    if (closing) return Promise.resolve();
    const sent = queue
      .then(async () => {
        const ready = await sandbox;
        const detail = typeof event === "function" ? await event() : event;
        if (!ready || !detail || destroyed) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!destroyed && (!before || before())) ready.dispatchEvent(detail);
      })
      .catch((error: unknown) => console.error("dispatching a document script failed", error));
    queue = sent;
    return sent;
  };

  void send({ id: "doc", name: "Open" });

  return {
    dispatch(event, before) {
      void send(event, before);
    },
    documentEvent: (name) => send({ id: "doc", name }),
    showPage(index) {
      if (index === page) return;
      if (page !== null) void send({ id: "page", name: "PageClose", pageNumber: page + 1 });
      page = index;
      if (index === null) return;
      const first = !visited.has(index);
      visited.add(index);
      void send(async () => {
        // A page's own actions go with its first opening only, as in pdf.js's viewer.
        const actions = first ? await (await doc.getPage(index + 1)).getJSActions() : null;
        return { id: "page", name: "PageOpen", pageNumber: index + 1, actions };
      });
    },
    destroy() {
      if (closing) return;
      // The scripts hear the page and the document close, as in pdf.js's
      // viewer when it closes a document, then the sandbox goes.
      if (page !== null) void send({ id: "page", name: "PageClose", pageNumber: page + 1 });
      void send({ id: "doc", name: "WillClose" });
      closing = true;
      void queue.then(async () => {
        destroyed = true;
        (await sandbox)?.nukeSandbox();
      });
    },
  };
}
