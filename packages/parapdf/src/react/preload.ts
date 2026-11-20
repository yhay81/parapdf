"use client";

import { preload } from "react-dom";
import { type PdfjsLoader, sharedSession, splitFragment } from "../document/registry.ts";
import type { PdfSource } from "../document/session.ts";
import { fragmentDestinations } from "../features/initial-view.ts";
import type { Destination } from "../pdfjs/destinations.ts";
import { documentRequestMode, loadPdfjs, preloadPdfjs } from "../pdfjs/loader.ts";

export interface PreloadDocumentOptions {
  /**
   * Named or explicit PDF destinations to resolve and cache while warming
   * `source`, so mounting `<PdfViewer>` at any of them lays out synchronously
   * before the first paint. Destinations in `source`'s URL fragment (such as
   * `#nameddest=sec-2` or `#page=3&zoom=150,72,720`) are warmed automatically.
   */
  destinations?: readonly Destination[];
}

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
  options?: PreloadDocumentOptions,
): void {
  const resolved: PdfSource = typeof source === "string" ? { url: source } : source;
  preloadSourceFetch(resolved);
  warmPdfjs();
  if (typeof window === "undefined") return;
  const [url, fragment] = "url" in resolved ? splitFragment(resolved.url) : ["", ""];
  const stripped: PdfSource =
    "url" in resolved && resolved.url !== url ? { ...resolved, url } : resolved;
  const shared = sharedSession(pdfjs, stripped);
  void shared.read("initialView", (doc) => doc.initialView(), null);
  void shared.read("pageLabels", (doc) => doc.pageLabels(), null);
  void shared.session.then(
    (doc) => {
      if (shared.signal.aborted) return;
      if (doc.pageCount > 0) void doc.pageSizes().catch(() => {});
      void doc.direction().catch(() => {});
      void doc.layers().catch(() => {});
      if (fragment) {
        for (const dest of fragmentDestinations(fragment, 0)) {
          void doc.resolveDestination(dest).catch(() => {});
        }
      }
      if (options?.destinations) {
        for (const dest of options.destinations) {
          void doc.resolveDestination(dest).catch(() => {});
        }
      }
    },
    () => {},
  );
}

/**
 * Starts loading pdf.js, preloading `source`'s URL (except in WebKit or when
 * headers are set, matching `<PdfDocument>`), and opening `source` in the
 * shared document registry ahead of `<PdfDocument>` mounting — for example on
 * route hover or intent — warming page sizes, permissions, direction, initial
 * view, page labels, URL fragment destinations, and `options.destinations`. If
 * `<PdfDocument source={source}>` mounts before the registry's unheld grace
 * window expires, it joins the warm session at once; otherwise the registry
 * closes it automatically.
 */
export function preloadDocument(
  source: string | PdfSource,
  options?: PreloadDocumentOptions,
): void {
  preloadDocumentWith(source, loadPdfjs, preloadPdfjs, options);
}
