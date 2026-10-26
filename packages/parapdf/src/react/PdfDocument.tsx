"use client";

import { type ReactNode, useEffect, useState } from "react";
import { preload } from "react-dom";
import { connectSession, PdfSession, setPasswordPrompt } from "../document/pdf-session.ts";
import { sourceKey } from "../document/registry.ts";
import type { PdfSource } from "../document/session.ts";
import { documentRequestMode, preloadPdfjs } from "../pdfjs/loader.ts";
import { SessionContext } from "./context.ts";

export interface PdfDocumentProps {
  /**
   * The document to show: its URL, `{ url }`, or `{ data }` with its bytes.
   * It reopens when its URL, request headers, or password change or, for
   * data, when the bytes are another object or the password changes; a new
   * object for the same URL keeps the open document.
   */
  source: string | PdfSource;
  /**
   * Whether an encrypted document waits for a password (status "password",
   * the default), which `useSession().submitPassword()` gives, or fails at
   * once (status "error") when its source has no password or a wrong one,
   * for applications that show no password prompt.
   */
  passwordPrompt?: boolean;
  children?: ReactNode;
}

/** A provider's session of a source, created as it renders. */
interface Held {
  readonly key: unknown;
  readonly password: string | undefined;
  readonly session: PdfSession;
}

/**
 * Opens `source`, or joins the session other providers opened of it, and
 * gives that session to its children, which it renders at once: viewers
 * (`<PdfViewer>`), thumbnails, and the application's own controls. Viewers
 * of one provider share its session; it closes once no provider holds it.
 */
export function PdfDocument({ source, passwordPrompt = true, children }: PdfDocumentProps) {
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  if ("url" in resolved) {
    // The download starts now, and with server rendering as soon as the
    // browser reads the page's head, not once pdf.js has loaded: pdf.js's
    // request has this CORS mode and takes the preloaded response. A source
    // with headers has no preload: none can carry them.
    const mode = documentRequestMode(resolved);
    if (mode) preload(resolved.url, { as: "fetch", crossOrigin: mode });
  }
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
  // The session is held while the provider is mounted. StrictMode's
  // mount-unmount-mount cycle and quick remounts reuse the open document
  // instead of opening it again (document/registry.ts).
  useEffect(() => connectSession(session), [session]);
  // The prompt changes what the session shows, not the document.
  useEffect(() => setPasswordPrompt(session, passwordPrompt), [session, passwordPrompt]);
  return <SessionContext value={session}>{children}</SessionContext>;
}
