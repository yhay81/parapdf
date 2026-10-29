import type * as Pdfjs from "pdfjs-dist";
import {
  type Destination,
  type ResolvedDestination,
  resolveDestination,
  resolveExplicit,
} from "../pdfjs/destinations.ts";
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

/**
 * Pages to save, as pdf.js's `extractPages()` takes them: each entry the
 * pages of this document (`document` left out) or of another one's bytes,
 * as `includePages` and `excludePages` choose them (0-based indices and
 * `[first, last]` ranges), or an `image` as a page.
 */
export type PdfPageSelection = Parameters<Pdfjs.PDFDocumentProxy["extractPages"]>[0];

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

/**
 * The document's information dictionary and XMP metadata, as far as it has
 * them, and what pdf.js reads about the file beside them.
 */
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
  /** The file name the server gives (`Content-Disposition`). */
  filename: string | null;
  /** The file's length in bytes, when it can be read. */
  length: number | null;
  /** Whether the file is linearized (Fast Web View). */
  linearized: boolean;
  /**
   * Identifies the document, from the ID in its trailer or its bytes, as
   * pdf.js's viewer keeps each document's last view under it.
   */
  fingerprint: string;
}

/** A file embedded in the document. */
export interface PdfAttachment {
  /** Identifies it for `getAttachmentContent`. */
  id: string;
  /** The file's name without a path. */
  filename: string;
  description: string | null;
}

/**
 * A comment of the file: a note's text, or another markup annotation's
 * popup note, as its author left it.
 */
export interface PdfComment {
  /** pdf.js's id of the annotation that carries it, such as "12R". */
  id: string;
  pageIndex: number;
  /** The annotation's rectangle in PDF points from the page's bottom left: [x1, y1, x2, y2]. */
  rect: readonly [number, number, number, number];
  /** The annotation it is on: "Text" for a note, "Highlight", "Ink", and so on (its /Subtype). */
  subtype: string;
  text: string;
  author: string | null;
  /** When it was last changed, or else created; null when the file says neither. */
  date: Date | null;
  /** The `id` of the comment it answers; null for one of its own. */
  replyTo: string | null;
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

/** How each session closes, which only the registry asks for (`closeSession()`). */
const closers = new WeakMap<DocumentSession, () => Promise<void>>();

/**
 * One open document, shared by every viewer of its source (see
 * registry.ts): pdf.js's document and its pages, and what the viewers read
 * from them, each read once: the pages' sizes, their text, permissions, the
 * initial view, the outline, page labels, metadata, attachments, and which
 * layers show. The session owns an AbortController: closing it
 * (`closeSession()`, which the registry does) aborts its `signal`, which
 * everything started for the session takes, and destroys the document.
 */
export class DocumentSession {
  /** pdf.js, as the document was opened with it. */
  readonly pdfjs: LoadedPdfjs;
  /** pdf.js's own document, for its APIs ParaPDF does not wrap. */
  readonly proxy: Pdfjs.PDFDocumentProxy;
  readonly pageCount: number;
  /** Aborted once the session closes. */
  readonly signal: AbortSignal;
  readonly #pages = new Map<number, Promise<Pdfjs.PDFPageProxy>>();
  /** How many viewers show each page now (see `holdPage()`). */
  readonly #holds = new Map<number, number>();
  readonly #texts = new Map<number, Promise<PageText>>();
  /**
   * What the session read from the document, by what it is, for every
   * viewer: kept while the read succeeds, and asked for again after it fails.
   */
  readonly #reads = new Map<string, Promise<unknown>>();
  /** What finishes the edits in progress in the session's viewers; see `commit()`. */
  readonly #commits = new Set<() => void>();
  /** The password that opened this document, for reopening its saved bytes when extracting pages. */
  readonly #password: string | undefined;
  /** Every page's size, once the background pass has learned them. */
  #sizes: readonly PageSize[] | null = null;

  private constructor(
    pdfjs: LoadedPdfjs,
    loadingTask: Pdfjs.PDFDocumentLoadingTask,
    proxy: Pdfjs.PDFDocumentProxy,
    controller: AbortController,
    password: string | undefined,
  ) {
    this.pdfjs = pdfjs;
    this.proxy = proxy;
    this.pageCount = proxy.numPages;
    this.signal = controller.signal;
    this.#password = password;
    closers.set(this, () => {
      controller.abort();
      this.#pages.clear();
      this.#texts.clear();
      return loadingTask.destroy();
    });
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
    let password = source.password;
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
          (answer) => {
            password = answer ?? undefined;
            update(
              answer ??
                // pdf.js's own exception class, so the failure reads like any other.
                (new pdfjs.PasswordException("No password was given.", code) as unknown as Error),
            );
          },
          (error: unknown) => update(error instanceof Error ? error : new Error(String(error))),
        );
      };
    }
    // Aborting stops a load in progress; a loaded document is destroyed by closeSession().
    const abort = () => void loadingTask.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const proxy = await loadingTask.promise;
      // Aborted while it loaded: the loading task, and the document with it, is destroyed.
      signal.throwIfAborted();
      return new DocumentSession(loaded, loadingTask, proxy, controller, password);
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
    return this.#once("sizes", async () => {
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
    });
  }

  /**
   * The text of page `pageIndex`, read once in pdf.js's worker, for search,
   * `getText()`, and scrolling to matches before the page's text layer exists.
   */
  text(pageIndex: number): Promise<PageText> {
    let text = this.#texts.get(pageIndex);
    if (!text) {
      text = this.page(pageIndex)
        .then(readPageText)
        .catch((error: unknown) => {
          this.#texts.delete(pageIndex);
          throw error;
        });
      this.#texts.set(pageIndex, text);
    }
    return text;
  }

  /** A viewer mounted page `pageIndex`: its parsing results stay until no viewer shows it. */
  holdPage(pageIndex: number): void {
    this.#holds.set(pageIndex, (this.#holds.get(pageIndex) ?? 0) + 1);
  }

  /**
   * A viewer's page `pageIndex` left its mounted window: once no viewer shows
   * it, pdf.js's parsing results of the page are dropped.
   */
  releasePage(pageIndex: number): void {
    const holds = (this.#holds.get(pageIndex) ?? 0) - 1;
    if (holds > 0) {
      this.#holds.set(pageIndex, holds);
      return;
    }
    this.#holds.delete(pageIndex);
    // The page may never have loaded, or the document may be gone by now,
    // and a viewer may show the page again first.
    this.#pages.get(pageIndex)?.then(
      (page) => {
        if (!this.#holds.has(pageIndex)) page.cleanup();
      },
      () => {},
    );
  }

  /** What the document permits; everything when it is not encrypted. */
  permissions(): Promise<PdfPermissions> {
    return this.#once("permissions", async () => {
      const flags = await this.proxy.getPermissions();
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
  }

  /** How the document asks to be shown when it opens. */
  initialView(): Promise<PdfInitialView> {
    return this.#once("initialView", async () => {
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
    });
  }

  /** The page order the document asks for in /ViewerPreferences /Direction; null where it asks none. */
  direction(): Promise<"ltr" | "rtl" | null> {
    return this.#once("direction", async () => {
      // pdf.js gives the preferences there are as a Map, or null.
      const preferences = (await this.proxy.getViewerPreferences()) as Map<string, unknown> | null;
      const direction = preferences?.get("Direction");
      return direction === "R2L" ? "rtl" : direction === "L2R" ? "ltr" : null;
    });
  }

  /** The document outline (bookmarks); empty when the PDF has none. */
  outline(): Promise<readonly OutlineNode[]> {
    return this.#once("outline", async () => toOutline(await this.proxy.getOutline()));
  }

  /** Each page's label, such as "iv" or "A-3"; null when the PDF defines none. */
  pageLabels(): Promise<readonly string[] | null> {
    return this.#once("pageLabels", async () => {
      const labels = await this.proxy.getPageLabels();
      // pdf.js returns labels only for documents that define them.
      return labels && labels.length === this.pageCount ? labels : null;
    });
  }

  /** The document's information dictionary and XMP metadata. */
  metadata(): Promise<PdfMetadata> {
    return this.#once("metadata", async () => {
      const { info, metadata, contentDispositionFilename, contentLength } =
        (await this.proxy.getMetadata()) as Awaited<
          ReturnType<Pdfjs.PDFDocumentProxy["getMetadata"]>
        > & { contentDispositionFilename?: string | null; contentLength?: number | null };
      const fields = info as Record<string, unknown>;
      const { PDFDateString } = this.pdfjs.pdfjs;
      const date = (value: unknown) =>
        typeof value === "string" ? PDFDateString.toDateObject(value) : null;
      // pdf.js reports no length for bytes and zero when the response has no
      // Content-Length. Once loaded, its download info has the actual size.
      const length =
        contentLength || (await this.proxy.getDownloadInfo().catch(() => null))?.length;
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
        filename: contentDispositionFilename || null,
        length: length ?? null,
        linearized: fields.IsLinearized === true,
        fingerprint: this.proxy.fingerprints[0] ?? "",
      };
    });
  }

  /** The document's embedded files; empty when it has none. */
  attachments(): Promise<readonly PdfAttachment[]> {
    return this.#once("attachments", async () =>
      [...((await this.proxy.getAttachments()) ?? [])].map(([id, attachment]) => {
        const { filename, description } = attachment as {
          filename?: string;
          description?: string;
        };
        return { id, filename: filename || "unnamed", description: text(description) };
      }),
    );
  }

  /**
   * The file's comments, in page order: its markup annotations that carry
   * one, read across the pages at once. A free text annotation's text is
   * what it shows, not a comment; annotations grouped with another share
   * that one's comment.
   */
  comments(): Promise<readonly PdfComment[]> {
    return this.#once("comments", async () => {
      const { AnnotationType: type, PDFDateString } = this.pdfjs.pdfjs;
      const markups = new Set([
        type.TEXT,
        type.LINE,
        type.SQUARE,
        type.CIRCLE,
        type.POLYGON,
        type.POLYLINE,
        type.HIGHLIGHT,
        type.UNDERLINE,
        type.SQUIGGLY,
        type.STRIKEOUT,
        type.STAMP,
        type.CARET,
        type.INK,
        type.FILEATTACHMENT,
      ]);
      const annotations = ((await this.proxy.getAnnotationsByType(markups, new Set())) ?? []) as {
        id: string;
        pageIndex: number;
        rect: [number, number, number, number];
        subtype: string;
        contentsObj?: { str?: string };
        titleObj?: { str?: string };
        modificationDate?: string | null;
        creationDate?: string | null;
        inReplyTo?: string | null;
        replyType?: string;
      }[];
      return annotations
        .filter(({ contentsObj, replyType }) => contentsObj?.str?.trim() && replyType !== "Group")
        .map((annotation) => {
          const date = annotation.modificationDate ?? annotation.creationDate;
          return {
            id: annotation.id,
            pageIndex: annotation.pageIndex,
            rect: annotation.rect,
            subtype: annotation.subtype,
            text: annotation.contentsObj?.str ?? "",
            author: text(annotation.titleObj?.str),
            date: date ? PDFDateString.toDateObject(date) : null,
            replyTo: annotation.inReplyTo ?? null,
          };
        })
        .sort((a, b) => a.pageIndex - b.pageIndex);
    });
  }

  /**
   * Which of the document's layers show, for every viewer of the session: it
   * starts as the document shows them by default, and its changes reach every
   * viewer (`LayerState.subscribe`).
   */
  layers(): Promise<LayerState> {
    return this.#once("layers", () => LayerState.load(this.proxy));
  }

  /** Where a named or explicit destination points; null when it points nowhere. */
  resolveDestination(dest: Destination): Promise<ResolvedDestination | null> {
    return resolveDestination(this.proxy, (index) => this.page(index), dest);
  }

  /**
   * Call `commit` at each `commit()` until `signal` aborts: a viewer's
   * annotation editor finishes what the reader is typing or drawing there.
   */
  onCommit(commit: () => void, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.#commits.add(commit);
    signal.addEventListener("abort", () => this.#commits.delete(commit), { once: true });
  }

  /** Finish the edits in progress in every viewer of the document, before saving or printing. */
  commit(): void {
    for (const commit of this.#commits) commit();
  }

  /**
   * The document's bytes, or a new document of the `pages` chosen, with what
   * was typed into its form fields and the annotations an editor created
   * saved in them.
   */
  async save(pages?: PdfPageSelection): Promise<Uint8Array> {
    if (pages) {
      // pdf.js's extractPages() writes the editors' annotations into this
      // document's pages but not its fields' values: once something was
      // typed or drawn, its pages come from its saved bytes, which have both.
      // pdf.js takes this document's pages from an entry whose `document` is
      // null, and leaves out one without it.
      const own = this.proxy.annotationStorage.size > 0 ? await this.proxy.saveDocument() : null;
      return this.proxy.extractPages(
        pages.map((entry) =>
          entry.document == null && !entry.image
            ? {
                ...entry,
                document: own,
                ...(own && this.#password ? { password: this.#password } : {}),
              }
            : entry,
        ),
      );
    }
    // Without edits, the original bytes; saveDocument() writes form
    // values and the editor's annotations in.
    return this.proxy.annotationStorage.size > 0 ? this.proxy.saveDocument() : this.proxy.getData();
  }

  /** `read()`'s promise, shared until it fails: the next caller then reads again. */
  #once<T>(what: string, read: () => Promise<T>): Promise<T> {
    let reading = this.#reads.get(what) as Promise<T> | undefined;
    if (!reading) {
      const started = read();
      reading = started;
      this.#reads.set(what, started);
      started.catch(() => {
        if (this.#reads.get(what) === started) this.#reads.delete(what);
      });
    }
    return reading;
  }
}

/**
 * Abort everything started for `session`, and destroy its document: the
 * registry's to do, once no viewer uses the session.
 */
export function closeSession(session: DocumentSession): Promise<void> {
  return closers.get(session)?.() ?? Promise.resolve();
}
