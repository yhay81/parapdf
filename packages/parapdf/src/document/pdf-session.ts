import type * as Pdfjs from "pdfjs-dist";
import { loadPdfjs } from "../pdfjs/loader.ts";
import {
  acquireSession,
  type DocumentState,
  OPENING,
  type PdfjsLoader,
  type SessionLease,
  type SharedSession,
  sharedSession,
  splitFragment,
} from "./registry.ts";
import type { DocumentSession, PdfSource } from "./session.ts";
import { type ReadableStore, Store } from "./store.ts";

/**
 * A session's document state as a provider that shows no password prompt
 * sees it: a request for a password is the error pdf.js gives without one.
 * Other providers of the same document may still answer the request.
 */
function withoutPrompt(
  state: ReadableStore<DocumentState>,
  prompts: () => boolean,
): ReadableStore<DocumentState> {
  let source: DocumentState | null = null;
  let shown: DocumentState | null = null;
  return {
    get() {
      const current = state.get();
      if (prompts()) return current;
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

export type AttachmentHandler = (attachment: { filename: string; content: Uint8Array }) => void;

/**
 * One `<PdfDocument>`'s public handle onto the session of its source
 * (`useSession()`): its current `DocumentState` snapshot, the answer to its
 * request for a password, pdf.js's document once ready, and its abort signal.
 * Reactive document state goes through `useDocumentState()`, and secondary
 * document data goes through `useOutline()` and the other Suspense hooks.
 */
export interface PdfSession {
  /** The source it shows, a URL without its fragment. */
  readonly source: PdfSource;
  /** Current snapshot of status, progress, the password request, page count, and permissions. */
  readonly state: DocumentState;
  /** pdf.js's own document, for its APIs ParaPDF does not wrap; null until it loads. */
  readonly proxy: Pdfjs.PDFDocumentProxy | null;
  /**
   * Aborted once the provider lets the session go, or the session closes:
   * what is started for it takes this signal. A provider that holds it again,
   * as StrictMode's second mount does, gives it a new one.
   */
  readonly signal: AbortSignal;
  /**
   * Try a password for the document while it asks for one (status
   * "password"): a wrong one asks again, with the reason "incorrect". Null
   * stops opening it, which then fails. Without a prompt
   * (`passwordPrompt={false}`), other providers of the document may still ask.
   */
  submitPassword(password: string | null): void;
}

const sessionControllers = new WeakSet<PdfSessionController>();

/** Resolve the internal `PdfSessionController` backing a public `PdfSession` handle. */
export function sessionControllerOf(session: PdfSession): PdfSessionController {
  if (!sessionControllers.has(session as PdfSessionController)) {
    throw new TypeError("Expected a PdfSession from <PdfDocument> or useSession()");
  }
  return session as PdfSessionController;
}

/**
 * Internal controller for one `<PdfDocument>`'s view of the session of its
 * source, shared by the viewers it shows: the session's reactive document
 * state store, the answer to its request for a password, pdf.js's document
 * once ready, and its secondary data, each read once. Its provider creates it
 * as it renders, which starts opening the document, and holds the registry's
 * session for it while mounted.
 */
export class PdfSessionController implements PdfSession {
  /** The source it shows, a URL without its fragment. */
  readonly source: PdfSource;
  /** Reactive store of status, progress, the password request, page count, and permissions. */
  readonly stateStore: ReadableStore<DocumentState>;
  /** Loads the pdf.js its document opens with. */
  readonly #pdfjs: PdfjsLoader;
  /**
   * The registry's session it follows: the one its provider holds or held
   * last or, before the first hold, the one its first render started. Its
   * state is what `stateStore` reads, also once the registry closed it.
   */
  #shared: SharedSession | null = null;
  /** Stops hearing `#shared`'s state, which it hears while `stateStore` has listeners. */
  #unwatch: (() => void) | null = null;
  readonly #listeners = new Set<() => void>();
  /** The registry's session while the provider holds it. */
  #lease: SessionLease | null = null;
  /** Aborted when the provider lets the session go; the next hold gets another. */
  #control = new AbortController();
  /** The session of the next hold, for what asks while the provider holds none. */
  #held!: Promise<SharedSession>;
  #resolveHeld!: (shared: SharedSession) => void;
  /** What was read before it followed a session, which the first hold settles. */
  readonly #early = new Map<string, Promise<unknown>>();
  /** Whether a password request shows as such, or as the error pdf.js gives without one. */
  #prompt: boolean;
  /** Accept an answer from a descendant's mount effect before the provider's first hold. */
  #beforeFirstHold = true;
  #earlyAnswer: (() => void) | null = null;
  /** Optional handler `<PdfDocument onOpenAttachment>` sets for embedded files. */
  #openAttachment: AttachmentHandler | undefined;
  /** Where its URL's fragment says to open, which changes without opening the document again. */
  readonly #fragment: Store<{ fragment: string }>;

  constructor(
    source: PdfSource,
    {
      passwordPrompt = true,
      pdfjs = loadPdfjs,
    }: { passwordPrompt?: boolean; pdfjs?: PdfjsLoader } = {},
  ) {
    sessionControllers.add(this);
    const [url, hash] = "url" in source ? splitFragment(source.url) : ["", ""];
    this.source = "url" in source && source.url !== url ? { ...source, url } : source;
    this.#fragment = new Store({ fragment: hash });
    this.#pdfjs = pdfjs;
    this.#prompt = passwordPrompt;
    this.#awaitHold();
    const followed: ReadableStore<DocumentState> = {
      get: () => this.#shared?.state.get() ?? OPENING,
      subscribe: (listener) => {
        this.#listeners.add(listener);
        if (this.#listeners.size === 1) this.#watch();
        return () => {
          if (this.#listeners.delete(listener) && this.#listeners.size === 0) this.#watch();
        };
      },
    };
    this.stateStore = withoutPrompt(followed, () => this.#prompt);
  }

  #awaitHold(): void {
    this.#held = new Promise((resolve) => {
      this.#resolveHeld = resolve;
    });
  }

  readonly #notify = (): void => {
    for (const listener of [...this.#listeners]) listener();
  };

  /**
   * Hear the followed session's state while `stateStore` has listeners, and
   * only then: a provider React rendered but never mounted leaves nothing
   * behind in a session other providers keep open.
   */
  #watch(): void {
    this.#unwatch?.();
    this.#unwatch =
      this.#shared && this.#listeners.size > 0 ? this.#shared.state.subscribe(this.#notify) : null;
  }

  /** Follow `shared` from now on: its state, its document, and what is read from it. */
  #follow(shared: SharedSession): void {
    if (this.#shared === shared) return;
    this.#shared = shared;
    this.#watch();
    this.#notify();
  }

  get state(): DocumentState {
    return this.stateStore.get();
  }

  get signal(): AbortSignal {
    return this.#control.signal;
  }

  get proxy(): Pdfjs.PDFDocumentProxy | null {
    return this.#shared?.proxy ?? null;
  }

  submitPassword(password: string | null): void {
    if (this.#lease) this.#lease.submitPassword(password);
    else if (this.#beforeFirstHold) {
      const request = this.#shared?.passwordRequest;
      if (request) this.#earlyAnswer = () => request.answer(password);
    }
  }

  /**
   * Start opening this session's document, unless it follows one already: what
   * `<PdfDocument>` does as it renders in the browser, so that what a render
   * reads of the document arrives whether or not React has mounted the
   * provider. The registry closes a document no provider comes to hold.
   */
  start(): void {
    // Once: a render never opens again a document that closed, which
    // the provider does when it holds it.
    if (!this.#shared) this.#follow(sharedSession(this.#pdfjs, this.source));
  }

  /**
   * Hold the registry's session of this source until the returned release:
   * what `<PdfDocument>` does while it is mounted. The session closes once
   * nothing holds it, after the registry's grace period, and a later hold
   * opens the document again.
   */
  connect(): () => void {
    const lease = acquireSession(this.#pdfjs, this.source);
    const control = this.#control;
    // The session closing stops what was started for it, as releasing does.
    lease.signal.addEventListener("abort", () => control.abort(), {
      once: true,
      signal: control.signal,
    });
    this.#lease = lease;
    // The session its render started, or another when that one closed or
    // failed meanwhile: its state and what is read from it follow.
    this.#beforeFirstHold = false;
    if (this.#shared === lease.shared) this.#earlyAnswer?.();
    this.#earlyAnswer = null;
    this.#follow(lease.shared);
    this.#resolveHeld(lease.shared);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.#lease === lease) {
        this.#lease = null;
        this.#awaitHold();
      }
      lease.release();
      control.abort();
      if (this.#control === control) this.#control = new AbortController();
    };
  }

  /**
   * The loaded document of the session this provider holds or, while it holds
   * none, of the one it holds next: a viewer may ask before its provider's
   * effect has run, and after the document it showed last has closed. Rejects
   * when the document cannot be opened.
   */
  document(): Promise<DocumentSession> {
    return this.#lease?.session ?? this.#held.then((shared) => shared.session);
  }

  /**
   * The ready document this session currently holds, or null while loading,
   * waiting for a password, failed, or after its provider released it.
   */
  openDocument(): DocumentSession | null {
    const active =
      this.#lease !== null ||
      (this.#beforeFirstHold && this.#shared !== null && !this.#shared.signal.aborted);
    if (!active || this.state.status !== "ready") return null;
    return this.#shared?.document ?? null;
  }

  /**
   * What this session's readers got so far, as an object that is another once
   * they are to read again: the provider holds another session, a password
   * was answered, or a failed read can be retried. Null before it follows a session.
   */
  get reads(): object | null {
    return this.#shared?.reads ?? null;
  }

  /**
   * What `read` reads from the document it follows, once for every provider
   * of that document: `fallback` when the read fails, and while the document
   * failed to open or waits for a password, so that a component reading it
   * with `use()` shows nothing rather than failing or waiting. Such a
   * fallback lasts until the password is answered or the provider holds the
   * document opened again; what is read after that waits for it.
   */
  read<T>(what: string, read: (session: DocumentSession) => Promise<T>, fallback: T): Promise<T> {
    if (this.#shared) return this.#shared.read(what, read, fallback);
    let reading = this.#early.get(what) as Promise<T> | undefined;
    if (!reading) {
      reading = this.#held.then((shared) => shared.read(what, read, fallback));
      this.#early.set(what, reading);
    }
    return reading;
  }

  /**
   * Show password requests as such, or, without a prompt, as the error pdf.js
   * gives without one: `<PdfDocument>`'s `passwordPrompt`, which changes
   * without opening the document again.
   */
  setPasswordPrompt(passwordPrompt: boolean): void {
    if (this.#prompt === passwordPrompt) return;
    this.#prompt = passwordPrompt;
    this.#notify();
  }

  /** Configure how embedded files opened from this session are handled. */
  setOpenAttachment(handler: AttachmentHandler | undefined): void {
    this.#openAttachment = handler;
  }

  /** The handler `<PdfDocument onOpenAttachment>` set on this session, if any. */
  get openAttachmentHandler(): AttachmentHandler | undefined {
    return this.#openAttachment;
  }

  /**
   * The fragment of this session's URL, without its "#": where `<PdfDocument>`'s
   * source says to open, which its viewers follow when it changes.
   */
  get fragment(): ReadableStore<{ fragment: string }> {
    return this.#fragment;
  }

  /** Point this session's fragment elsewhere: a new fragment of `<PdfDocument>`'s source. */
  setFragment(hash: string): void {
    this.#fragment.set({ fragment: hash });
  }
}
