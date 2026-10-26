import type * as Pdfjs from "pdfjs-dist";
import type { LayerState } from "../pdfjs/layers.ts";
import { loadPdfjs } from "../pdfjs/loader.ts";
import {
  acquireSession,
  type DocumentState,
  OPENING,
  type PdfjsLoader,
  type SessionLease,
} from "./registry.ts";
import type {
  DocumentSession,
  OutlineNode,
  PdfAttachment,
  PdfInitialView,
  PdfMetadata,
  PdfSource,
} from "./session.ts";
import type { ReadableStore } from "./store.ts";

/**
 * A session's document state as a provider that shows no password prompt
 * sees it: a request for a password is the error pdf.js gives without one.
 * Other providers of the same document may still answer the request.
 */
function withoutPrompt(state: ReadableStore<DocumentState>): ReadableStore<DocumentState> {
  let source: DocumentState | null = null;
  let shown: DocumentState | null = null;
  return {
    get() {
      const current = state.get();
      if (current !== source || !shown) {
        source = current;
        shown =
          current.status === "password"
            ? {
                ...current,
                status: "error",
                passwordReason: null,
                // pdf.js's own messages, as when no prompt is given.
                error:
                  current.passwordReason === "incorrect"
                    ? "PasswordException: Incorrect Password"
                    : "PasswordException: No password given",
              }
            : current;
      }
      return shown;
    },
    subscribe: state.subscribe,
  };
}

/** Connects a session to the registry; see `connectSession()`. */
let connect: (session: PdfSession, pdfjs: PdfjsLoader) => () => void;
/** The loaded document of a session; see `documentOf()`. */
let loaded: (session: PdfSession) => Promise<DocumentSession>;

/**
 * One `<PdfDocument>`'s view of the session of its source, shared by the
 * viewers it shows: the session's document state, the answer to its
 * request for a password, pdf.js's document once ready, and its secondary
 * data, each read once. Its provider creates it as it renders and holds the
 * registry's session for it while mounted; nothing here opens, closes, or
 * releases anything.
 */
export class PdfSession {
  static {
    connect = (session, pdfjs) => session.#connect(pdfjs);
    loaded = (session) => session.#loaded;
  }

  /** The source it shows. */
  readonly source: PdfSource;
  /** Status, progress, the password request, page count, and permissions. */
  readonly state: ReadableStore<DocumentState>;
  /** The registry's session while the provider holds it. */
  #lease: SessionLease | null = null;
  /** The state of the last session held, which `state` reads. */
  #source: ReadableStore<DocumentState> | null = null;
  #unsubscribe: (() => void) | null = null;
  readonly #listeners = new Set<() => void>();
  /** Aborted when the provider lets the session go; the next hold gets another. */
  #control = new AbortController();
  readonly #loaded: Promise<DocumentSession>;
  #resolveLoaded!: (session: Promise<DocumentSession>) => void;
  readonly #reads = new Map<string, Promise<unknown>>();
  #proxy: Pdfjs.PDFDocumentProxy | null = null;

  constructor(source: PdfSource, { passwordPrompt = true }: { passwordPrompt?: boolean } = {}) {
    this.source = source;
    this.#loaded = new Promise((resolve) => {
      this.#resolveLoaded = resolve;
    });
    this.#loaded.then(
      (session) => {
        this.#proxy = session.proxy;
      },
      () => {},
    );
    const held: ReadableStore<DocumentState> = {
      get: () => this.#source?.get() ?? OPENING,
      subscribe: (listener) => {
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
        };
      },
    };
    this.state = passwordPrompt ? held : withoutPrompt(held);
  }

  /**
   * Aborted once the provider lets the session go, or the session closes:
   * what is started for it takes this signal. A provider that holds it again,
   * as StrictMode's second mount does, gives it a new one.
   */
  get signal(): AbortSignal {
    return this.#control.signal;
  }

  /** pdf.js's own document, for its APIs ParaPDF does not wrap; null until it loads. */
  get proxy(): Pdfjs.PDFDocumentProxy | null {
    return this.#proxy;
  }

  /**
   * Try a password for the document while it asks for one (status
   * "password"): a wrong one asks again, with the reason "incorrect". Null
   * stops opening it, which then fails. Without a prompt
   * (`passwordPrompt={false}`), other providers of the document may still ask.
   */
  submitPassword(password: string | null): void {
    this.#lease?.submitPassword(password);
  }

  /** The document outline (bookmarks); empty when it has none or cannot be read. */
  outline(): Promise<readonly OutlineNode[]> {
    return this.#read("outline", (session) => session.outline(), []);
  }

  /** Each page's label, such as "iv"; null when the document defines none. */
  pageLabels(): Promise<readonly string[] | null> {
    return this.#read("pageLabels", (session) => session.pageLabels(), null);
  }

  /** The document's title, author, dates, and so on; null when they cannot be read. */
  metadata(): Promise<PdfMetadata | null> {
    return this.#read("metadata", (session) => session.metadata(), null);
  }

  /** Files embedded in the document; empty when it has none. */
  attachments(): Promise<readonly PdfAttachment[]> {
    return this.#read("attachments", (session) => session.attachments(), []);
  }

  /** Which of the document's layers show, in every viewer of it; null when they cannot be read. */
  layers(): Promise<LayerState | null> {
    return this.#read("layers", (session) => session.layers(), null);
  }

  /** How the document asks to be shown when it opens; null when it cannot be read. */
  initialView(): Promise<PdfInitialView | null> {
    return this.#read("initialView", (session) => session.initialView(), null);
  }

  /**
   * What `read` reads from the loaded document, once for this provider:
   * `fallback` when the read or the document fails, so that a component
   * reading it with `use()` shows nothing rather than failing.
   */
  #read<T>(what: string, read: (session: DocumentSession) => Promise<T>, fallback: T): Promise<T> {
    let reading = this.#reads.get(what) as Promise<T> | undefined;
    if (!reading) {
      reading = this.#loaded.then(read).catch((error: unknown) => {
        if (this.#source?.get().status === "ready") console.error(`loading ${what} failed`, error);
        return fallback;
      });
      this.#reads.set(what, reading);
    }
    return reading;
  }

  /** Hold the registry's session of the source; returns the release. */
  #connect(pdfjs: PdfjsLoader): () => void {
    this.#unsubscribe?.();
    const lease = acquireSession(pdfjs, this.source);
    const control = this.#control;
    // The session closing stops what was started for it, as releasing does.
    lease.signal.addEventListener("abort", () => control.abort(), {
      once: true,
      signal: control.signal,
    });
    this.#lease = lease;
    this.#source = lease.state;
    this.#resolveLoaded(lease.session);
    const notify = () => {
      for (const listener of [...this.#listeners]) listener();
    };
    this.#unsubscribe = lease.state.subscribe(notify);
    notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      if (this.#lease === lease) this.#lease = null;
      lease.release();
      control.abort();
      if (this.#control === control) this.#control = new AbortController();
    };
  }
}

/**
 * Hold the registry's session of `session`'s source until the returned
 * release: what `<PdfDocument>` does while it is mounted. The session
 * closes once nothing holds it, after the registry's grace period.
 */
export function connectSession(session: PdfSession, pdfjs: PdfjsLoader = loadPdfjs): () => void {
  return connect(session, pdfjs);
}

/**
 * The loaded document of `session`, once its provider holds it; rejects
 * when the document cannot be opened.
 */
export function documentOf(session: PdfSession): Promise<DocumentSession> {
  return loaded(session);
}
