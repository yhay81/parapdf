import type { LoadedPdfjs } from "../pdfjs/loader.ts";
import {
  closeSession,
  DocumentSession,
  type PasswordReason,
  type PdfPermissions,
  type PdfSource,
} from "./session.ts";
import { type ReadableStore, Store } from "./store.ts";

/**
 * Sessions shared by everything that shows the same source. React renders a
 * provider before it mounts it, and may render it again from nothing or
 * never mount it; StrictMode mounts, unmounts, and mounts again, and
 * applications remount viewers when routes or layouts change. Without
 * sharing, each of those would download and parse the PDF again.
 *
 * A session opens the first time a render or a viewer asks for it
 * (`sharedSession()`), and leases hold it (`acquireSession()`). It closes
 * once its last lease is released and none is acquired again within
 * RELEASE_DELAY_MS; one still loading, or waiting for a password, stops
 * loading then.
 */
const RELEASE_DELAY_MS = 1000;

/**
 * How long a session no lease holds stays open after a render asked for it,
 * counted from the moment it is at rest: no longer loading, and with nothing
 * being read from it. It is the time that render has to mount and hold it.
 * One that mounts later, having waited longer than this for something else,
 * opens the document again; one that never mounts costs the document's load
 * and this long of its memory.
 */
const UNHELD_DELAY_MS = 10_000;

/** Loads the pdf.js sessions open with: `loadPdfjs`, or one a test stands in for. */
export type PdfjsLoader = () => Promise<LoadedPdfjs>;

export interface LoadProgress {
  loaded: number;
  total: number | null;
}

/** What a session publishes about its document, from the moment it starts to open. */
export interface DocumentState {
  /**
   * "password" while an encrypted document waits for a password;
   * `passwordReason` says whether one is needed or the last one was wrong.
   * "ready" once pdf.js's document and its permissions are read.
   */
  status: "loading" | "password" | "ready" | "error";
  error: string | null;
  passwordReason: PasswordReason | null;
  /**
   * Bytes of the document received so far, and its size when the server
   * reported it; null before any arrive. pdf.js may keep fetching the rest
   * of a large document in the background after it is ready.
   */
  progress: LoadProgress | null;
  /** 0 until the document is ready. */
  pageCount: number;
  /**
   * What the document permits, everything when it is not encrypted; null
   * until it is ready, and when reading them failed.
   */
  permissions: PdfPermissions | null;
}

/** A session's state as it starts to open. */
export const OPENING: DocumentState = {
  status: "loading",
  error: null,
  passwordReason: null,
  progress: null,
  pageCount: 0,
  permissions: null,
};

/** Progress arrives many times a frame; the session's store hears of it once a frame. */
const nextFrame = (callback: () => void): void => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

/** What a viewer hears about a document while it loads. */
export interface SessionListener {
  onProgress?(loaded: number, total: number | null): void;
  /** The document needs a password: any viewer of it may submit one. */
  onPassword?(reason: PasswordReason): void;
}

/**
 * A session as the registry shares it, for what reads it without holding
 * it: a provider as it renders, before React mounts it.
 */
export interface SharedSession {
  /** The shared session; rejects when the document cannot be opened. */
  readonly session: Promise<DocumentSession>;
  /** pdf.js's document as soon as it opens, including for a provider joining later. */
  readonly proxy: DocumentSession["proxy"] | null;
  /** The current password request. Only this request accepts its answer. */
  readonly passwordRequest: { answer(password: string | null): void } | null;
  /** The session's document state, which everything that shows it reads. */
  readonly state: ReadableStore<DocumentState>;
  /** Aborted once the registry closed the session. */
  readonly signal: AbortSignal;
  /**
   * What `read` reads from the document, once for every reader of `what`:
   * the same promise each time, so that a component reading it with `use()`
   * renders with it however often React renders it anew. `fallback` when
   * the read fails, and while the document cannot be read (it failed to
   * open, waits for a password, or closed), so that the component renders
   * what the document's state says instead of waiting.
   */
  read<T>(what: string, read: (session: DocumentSession) => Promise<T>, fallback: T): Promise<T>;
  /**
   * What its readers got so far. Another object once they are to read
   * again: a password was answered, and what settled empty waits for the
   * document.
   */
  readonly reads: object;
}

interface Entry {
  session: Promise<DocumentSession>;
  proxy: DocumentSession["proxy"] | null;
  /** The session's AbortController, from before it loads: aborting it stops the load. */
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly listeners: Set<SessionListener>;
  /** The leases that hold it. */
  users: number;
  /** Closes the session; none while leases hold it, or while it works for a render. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** True after the last release, until a new render or lease asks for the document. */
  released: boolean;
  /** The latest progress, for viewers that join while the document loads. */
  progress: LoadProgress | null;
  /** Whether the latest progress waits for the next frame to be published. */
  progressQueued: boolean;
  /** The session's document state, which every viewer of it reads. */
  readonly state: Store<DocumentState>;
  /** pdf.js's request for a password, until a viewer answers it. */
  passwordRequest: { reason: PasswordReason; answer(password: string | null): void } | null;
  /** Passwords already tried, so remounting never resubmits the same failed value. */
  readonly passwords: Set<string>;
  /** A new source password supplied before pdf.js asks for one. */
  nextPassword: string | undefined;
  /** What was read from the document, by name. */
  readonly documentReads: Map<string, Promise<unknown>>;
  /** What readers got: the document's, or their fallback while it could not be read. */
  reads: Map<string, Promise<unknown>>;
  /** Data reads that a newly mounted provider may retry. */
  readonly failedReads: Set<string>;
  /** How many of `reads` have not settled. */
  reading: number;
  /** Resolves once the document cannot be read, which settles what is read from it. */
  unreadable: Promise<void>;
  markUnreadable: () => void;
  read: SharedSession["read"];
}

export interface SessionLease {
  /** The session held, as everything that reads it sees it. */
  readonly shared: SharedSession;
  /** The shared session; rejects when the document cannot be opened. */
  readonly session: Promise<DocumentSession>;
  /** The session's document state, shared by every lease of it. */
  readonly state: ReadableStore<DocumentState>;
  /**
   * Aborted once the lease is released, or its session closes: what a
   * viewer starts for the document takes it, and stops with it.
   */
  readonly signal: AbortSignal;
  /** Gives the session back. Call it once, even before the document loads. */
  release(): void;
  /**
   * Answers the document's request for a password: the password to try, or
   * null to stop opening it. Nothing happens while no request is pending.
   */
  submitPassword(password: string | null): void;
}

/** Sessions by source, for each pdf.js loader. */
const registries = new WeakMap<object, Map<unknown, Entry>>();

/** A URL without its fragment, and the fragment without its "#" (empty when it has none). */
export function splitFragment(url: string): [url: string, fragment: string] {
  const hash = url.indexOf("#");
  return hash < 0 ? [url, ""] : [url.slice(0, hash), url.slice(hash + 1)];
}

/**
 * What identifies a source: its URL without its fragment, which says where
 * to open, with the request's headers and credentials mode, or the identity
 * of its bytes or its transport. Sources with equal keys share one session; the password is
 * not part of the key.
 */
export const sourceKey = (source: PdfSource): unknown => {
  if ("data" in source) return source.data;
  if ("range" in source) return source.range;
  const { httpHeaders, withCredentials } = source;
  const [url] = splitFragment(source.url);
  if (!httpHeaders && withCredentials === undefined) return `url:${url}`;
  // An omitted header set inherits documentOptions; an empty one replaces it.
  const headers = httpHeaders
    ? Object.entries(httpHeaders).sort(([a], [b]) => (a < b ? -1 : 1))
    : null;
  // A source that leaves its credentials mode out takes the loader's documentOptions.
  return `request:${JSON.stringify([url, headers, withCredentials ?? null])}`;
};

function registryOf(pdfjs: PdfjsLoader): Map<unknown, Entry> {
  let registry = registries.get(pdfjs);
  if (!registry) {
    registry = new Map();
    registries.set(pdfjs, registry);
  }
  return registry;
}

/** From now on, what is read waits for the document; what settled empty is read anew. */
function readAnew(entry: Entry): void {
  entry.reads = new Map();
  entry.unreadable = new Promise((resolve) => {
    entry.markUnreadable = resolve;
  });
}

/** Close `entry`, whatever it was doing, and forget it. */
function closeEntry(registry: Map<unknown, Entry>, key: unknown, entry: Entry): void {
  // A failed session was forgotten already, and another may have its place.
  if (registry.get(key) === entry) registry.delete(key);
  // Stops a load still in progress, or waiting for a password.
  entry.proxy = null;
  entry.controller.abort();
  entry.passwordRequest?.answer(null);
  entry.markUnreadable();
  entry.session
    .then((session) => closeSession(session))
    .catch(() => {
      // The document failed to open, or destroying it failed: nothing is left to free.
    });
}

/** Close `entry` in `delay` ms, unless a lease holds it by then. */
function closeAfter(
  registry: Map<unknown, Entry>,
  key: unknown,
  entry: Entry,
  delay: number,
): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (entry.users === 0) closeEntry(registry, key, entry);
  }, delay);
}

/**
 * `entry` may have come to rest: when no lease holds it and nothing closes
 * it yet, it closes after the time a render has to hold it.
 */
function rested(registry: Map<unknown, Entry>, key: unknown, entry: Entry): void {
  if (entry.users > 0 || entry.timer !== undefined || entry.signal.aborted) return;
  if (entry.state.get().status === "loading" || entry.reading > 0) return;
  closeAfter(registry, key, entry, UNHELD_DELAY_MS);
}

function openEntry(
  registry: Map<unknown, Entry>,
  key: unknown,
  pdfjs: PdfjsLoader,
  source: PdfSource,
): Entry {
  const controller = new AbortController();
  const entry: Entry = {
    // Replaced at once: opening calls back into the entry before it returns.
    session: new Promise<DocumentSession>(() => {}),
    proxy: null,
    controller,
    signal: controller.signal,
    listeners: new Set(),
    users: 0,
    timer: undefined,
    released: false,
    progress: null,
    progressQueued: false,
    state: new Store(OPENING),
    passwordRequest: null,
    passwords: new Set(source.password === undefined ? [] : [source.password]),
    nextPassword: undefined,
    documentReads: new Map(),
    failedReads: new Set(),
    reads: new Map(),
    reading: 0,
    // Replaced at once, with `reads`.
    unreadable: Promise.resolve(),
    markUnreadable: () => {},
    read<T>(what: string, read: (session: DocumentSession) => Promise<T>, fallback: T) {
      let reading = entry.reads.get(what) as Promise<T> | undefined;
      if (reading) return reading;
      if (entry.signal.aborted) reading = Promise.resolve(fallback);
      else {
        let fromDocument = entry.documentReads.get(what) as Promise<T> | undefined;
        if (!fromDocument) {
          fromDocument = entry.session.then(read);
          entry.documentReads.set(what, fromDocument);
        }
        const unreadable = entry.unreadable.then(() => fallback);
        reading = Promise.race([fromDocument, unreadable]).catch((error: unknown) => {
          // A document that failed or closed says so in its state.
          if (!entry.signal.aborted && entry.proxy) {
            entry.failedReads.add(what);
            console.error(`loading ${what} failed`, error);
          }
          return fallback;
        });
        // A render may wait for it: the session stays open until it settles.
        if (!entry.released && entry.timer !== undefined) {
          clearTimeout(entry.timer);
          entry.timer = undefined;
        }
        entry.reading++;
        reading.then(() => {
          entry.reading--;
          rested(registry, key, entry);
        });
      }
      entry.reads.set(what, reading);
      return reading;
    },
  };
  readAnew(entry);
  registry.set(key, entry);
  entry.session = DocumentSession.open(pdfjs, source, controller, {
    onProgress(loaded, total) {
      entry.progress = { loaded, total };
      for (const listener of entry.listeners) listener.onProgress?.(loaded, total);
      if (entry.progressQueued) return;
      entry.progressQueued = true;
      nextFrame(() => {
        entry.progressQueued = false;
        if (!entry.signal.aborted) entry.state.set({ progress: entry.progress });
      });
    },
    password(reason) {
      return new Promise<string | null>((resolve) => {
        if (entry.signal.aborted) {
          resolve(null);
          return;
        }
        if (entry.nextPassword !== undefined) {
          const password = entry.nextPassword;
          entry.nextPassword = undefined;
          entry.passwords.add(password);
          resolve(password);
          return;
        }
        const request = {
          reason,
          answer(password: string | null) {
            if (entry.passwordRequest !== request) return;
            entry.passwordRequest = null;
            entry.nextPassword = undefined;
            if (password !== null) entry.passwords.add(password);
            readAnew(entry);
            entry.state.set({ status: "loading", passwordReason: null });
            resolve(password);
          },
        };
        entry.passwordRequest = request;
        entry.markUnreadable();
        entry.state.set({ status: "password", passwordReason: reason });
        for (const listener of [...entry.listeners]) {
          // A listener may answer, or add another viewer that answers, at once.
          if (entry.passwordRequest !== request) break;
          listener.onPassword?.(reason);
        }
        rested(registry, key, entry);
      });
    },
  });
  // Ready once the permissions are read too: viewers follow them from their first layout.
  entry.session.then(
    async (session) => {
      if (entry.signal.aborted) return;
      entry.proxy = session.proxy;
      const permissions = await session.permissions().catch((error: unknown) => {
        console.error("reading permissions failed", error);
        return null;
      });
      if (entry.signal.aborted) return;
      entry.state.set({
        status: "ready",
        passwordReason: null,
        pageCount: session.pageCount,
        permissions,
      });
      rested(registry, key, entry);
    },
    (error: unknown) => {
      // A session closed while it opened failed for no viewer.
      if (entry.signal.aborted) return;
      entry.markUnreadable();
      entry.state.set({ status: "error", error: String(error), passwordReason: null });
      // The viewers that hold it show the failure, and the next one tries
      // again. Held by none yet, it stays for the render that opened it to
      // show: one React renders anew after each failure would otherwise
      // open the document without end.
      if (entry.users === 0) rested(registry, key, entry);
      else if (registry.get(key) === entry) registry.delete(key);
    },
  );
  return entry;
}

/**
 * The session of the document `source` names, opened with the pdf.js
 * `pdfjs` loads unless it is open, for what reads it without holding it. It
 * stays open while it loads and while what was asked of it is read, and
 * then for the time the render that asked has to hold it (`acquireSession()`).
 */
export function sharedSession(pdfjs: PdfjsLoader, source: PdfSource): SharedSession {
  const registry = registryOf(pdfjs);
  const key = sourceKey(source);
  const entry = registry.get(key) ?? openEntry(registry, key, pdfjs, source);
  if (entry.users === 0) {
    // Released or at rest, it was about to close: this render gets its own time.
    entry.released = false;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    rested(registry, key, entry);
  }
  return entry;
}

/**
 * Hold the session of the document `source` names, opened once for every
 * viewer of it with the pdf.js `pdfjs` loads, those that edit annotations
 * included, until the lease is released.
 */
export function acquireSession(
  pdfjs: PdfjsLoader,
  source: PdfSource,
  listener: SessionListener = {},
): SessionLease {
  const registry = registryOf(pdfjs);
  const key = sourceKey(source);
  const held = registry.get(key) ?? openEntry(registry, key, pdfjs, source);
  clearTimeout(held.timer);
  held.timer = undefined;
  held.released = false;
  held.users++;
  held.listeners.add(listener);
  // A failure waited for the render that opened it. Held, it is forgotten,
  // so that the next viewer tries again.
  if (held.state.get().status === "error") registry.delete(key);
  // Keep failures stable while React retries a suspended render. Once a
  // provider commits, it and the other readers can try the failed reads
  // again; successful and pending promises keep their identity.
  if (held.failedReads.size > 0) {
    held.reads = new Map(held.reads);
    for (const what of held.failedReads) {
      held.documentReads.delete(what);
      held.reads.delete(what);
    }
    held.failedReads.clear();
    held.state.publish();
  }
  // A changed password retries the shared load, including while pdf.js has
  // not asked yet. Answer a pending request before replaying its old error.
  if (source.password !== undefined && !held.passwords.has(source.password)) {
    held.nextPassword = source.password;
    held.passwordRequest?.answer(source.password);
  }
  // A viewer that joins late hears what the others already heard.
  if (held.progress) listener.onProgress?.(held.progress.loaded, held.progress.total);
  if (held.passwordRequest) listener.onPassword?.(held.passwordRequest.reason);
  const lease = new AbortController();
  // A lease ends with its session.
  held.signal.addEventListener("abort", () => lease.abort(), {
    once: true,
    signal: lease.signal,
  });
  let released = false;
  return {
    shared: held,
    session: held.session,
    state: held.state,
    signal: lease.signal,
    submitPassword(password) {
      if (!released) held.passwordRequest?.answer(password);
    },
    release() {
      if (released) return;
      released = true;
      lease.abort();
      held.listeners.delete(listener);
      held.users--;
      if (held.users === 0) {
        held.released = true;
        closeAfter(registry, key, held, RELEASE_DELAY_MS);
      }
    },
  };
}
