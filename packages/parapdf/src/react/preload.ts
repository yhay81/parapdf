"use client";

import { preload } from "react-dom";
import { type PdfjsLoader, sharedSession, splitFragment } from "../document/registry.ts";
import type { PdfSource } from "../document/session.ts";
import { documentRequestMode, loadPdfjs, preloadPdfjs } from "../pdfjs/loader.ts";

export function preloadSourceFetch(source: PdfSource): void {
  if (!("url" in source)) return;
  // The download starts now, and with server rendering as soon as the
  // browser reads the page's head, not once pdf.js has loaded: pdf.js's
  // request has this CORS mode and takes the preloaded response. A source
  // with headers has no preload: none can carry them.
  const mode = documentRequestMode(source);
  if (mode) preload(splitFragment(source.url)[0], { as: "fetch", crossOrigin: mode });
}

export function preloadDocumentWith(
  source: string | PdfSource,
  pdfjs: PdfjsLoader = loadPdfjs,
  warmPdfjs: () => void = preloadPdfjs,
): void {
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  preloadSourceFetch(resolved);
  warmPdfjs();
  if (typeof window === "undefined") return;
  const [url] = "url" in resolved ? splitFragment(resolved.url) : [""];
  const stripped: PdfSource =
    "url" in resolved && resolved.url !== url ? { ...resolved, url } : resolved;
  sharedSession(pdfjs, stripped);
}

/**
 * Starts loading pdf.js, preloading `source`'s URL (except in WebKit or when
 * headers are set, matching `<PdfDocument>`), and opening `source` in the
 * shared document registry ahead of `<PdfDocument>` mounting — for example on
 * route hover or intent. If `<PdfDocument source={source}>` mounts before the
 * registry's unheld grace window expires, it joins the warm session at once;
 * otherwise the registry closes it automatically.
 */
export function preloadDocument(source: string | PdfSource): void {
  preloadDocumentWith(source);
}
