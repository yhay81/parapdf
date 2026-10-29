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
 * Sessions shared by every viewer of the same source. React StrictMode
 * mounts, unmounts, and mounts again, and applications remount viewers when
 * routes or layouts change; without sharing, every mount would download and
 * parse the PDF again. A session closes once its last viewer has released
 * it and no viewer has acquired it again within RELEASE_DELAY_MS; one still
 * loading, or waiting for a password, stops loading then.
 */
const RELEASE_DELAY_MS = 1000;

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

interface Entry {
  session: Promise<DocumentSession>;
  /** The session's AbortController, from before it loads: aborting it stops the load. */
  readonly controller: AbortController;
  readonly listeners: Set<SessionListener>;
  users: number;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
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
}

export interface SessionLease {
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
 * of its bytes. Sources with equal keys share one session; the password is
 * not part of the key.
 */
export const sourceKey = (source: PdfSource): unknown => {
  if (!("url" in source)) return source.data;
  const { httpHeaders, withCredentials } = source;
  const [url] = splitFragment(source.url);
  if (!httpHeaders && withCredentials === undefined) return `url:${url}`;
  const headers = Object.entries(httpHeaders ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return `url:${url} ${JSON.stringify([headers, withCredentials ?? false])}`;
};

function registryOf(pdfjs: PdfjsLoader): Map<unknown, Entry> {
  let registry = registries.get(pdfjs);
  if (!registry) {
    registry = new Map();
    registries.set(pdfjs, registry);
  }
  return registry;
}

function openEntry(pdfjs: PdfjsLoader, source: PdfSource): Entry {
  const entry: Entry = {
    // Replaced at once: opening calls back into the entry before it returns.
    session: new Promise<DocumentSession>(() => {}),
    controller: new AbortController(),
    listeners: new Set(),
    users: 0,
    releaseTimer: undefined,
    progress: null,
    progressQueued: false,
    state: new Store(OPENING),
    passwordRequest: null,
    passwords: new Set(source.password === undefined ? [] : [source.password]),
    nextPassword: undefined,
  };
  entry.session = DocumentSession.open(pdfjs, source, entry.controller, {
    onProgress(loaded, total) {
      entry.progress = { loaded, total };
      for (const listener of entry.listeners) listener.onProgress?.(loaded, total);
      if (entry.progressQueued) return;
      entry.progressQueued = true;
      nextFrame(() => {
        entry.progressQueued = false;
        if (!entry.controller.signal.aborted) entry.state.set({ progress: entry.progress });
      });
    },
    password(reason) {
      return new Promise<string | null>((resolve) => {
        if (entry.controller.signal.aborted) {
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
            entry.state.set({ status: "loading", passwordReason: null });
            resolve(password);
          },
        };
        entry.passwordRequest = request;
        entry.state.set({ status: "password", passwordReason: reason });
        for (const listener of [...entry.listeners]) {
          // A listener may answer, or add another viewer that answers, at once.
          if (entry.passwordRequest !== request) break;
          listener.onPassword?.(reason);
        }
      });
    },
  });
  // Ready once the permissions are read too: viewers follow them from their first layout.
  entry.session.then(
    async (session) => {
      const permissions = await session.permissions().catch((error: unknown) => {
        console.error("reading permissions failed", error);
        return null;
      });
      if (entry.controller.signal.aborted) return;
      entry.state.set({
        status: "ready",
        passwordReason: null,
        pageCount: session.pageCount,
        permissions,
      });
    },
    (error: unknown) => {
      entry.state.set({ status: "error", error: String(error), passwordReason: null });
    },
  );
  return entry;
}

/**
 * The session of the document `source` names, opened once for every viewer
 * of it with the pdf.js `pdfjs` loads, those that edit annotations included.
 */
export function acquireSession(
  pdfjs: PdfjsLoader,
  source: PdfSource,
  listener: SessionListener = {},
): SessionLease {
  const registry = registryOf(pdfjs);
  const key = sourceKey(source);
  let entry = registry.get(key);
  if (entry) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
  } else {
    const created = openEntry(pdfjs, source);
    registry.set(key, created);
    // Forget a failed open at once, so the next viewer tries again.
    created.session.catch(() => {
      if (registry.get(key) === created) registry.delete(key);
    });
    entry = created;
  }
  const held = entry;
  held.users++;
  held.listeners.add(listener);
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
  held.controller.signal.addEventListener("abort", () => lease.abort(), {
    once: true,
    signal: lease.signal,
  });
  let released = false;
  return {
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
      if (held.users > 0) return;
      held.releaseTimer = setTimeout(() => {
        if (held.users > 0 || registry.get(key) !== held) return;
        registry.delete(key);
        // Stops a load still in progress, or waiting for a password.
        held.controller.abort();
        held.passwordRequest?.answer(null);
        held.session
          .then((session) => closeSession(session))
          .catch(() => {
            // The document failed to open, or destroying it failed: nothing is left to free.
          });
      }, RELEASE_DELAY_MS);
    },
  };
}
