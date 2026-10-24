import type * as Pdfjs from "pdfjs-dist";
import {
  type Destination,
  type ResolvedDestination,
  resolveDestination,
  resolveExplicit,
} from "../pdfjs/destinations.ts";
import { createFormAccess } from "../pdfjs/forms.ts";
import { LayerState } from "../pdfjs/layers.ts";
import type { LoadedPdfjs } from "../pdfjs/loader.ts";
import { type PageText, readPageText } from "../pdfjs/text.ts";

/** Page size in PDF points (1/72 in), rotation already applied. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * Where a document comes from. A URL source may carry the request's headers
 * and credentials mode, and any source the password of an encrypted
 * document: it is tried first, and another is asked for only when it is
 * wrong.
 */
export type PdfSource =
  | {
      url: string;
      httpHeaders?: Readonly<Record<string, string>>;
      withCredentials?: boolean;
      password?: string;
    }
  | { data: ArrayBuffer | Uint8Array; password?: string };

/** Why an encrypted document asks for a password: none was given, or the last one was wrong. */
export type PasswordReason = "required" | "incorrect";

/**
 * What the document's encryption dictionary permits (PDF 32000-1, Table 22).
 * Documents that are not encrypted permit everything.
 */
export interface PdfPermissions {
  /** Whether the document restricts anything at all. */
  restricted: boolean;
  print: boolean;
  /** Printing at full resolution; without it, printing may be degraded. */
  printHighQuality: boolean;
  /** Changing the document's content other than annotations and forms. */
  modify: boolean;
  /** Copying text and graphics. */
  copy: boolean;
  /** Extracting text for accessibility. */
  copyForAccessibility: boolean;
  /** Adding and changing annotations, and filling in forms. */
  annotate: boolean;
  /** Filling in existing form fields, even without `annotate`. */
  fillForms: boolean;
  /** Inserting, deleting, and turning pages. */
  assemble: boolean;
}

/** How the document's catalog asks a viewer to arrange pages (/PageLayout). */
export type PdfPageLayout =
  | "SinglePage"
  | "OneColumn"
  | "TwoColumnLeft"
  | "TwoColumnRight"
  | "TwoPageLeft"
  | "TwoPageRight";

/** What the document's catalog asks a viewer to show beside the pages (/PageMode). */
export type PdfPageMode =
  | "UseNone"
  | "UseOutlines"
  | "UseThumbs"
  | "FullScreen"
  | "UseOC"
  | "UseAttachments";

/** How the document asks to be shown when it opens; null where it asks nothing. */
export interface PdfInitialView {
  /** Where to open: the destination of the catalog's /OpenAction. */
  destination: ResolvedDestination | null;
  pageLayout: PdfPageLayout | null;
  pageMode: PdfPageMode | null;
}

export interface OutlineNode {
  title: string;
  /** Internal target, or null when the entry links elsewhere or nowhere. */
  dest: Destination | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: readonly OutlineNode[];
}

/** The document's information dictionary and XMP metadata, as far as it has them. */
export interface PdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  /** The version in the file's header, such as "1.7". */
  pdfVersion: string | null;
  /** The document's natural language (/Lang), such as "ja". */
  language: string | null;
}

/** A file embedded in the document. */
export interface PdfAttachment {
  /** Identifies it for `getAttachmentContent`. */
  id: string;
  /** The file's name without a path. */
  filename: string;
  description: string | null;
}

/** What opening a document asks of whoever opens it. */
export interface OpenCallbacks {
  /** Bytes received so far, and the document's size when the server reported it. */
  onProgress?(loaded: number, total: number | null): void;
  /**
   * Asked whenever an encrypted document needs a password. Resolve with the
   * password to try, or with null to stop opening it, which then fails.
   * Without it, an encrypted document fails to open.
   */
  password?(reason: PasswordReason): Promise<string | null>;
}

const PAGE_LAYOUTS = new Set<string>([
  "SinglePage",
  "OneColumn",
  "TwoColumnLeft",
  "TwoColumnRight",
  "TwoPageLeft",
  "TwoPageRight",
]);
const PAGE_MODES = new Set<string>([
  "UseNone",
  "UseOutlines",
  "UseThumbs",
  "FullScreen",
  "UseOC",
  "UseAttachments",
]);

/** The first of `values` that is a non-empty string, trimmed. */
function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

type PdfjsOutlineItem = NonNullable<
  Awaited<ReturnType<Pdfjs.PDFDocumentProxy["getOutline"]>>
>[number];

const toOutline = (items: readonly PdfjsOutlineItem[] | null): OutlineNode[] =>
  (items ?? []).map((item) => ({
    title: item.title,
    dest: item.dest ?? null,
    url: item.url ?? null,
    bold: Boolean(item.bold),
    italic: Boolean(item.italic),
    items: toOutline(item.items),
  }));

/** Pages whose sizes the background pass asks pdf.js's worker for at a time. */
const MEASURED_PAGES = 64;

/**
 * One open document, shared by every viewer of its source (see
 * registry.ts): pdf.js's document and its pages, and what the viewers read
 * from them, each read once: the pages' sizes, their text, permissions, the
 * initial view, the outline, page labels, metadata, attachments, and which
 * layers show. The session owns an AbortController: closing it aborts its
 * `signal`, which everything started for the session takes, and destroys
 * the document.
 */
export class DocumentSession {
  /** pdf.js, as the document was opened with it. */
  readonly pdfjs: LoadedPdfjs;
  /** pdf.js's own document, for its APIs ParaPDF does not wrap. */
  readonly proxy: Pdfjs.PDFDocumentProxy;
  readonly pageCount: number;
  /** Aborted once the session closes. */
  readonly signal: AbortSignal;
  readonly #controller: AbortController;
  readonly #loadingTask: Pdfjs.PDFDocumentLoadingTask;
  readonly #pages = new Map<number, Promise<Pdfjs.PDFPageProxy>>();
  readonly #texts = new Map<number, Promise<PageText>>();
  /** Every page's size, once the background pass has learned them. */
  #sizes: readonly PageSize[] | null = null;
  #measuring: Promise<readonly PageSize[]> | null = null;
  #permissions: Promise<PdfPermissions> | null = null;
  #initialView: Promise<PdfInitialView> | null = null;
  #outline: Promise<readonly OutlineNode[]> | null = null;
  #pageLabels: Promise<readonly string[] | null> | null = null;
  #metadata: Promise<PdfMetadata> | null = null;
  #attachments: Promise<readonly PdfAttachment[]> | null = null;
  #layers: Promise<LayerState> | null = null;
  #forms: ReturnType<typeof createFormAccess> | null = null;

  private constructor(
    pdfjs: LoadedPdfjs,
    loadingTask: Pdfjs.PDFDocumentLoadingTask,
    proxy: Pdfjs.PDFDocumentProxy,
    controller: AbortController,
  ) {
    this.pdfjs = pdfjs;
    this.#loadingTask = loadingTask;
    this.proxy = proxy;
    this.pageCount = proxy.numPages;
    this.#controller = controller;
    this.signal = controller.signal;
  }

  /**
   * Open `source` with the pdf.js `loader` loads. `controller` becomes the
   * session's: aborting it stops a load still in progress, or waiting for a
   * password.
   */
  static async open(
    loader: () => Promise<LoadedPdfjs>,
    source: PdfSource,
    controller: AbortController,
    { onProgress, password: askPassword }: OpenCallbacks = {},
  ): Promise<DocumentSession> {
    const { signal } = controller;
    const loaded = await loader();
    signal.throwIfAborted();
    const { pdfjs } = loaded;
    const loadingTask = pdfjs.getDocument({
      ...loaded.documentParameters,
      // pdf.js transfers the bytes to its worker, which detaches the
      // caller's buffer. A copy leaves the application its data and lets the
      // same source open again after its document was destroyed.
      ...("url" in source
        ? {
            url: source.url,
            ...(source.httpHeaders ? { httpHeaders: { ...source.httpHeaders } } : {}),
            ...(source.withCredentials !== undefined
              ? { withCredentials: source.withCredentials }
              : {}),
          }
        : { data: source.data.slice(0) }),
      ...(source.password !== undefined ? { password: source.password } : {}),
      worker: loaded.worker,
    });
    if (onProgress) {
      loadingTask.onProgress = ({ loaded, total }: { loaded: number; total?: number }) =>
        onProgress(loaded, total && total > 0 ? total : null);
    }
    // Without onPassword, pdf.js fails an encrypted document with a PasswordException.
    if (askPassword) {
      loadingTask.onPassword = (update: (password: string | Error) => void, code: number) => {
        const reason =
          code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "required";
        askPassword(reason).then(
          (password) =>
            update(
              password ??
                // pdf.js's own exception class, so the failure reads like any other.
                (new pdfjs.PasswordException("No password was given.", code) as unknown as Error),
            ),
          (error: unknown) => update(error instanceof Error ? error : new Error(String(error))),
        );
      };
    }
    // Aborting stops a load in progress; a loaded document is destroyed by close().
    const abort = () => void loadingTask.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const proxy = await loadingTask.promise;
      // Aborted while it loaded: the loading task, and the document with it, is destroyed.
      signal.throwIfAborted();
      return new DocumentSession(loaded, loadingTask, proxy, controller);
    } catch (error) {
      // pdf.js tries to parse on the main thread when its worker does not
      // start, and that fails too when the script is missing.
      if (error instanceof Error && error.message.includes("fake worker")) {
        throw new Error(
          `pdf.js's worker did not load from ${loaded.workerLocation}. Bundlers that do not emit files ` +
            "referenced with new URL(…, import.meta.url), such as esbuild, Bun, and Parcel, " +
            "need configurePdfjs({ assetBase }) and a copy of parapdf/pdfjs/: see the README.",
          { cause: error },
        );
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /** pdf.js's page `pageIndex`, loaded once. */
  page(pageIndex: number): Promise<Pdfjs.PDFPageProxy> {
    let page = this.#pages.get(pageIndex);
    if (!page) {
      page = this.proxy.getPage(pageIndex + 1);
      this.#pages.set(pageIndex, page);
    }
    return page;
  }

  /** The page's size in PDF points with its own rotation applied. */
  async pageSize(pageIndex: number): Promise<PageSize> {
    const { width, height } = (await this.page(pageIndex)).getViewport({ scale: 1 });
    return { width, height };
  }

  /**
   * Every page's size as far as the session knows it: the first page's for
   * every page until `measurePages()` has learned the others.
   */
  async pageSizes(): Promise<readonly PageSize[]> {
    if (this.#sizes) return this.#sizes;
    const first = await this.pageSize(0);
    return this.#sizes ?? Array.from({ length: this.pageCount }, () => first);
  }

  /**
   * Learns the size of every page in the background, once for every viewer,
   * a batch at a time, and resolves with them. Stops when the session closes.
   */
  measurePages(): Promise<readonly PageSize[]> {
    this.#measuring ??= (async () => {
      const sizes = [...(await this.pageSizes())];
      for (let index = 1; index < this.pageCount; index += MEASURED_PAGES) {
        this.signal.throwIfAborted();
        const batch = Array.from(
          { length: Math.min(MEASURED_PAGES, this.pageCount - index) },
          (_, offset) => this.pageSize(index + offset),
        );
        const results = await Promise.all(batch);
        results.forEach((size, offset) => {
          sizes[index + offset] = size;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.signal.throwIfAborted();
      this.#sizes = sizes;
      return sizes;
    })();
    return this.#measuring;
  }

  /**
   * The text of page `pageIndex`, read once in pdf.js's worker, for search,
   * `getText()`, and scrolling to matches before the page's text layer exists.
   */
  text(pageIndex: number): Promise<PageText> {
    let text = this.#texts.get(pageIndex);
    if (!text) {
      text = this.page(pageIndex).then(readPageText);
      this.#texts.set(pageIndex, text);
    }
    return text;
  }

  /** Drop pdf.js's parsing results for a page that left a viewer's mounted window. */
  releasePage(pageIndex: number): void {
    // The page may never have loaded, or the document may be gone by now.
    this.#pages.get(pageIndex)?.then(
      (page) => page.cleanup(),
      () => {},
    );
  }

  /** What the document permits; everything when it is not encrypted. */
  permissions(): Promise<PdfPermissions> {
    this.#permissions ??= this.proxy.getPermissions().then((flags) => {
      const flag = this.pdfjs.pdfjs.PermissionFlag;
      const has = (value: number) => !flags || flags.has(value);
      const permissions = {
        print: has(flag.PRINT),
        printHighQuality: has(flag.PRINT_HIGH_QUALITY),
        modify: has(flag.MODIFY_CONTENTS),
        copy: has(flag.COPY),
        copyForAccessibility: has(flag.COPY_FOR_ACCESSIBILITY),
        annotate: has(flag.MODIFY_ANNOTATIONS),
        fillForms: has(flag.FILL_INTERACTIVE_FORMS),
        assemble: has(flag.ASSEMBLE),
      };
      return { restricted: Object.values(permissions).includes(false), ...permissions };
    });
    return this.#permissions;
  }

  /** How the document asks to be shown when it opens. */
  initialView(): Promise<PdfInitialView> {
    this.#initialView ??= (async () => {
      const [openAction, pageLayout, pageMode] = await Promise.all([
        this.proxy.getOpenAction() as Promise<Map<string, unknown> | null>,
        this.proxy.getPageLayout(),
        this.proxy.getPageMode(),
      ]);
      const dest = openAction?.get("dest");
      return {
        destination: dest
          ? await resolveExplicit(this.proxy, (index) => this.page(index), dest).catch(() => null)
          : null,
        pageLayout: PAGE_LAYOUTS.has(pageLayout) ? (pageLayout as PdfPageLayout) : null,
        pageMode: PAGE_MODES.has(pageMode) ? (pageMode as PdfPageMode) : null,
      };
    })();
    return this.#initialView;
  }

  /** The document outline (bookmarks); empty when the PDF has none. */
  outline(): Promise<readonly OutlineNode[]> {
    this.#outline ??= this.proxy.getOutline().then(toOutline);
    return this.#outline;
  }

  /** Each page's label, such as "iv" or "A-3"; null when the PDF defines none. */
  pageLabels(): Promise<readonly string[] | null> {
    this.#pageLabels ??= this.proxy
      .getPageLabels()
      // pdf.js returns labels only for documents that define them.
      .then((labels) => (labels && labels.length === this.pageCount ? labels : null));
    return this.#pageLabels;
  }

  /** The document's information dictionary and XMP metadata. */
  metadata(): Promise<PdfMetadata> {
    this.#metadata ??= this.proxy.getMetadata().then(({ info, metadata }) => {
      const fields = info as Record<string, unknown>;
      const { PDFDateString } = this.pdfjs.pdfjs;
      const date = (value: unknown) =>
        typeof value === "string" ? PDFDateString.toDateObject(value) : null;
      return {
        // XMP metadata is newer than the information dictionary when both exist.
        title: text(metadata?.get("dc:title"), fields.Title),
        author: text(metadata?.get("dc:creator"), fields.Author),
        subject: text(metadata?.get("dc:description"), fields.Subject),
        keywords: text(fields.Keywords),
        creator: text(fields.Creator),
        producer: text(fields.Producer),
        creationDate: date(fields.CreationDate),
        modificationDate: date(fields.ModDate),
        pdfVersion: text(fields.PDFFormatVersion),
        language: text(fields.Language),
      };
    });
    return this.#metadata;
  }

  /** The document's embedded files; empty when it has none. */
  attachments(): Promise<readonly PdfAttachment[]> {
    this.#attachments ??= this.proxy.getAttachments().then((attachments) =>
      [...(attachments ?? [])].map(([id, attachment]) => {
        const { filename, description } = attachment as {
          filename?: string;
          description?: string;
        };
        return { id, filename: filename || "unnamed", description: text(description) };
      }),
    );
    return this.#attachments;
  }

  /**
   * Which of the document's layers show, for every viewer of the session: it
   * starts as the document shows them by default, and its changes reach every
   * viewer (`LayerState.subscribe`).
   */
  layers(): Promise<LayerState> {
    this.#layers ??= LayerState.load(this.proxy);
    return this.#layers;
  }

  /** Where a named or explicit destination points; null when it points nowhere. */
  resolveDestination(dest: Destination): Promise<ResolvedDestination | null> {
    return resolveDestination(this.proxy, (index) => this.page(index), dest);
  }

  /** The document's form fields, read and set through pdf.js's annotation storage. */
  get forms(): ReturnType<typeof createFormAccess> {
    this.#forms ??= createFormAccess(this.proxy, (index) => this.page(index));
    return this.#forms;
  }

  /**
   * The document's bytes, with what was typed into its form fields and the
   * annotations an editor created saved in them.
   */
  save(): Promise<Uint8Array> {
    // Without edits, the original bytes; saveDocument() writes form
    // values and the editor's annotations in.
    return this.proxy.annotationStorage.size > 0 ? this.proxy.saveDocument() : this.proxy.getData();
  }

  /** Abort everything started for the session, and destroy the document. */
  close(): Promise<void> {
    this.#controller.abort();
    this.#pages.clear();
    this.#texts.clear();
    return this.#loadingTask.destroy();
  }
}
