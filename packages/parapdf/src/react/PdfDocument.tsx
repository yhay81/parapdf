"use client";

import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import {
  type AttachmentHandler,
  connectSession,
  PdfSession,
  setFragment,
  setOpenAttachment,
  setPasswordPrompt,
  startSession,
} from "../document/pdf-session.ts";
import { sourceKey, splitFragment } from "../document/registry.ts";
import type { PdfSource } from "../document/session.ts";
import { preloadPdfjs } from "../pdfjs/loader.ts";
import { holdViewer, Viewer } from "../view/viewer.ts";
import { SessionContext, ViewerContext } from "./context.ts";
import { preloadSourceFetch } from "./preload.ts";

export interface PdfDocumentProps {
  /**
   * The document to show: its URL, `{ url }`, or `{ data }` with its bytes.
   * It reopens when its URL, request headers, or password change or, for
   * data, when the bytes are another object or the password changes; a new
   * object for the same URL keeps the open document. A URL's fragment, such
   * as `#page=3`, opens it where it points (RFC 8118's `page`, `zoom`, and
   * `nameddest`), and a new one moves its viewers there.
   */
  source: string | PdfSource;
  /**
   * The default viewer `<PdfDocument>` gives its children through
   * `useViewer()`, from `useCreateViewer()`, when a component above
   * `<PdfDocument>` acts through it; without it, `<PdfDocument>` creates one
   * of its own.
   */
  viewer?: Viewer;
  /**
   * Whether an encrypted document waits for a password (status "password",
   * the default), which `useSession().submitPassword()` gives, or fails at
   * once (status "error") when its source has no password or a wrong one,
   * for applications that show no password prompt.
   */
  passwordPrompt?: boolean;
  /**
   * Called when the reader opens a file attachment annotation, a link to an
   * embedded file, or `openAttachment(session, attachment)`. By default the
   * browser downloads the file.
   */
  onOpenAttachment?: AttachmentHandler;
  children?: ReactNode;
}

/** A provider's session of a source, created as it renders. */
interface Held {
  readonly key: unknown;
  readonly password: string | undefined;
  readonly session: PdfSession;
}

/**
 * Opens `source` as it renders, or joins the session other providers
 * opened of it, and gives that session and a default `Viewer` to its
 * children, which it renders at once: `<PdfViewer>`, thumbnails, and the
 * application's own controls (`useViewer()`, `useViewState()`). Multiple
 * independent views of the same document wrap each pane in `<PdfView>`.
 * Viewers of one provider share its session, which the provider holds while
 * it is mounted and shown; the document closes once no provider holds it,
 * and opens again for one React shows again.
 */
export function PdfDocument({
  source,
  viewer: externalViewer,
  passwordPrompt = true,
  onOpenAttachment,
  children,
}: PdfDocumentProps) {
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  preloadSourceFetch(resolved);
  // pdf.js and its worker load while React renders and commits.
  preloadPdfjs();
  // The key identifies the source, so an inline `{ url }` does not open it
  // again at every render. Viewers share a document whatever password
  // opened it, but a new password tries again, say after a wrong one failed it.
  const key = sourceKey(resolved);
  const password = resolved.password;
  const create = (): Held => ({
    key,
    password,
    session: new PdfSession(resolved, { passwordPrompt }),
  });
  const [held, setHeld] = useState(create);
  let current = held;
  if (held.key !== key || held.password !== password) {
    // Another source: its session renders at once, as the first did.
    current = create();
    setHeld(current);
  }
  const { session } = current;
  const [ownViewer, setOwnViewer] = useState<Viewer | null>(() =>
    externalViewer ? null : new Viewer(),
  );
  let activeViewer = externalViewer ?? ownViewer;
  if (!activeViewer) {
    activeViewer = new Viewer();
    setOwnViewer(activeViewer);
  }
  // The document starts to open as the provider renders, not once React
  // has mounted it: what its children read of it (`useOutline()` and the
  // like) arrives while a transition or a Suspense boundary above the
  // provider still waits for them, and neither mounts the provider before
  // they do. The server opens no document.
  if (typeof window !== "undefined") startSession(session);
  // The session is held while the provider is mounted and shown. StrictMode's
  // mount-unmount-mount cycle and quick remounts reuse the open document
  // instead of opening it again, and a provider React rendered but never
  // mounted leaves its document to close (document/registry.ts).
  useEffect(() => connectSession(session), [session]);
  useEffect(
    () => (externalViewer || !ownViewer ? undefined : holdViewer(ownViewer)),
    [externalViewer, ownViewer],
  );
  // The prompt changes what the session shows, not the document.
  useEffect(() => setPasswordPrompt(session, passwordPrompt), [session, passwordPrompt]);
  useLayoutEffect(() => setOpenAttachment(session, onOpenAttachment), [session, onOpenAttachment]);
  // A new fragment moves the viewers where it points, as a link would.
  const fragment = "url" in resolved ? splitFragment(resolved.url)[1] : "";
  useEffect(() => setFragment(session, fragment), [session, fragment]);
  return (
    <SessionContext value={session}>
      <ViewerContext value={activeViewer}>{children}</ViewerContext>
    </SessionContext>
  );
}
