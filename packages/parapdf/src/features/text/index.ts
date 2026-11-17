import { type PdfSession, sessionControllerOf } from "../../document/pdf-session.ts";
import type { PageText } from "../../pdfjs/text.ts";
import { clamp } from "../../view/layout.ts";
import { matchRects, pageIndex } from "../search/page-index.ts";
import {
  findMatches,
  normalizeQuery,
  type PageIndex,
  type SearchMatch,
  type SearchOptions,
} from "../search/text-search.ts";
import type { PdfRect } from "../selection.ts";
import {
  type DocumentText,
  PAGE_SEPARATOR,
  type PageTextContent,
  pageText,
  type TextOptions,
} from "./document-text.ts";

export type {
  DocumentText,
  LineBreaks,
  PageTextContent,
  TextOptions,
  TextPoint,
} from "./document-text.ts";

export interface FindTextOptions extends SearchOptions {
  /**
   * Zero-based page index where the search starts (inclusive).
   * The document's first page (`0`) by default.
   */
  from?: number;
  /**
   * Zero-based page index where the search ends (inclusive).
   * The document's last page by default.
   */
  to?: number;
  /** Maximum number of matches returned across the searched pages. */
  limit?: number;
  /** Aborting rejects the promise with the signal's reason. */
  signal?: AbortSignal;
}

export interface TextMatch extends SearchMatch {
  /**
   * Rectangles covering the match on `pageIndex`, in PDF points from the
   * page's unturned top-left corner (`<PdfPageRect>`'s coordinates).
   */
  rects: readonly PdfRect[];
  /**
   * Axis-aligned union of `rects`, in the same PDF-point coordinates, for
   * `viewer.revealRect(match.pageIndex, match.bounds)`.
   */
  bounds: PdfRect;
}

/** Pages `getText()` asks pdf.js for ahead of the one it reads. */
const TEXT_READ_AHEAD = 4;

/**
 * The text of `session`'s document, read from pdf.js's text content of every
 * page between `from` and `to`, mounted or not: items in content order, as
 * search and the text layers read them, with "\n" where lines end or, with
 * `lineBreaks: "join"`, lines joined as search joins them. Pages are
 * parsed in pdf.js's worker, a few at a time; the texts are kept, so a
 * second read, or a search, parses nothing again. Rejects while no
 * document is open, and once it closes.
 */
export async function getText(
  session: PdfSession,
  options: TextOptions = {},
): Promise<DocumentText> {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  const work = controller.signal;
  if (!doc || work.aborted) throw new Error("No document is open");
  const { from, to, lineBreaks = "keep", signal } = options;
  signal?.throwIfAborted();
  const lastPage = doc.pageCount - 1;
  const start = typeof from === "number" ? { pageIndex: from } : from;
  const end = typeof to === "number" ? { pageIndex: to } : to;
  const first = clamp(start?.pageIndex ?? 0, 0, lastPage);
  const last = clamp(end?.pageIndex ?? lastPage, 0, lastPage);
  // Pages are asked for ahead of the one being read: the worker parses
  // them one after another while the main thread joins the text.
  const requested = new Map<number, Promise<PageText>>();
  const request = (pageIndex: number) => {
    if (pageIndex > last || requested.has(pageIndex)) return;
    const text = doc.text(pageIndex);
    // Abandoned when the read stops early; the read itself awaits it.
    text.catch(() => {});
    requested.set(pageIndex, text);
  };
  const pages: PageTextContent[] = [];
  let text = "";
  for (let pageIndex = first; pageIndex <= last; pageIndex++) {
    for (let ahead = pageIndex; ahead < pageIndex + TEXT_READ_AHEAD; ahead++) request(ahead);
    const content = await requested.get(pageIndex);
    requested.delete(pageIndex);
    signal?.throwIfAborted();
    if (work.aborted || !content) throw new Error("The document was closed");
    const startsHere = start && "item" in start && start.pageIndex === pageIndex;
    const endsHere = end && "item" in end && end.pageIndex === pageIndex;
    const read = pageText(content, lineBreaks, startsHere ? start : null, endsHere ? end : null);
    if (pages.length > 0) text += PAGE_SEPARATOR;
    pages.push({ pageIndex, text: read, offset: text.length });
    text += read;
  }
  return { text, pages };
}

/**
 * Locate matches of `query` across `session`'s pages between `from` and `to`,
 * mounted or not, using search's normalization (NFKC, decomposed half-width
 * katakana, and CJK / hyphenated line-joining) without touching `useSearch()`.
 * Reuses the session's cached `PageText` and `PageIndex`, returning each
 * match's `rects` and union `bounds` in `<PdfPageRect>` and
 * `viewer.revealRect()` coordinates. Rejects while no document is open, and
 * once it closes.
 */
export async function findText(
  session: PdfSession,
  query: string,
  options: FindTextOptions = {},
): Promise<TextMatch[]> {
  const controller = sessionControllerOf(session);
  const doc = controller.openDocument();
  const work = controller.signal;
  if (!doc || work.aborted) throw new Error("No document is open");
  const { from, to, limit, signal } = options;
  signal?.throwIfAborted();
  if (doc.pageCount === 0) return [];
  const fromPage = from ?? 0;
  const toPage = to ?? doc.pageCount - 1;
  if (Number.isNaN(fromPage) || Number.isNaN(toPage)) return [];
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) return [];
  const maxMatches =
    limit === undefined || limit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.trunc(limit);
  const first = Math.max(0, Math.trunc(fromPage));
  const last = Math.min(doc.pageCount - 1, Math.trunc(toPage));
  if (first > last) return [];
  const normalized = normalizeQuery(query, options);
  if (!normalized) return [];

  const aheadCount = Number.isFinite(maxMatches) ? 1 : TEXT_READ_AHEAD;
  const requested = new Map<number, Promise<PageIndex>>();
  const request = (index: number) => {
    if (index > last || requested.has(index)) return;
    const entry = pageIndex(doc, index, options);
    entry.catch(() => {});
    requested.set(index, entry);
  };

  const results: TextMatch[] = [];
  for (let current = first; current <= last && results.length < maxMatches; current++) {
    for (let ahead = current; ahead < current + aheadCount; ahead++) request(ahead);
    const index = await requested.get(current);
    requested.delete(current);
    signal?.throwIfAborted();
    if (work.aborted || !index) throw new Error("The document was closed");
    const remaining = maxMatches - results.length;
    const found = findMatches(
      index,
      normalized,
      current,
      Number.isFinite(remaining) ? remaining : undefined,
      options,
    );
    if (found.length === 0) continue;
    const content = await doc.text(current);
    signal?.throwIfAborted();
    if (work.aborted) throw new Error("The document was closed");
    for (const match of found) {
      const { rects, bounds } = matchRects(content, match);
      results.push({ ...match, rects, bounds });
    }
  }
  return results;
}
