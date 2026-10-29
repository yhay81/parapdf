"use client";

import type * as Pdfjs from "pdfjs-dist";
import type { DocumentSession } from "../document/session.ts";
import type { AnnotationLayerHandle } from "../pdfjs/annotation-layer.ts";
import type { TextLayerHandle } from "../pdfjs/text.ts";
import type { Viewer } from "../view/viewer.ts";
import { rangeForMatch } from "./search/highlights.ts";
import { buildPageIndex, type PageIndex, type SearchMatch } from "./search/text-search.ts";

/*
 * Finding links in the text follows `Autolinker` in PDF.js
 * `web/autolinker.js`, and leaving out those the file already has
 * `PDFPageView#checkInferredLinks()` in `web/pdf_page_view.js` (pdfjs-dist
 * 6.4.299; Copyright Mozilla Foundation, Apache License 2.0; see NOTICE.md):
 * the same regular expression and URL checks, on the page's text as search
 * normalizes it, with case and diacritics kept and a dash before a line end
 * kept, as pdf.js's `normalize()` with `ignoreDashEOL` keeps it.
 */

/** A URL or e-mail address found in a page's text. */
export interface FoundLink {
  /** The absolute URL the link opens: http(s), or mailto for an address. */
  url: string;
  start: SearchMatch["start"];
  /** Exclusive end. */
  end: SearchMatch["end"];
}

/** A rectangle in PDF points: `[x1, y1, x2, y2]`, normalized. */
export type PdfRect = [number, number, number, number];

/** What `addLinkAnnotations()` takes of a link, as pdf.js's viewer makes it. */
interface InferredLink {
  id: string;
  url: string;
  unsafeUrl: string;
  annotationType: number;
  rotation: 0;
  rect: PdfRect;
  quadPoints?: number[];
  borderStyle: null;
}

/** The attribute pdf.js gives a link's element, which marks the links found in the text. */
const INFERRED = 'data-annotation-id^="inferred_link_"';

let linkRegex: RegExp | undefined;
const NUMERIC_TLD = /\.\d+$/;
const PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** pdf.js's `createValidAbsoluteUrl()` with `addDefaultProtocol`, for the protocols it allows. */
function absoluteUrl(raw: string): URL | null {
  const url =
    raw.startsWith("www.") && (raw.match(/\./g)?.length ?? 0) >= 2 ? `http://${raw}` : raw;
  const parsed = URL.parse(url);
  return parsed && PROTOCOLS.has(parsed.protocol) ? parsed : null;
}

/** The URLs and e-mail addresses in a page's text, as pdf.js's `Autolinker.findLinks()` finds them. */
export function findLinks(index: PageIndex): FoundLink[] {
  // A string, so that neither TypeScript's target nor the parsers of
  // applications' bundlers need to know the `v` flag.
  // biome-ignore lint/complexity/useRegexLiterals: see above
  linkRegex ??= new RegExp(
    String.raw`\b(?:https?:\/\/|mailto:|www\.)(?:[\S--[\p{P}<>]]|\/|[\S--[\[\]]]+[\S--[\p{P}<>]])+|(?=\p{L})[\S--[@\p{Ps}\p{Pe}<>]]{1,64}@([\S--[[\p{P}--\-]<>]]{1,63}(?:\.[\S--[[\p{P}--\-]<>]]{1,63})+)`,
    "gv",
  );
  const links: FoundLink[] = [];
  for (const match of index.text.matchAll(linkRegex)) {
    const [text, emailDomain] = match;
    let raw: string | undefined;
    if (text.startsWith("www.") || text.startsWith("http://") || text.startsWith("https://")) {
      raw = text;
    } else if (emailDomain) {
      const hostname = URL.parse(`http://${emailDomain}`)?.hostname;
      if (!hostname || NUMERIC_TLD.test(hostname)) continue;
    }
    raw ??= text.startsWith("mailto:") ? text : `mailto:${text}`;
    const url = absoluteUrl(raw);
    if (!url) continue;
    const at = match.index;
    const last = at + text.length - 1;
    links.push({
      url: url.href,
      start: { item: index.itemOf[at] ?? 0, offset: index.startOf[at] ?? 0 },
      end: { item: index.itemOf[last] ?? 0, offset: index.endOf[last] ?? 0 },
    });
  }
  return links;
}

/** The rectangles an annotation covers: its quadrilaterals' boxes, or its rectangle. */
function annotationRects({
  rect,
  quadPoints,
}: {
  rect: PdfRect;
  quadPoints?: ArrayLike<number> | null;
}): PdfRect[] {
  if (!quadPoints) return [rect];
  const rects: PdfRect[] = [];
  for (let i = 2; i < quadPoints.length; i += 8) {
    const [trX, trY, blX, blY] = [
      quadPoints[i],
      quadPoints[i + 1],
      quadPoints[i + 2],
      quadPoints[i + 3],
    ];
    rects.push([blX ?? 0, blY ?? 0, trX ?? 0, trY ?? 0]);
  }
  return rects;
}

function intersect(a: PdfRect, b: PdfRect): PdfRect | null {
  const x1 = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
  const x2 = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
  const y1 = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
  const y2 = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  return x1 > x2 || y1 > y2 ? null : [x1, y1, x2, y2];
}

const area = (rects: readonly PdfRect[]): number =>
  rects.reduce((sum, rect) => sum + Math.abs((rect[2] - rect[0]) * (rect[3] - rect[1])), 0);

/**
 * Whether a link of the file covers more than half of `link`, which pdf.js's
 * viewer then leaves out.
 */
export function coveredByLink(
  link: { rect: PdfRect; quadPoints?: ArrayLike<number> | null },
  fileLinks: readonly { rect: PdfRect; quadPoints?: ArrayLike<number> | null }[],
): boolean {
  const rects = annotationRects(link);
  const linkArea = area(rects);
  return fileLinks.some((fileLink) => {
    const intersections: PdfRect[] = [];
    for (const a of annotationRects(fileLink)) {
      for (const b of rects) {
        const overlap = intersect(a, b);
        if (overlap) intersections.push(overlap);
      }
    }
    return intersections.length > 0 && area(intersections) / linkArea > 0.5;
  });
}

/**
 * A link's rectangle and, over several lines, its quadrilaterals in PDF
 * points, from where its range shows in the text layer `container`.
 */
function linkPosition(
  range: Range,
  container: HTMLElement,
  page: Pdfjs.PDFPageProxy,
): { rect: PdfRect; quadPoints?: number[] } | null {
  // The layer is laid out unturned and turned with CSS: what shows is the
  // page turned by the rotation it is marked with.
  const rotation = Number(container.getAttribute("data-main-rotation") ?? 0);
  const viewport = page.getViewport({ scale: 1, rotation });
  const box = container.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const toPdf = (x: number, y: number) =>
    viewport.convertToPdfPoint(
      ((x - box.left) / box.width) * viewport.width,
      ((y - box.top) / box.height) * viewport.height,
    );
  const rects: PdfRect[] = [];
  for (const client of range.getClientRects()) {
    if (client.width === 0 || client.height === 0) continue;
    const [x1, y1] = toPdf(client.left, client.top);
    const [x2, y2] = toPdf(client.right, client.bottom);
    rects.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
  }
  if (rects.length === 0) return null;
  if (rects.length === 1) return { rect: rects[0] as PdfRect };
  const rect: PdfRect = [Infinity, Infinity, -Infinity, -Infinity];
  const quadPoints: number[] = [];
  for (const [x1, y1, x2, y2] of rects) {
    quadPoints.push(x1, y2, x2, y2, x1, y1, x2, y1);
    rect[0] = Math.min(rect[0], x1);
    rect[1] = Math.min(rect[1], y1);
    rect[2] = Math.max(rect[2], x2);
    rect[3] = Math.max(rect[3], y2);
  }
  return { rect, quadPoints };
}

/** Each session's pages' links, read once and shared by its viewers. */
const found = new WeakMap<DocumentSession, Map<number, Promise<FoundLink[]>>>();

// pdf.js keeps added links in the annotation layer even after their DOM is
// removed. Reuse those elements when the feature is turned on again.
const added = new WeakMap<AnnotationLayerHandle, HTMLElement[]>();
let nextId = 0;

function pageLinks(session: DocumentSession, pageIndex: number): Promise<FoundLink[]> {
  let pages = found.get(session);
  if (!pages) {
    pages = new Map();
    found.set(session, pages);
  }
  let links = pages.get(pageIndex);
  if (!links) {
    const read = pages;
    links = session
      .text(pageIndex)
      .then((text) =>
        findLinks(
          buildPageIndex(text, { caseSensitive: true, matchDiacritics: true, keepDashes: true }),
        ),
      )
      .catch((error: unknown) => {
        read.delete(pageIndex);
        throw error;
      });
    pages.set(pageIndex, links);
  }
  return links;
}

/**
 * Turn the URLs and e-mail addresses in the text of `viewer`'s pages into
 * links of their annotation layers, once both layers of a page are built,
 * leaving out those a link of the file already covers. Returns the
 * function that stops it and removes the links it added.
 */
export function attachAutoLinks(viewer: Viewer): () => void {
  let session: DocumentSession | null = null;
  const texts = new Map<number, TextLayerHandle>();
  const annotations = new Map<number, AnnotationLayerHandle>();
  /** Annotation layers given links, or being given them. */
  const linked = new WeakSet<AnnotationLayerHandle>();
  let stopped = false;

  const link = async (pageIndex: number): Promise<void> => {
    const text = texts.get(pageIndex);
    const layer = annotations.get(pageIndex);
    const open = session;
    if (stopped || !text || !layer || !open || linked.has(layer)) return;
    linked.add(layer);
    const previous = added.get(layer);
    if (previous) {
      layer.layer.div.append(...previous);
      return;
    }
    const [links, page] = await Promise.all([pageLinks(open, pageIndex), open.page(pageIndex)]);
    if (links.length === 0) return;
    const fileLinks = (await page.getAnnotations({ intent: "display" })).filter(
      (annotation) => annotation.annotationType === open.pdfjs.pdfjs.AnnotationType.LINK,
    );
    // The page's layers may have gone, or been built again, meanwhile. A run
    // for new ones returned while this one held the annotation layer, so
    // run again for the layers the page has now.
    if (stopped || texts.get(pageIndex) !== text || annotations.get(pageIndex) !== layer) {
      linked.delete(layer);
      if (!stopped) void run(pageIndex);
      return;
    }
    // An empty item's span is in no layer, as pdf.js builds it.
    let container: HTMLElement | null = null;
    for (const element of text.elements) {
      container = element.closest<HTMLElement>(".parapdf-text-layer");
      if (container) break;
    }
    if (!container) return;
    const inferred: InferredLink[] = [];
    for (const found of links) {
      const range = rangeForMatch(text.elements, { pageIndex, ...found });
      const position = range && linkPosition(range, container, page);
      if (!position || coveredByLink(position, fileLinks)) continue;
      inferred.push({
        id: `inferred_link_${nextId++}`,
        url: found.url,
        unsafeUrl: found.url,
        annotationType: open.pdfjs.pdfjs.AnnotationType.LINK,
        rotation: 0,
        ...position,
        borderStyle: null,
      });
    }
    if (inferred.length > 0) {
      const adding = layer.layer.addLinkAnnotations(inferred as never);
      // pdf.js appends these synchronously, before its accessibility work
      // finishes. Keep them before another option change can detach them.
      added.set(layer, [
        ...(layer.layer.div as HTMLElement).querySelectorAll<HTMLElement>(`[${INFERRED}]`),
      ]);
      await adding;
    }
  };

  const run = (pageIndex: number) =>
    link(pageIndex).catch((error: unknown) =>
      console.error(`page ${pageIndex + 1}: finding links in the text failed`, error),
    );

  const remove = viewer.extend({
    ready(opened) {
      session = opened;
      // Layers built before this attached.
      for (const [pageIndex, handle] of viewer.textLayers) texts.set(pageIndex, handle);
      for (const [pageIndex, handle] of viewer.annotationLayers) annotations.set(pageIndex, handle);
      for (const pageIndex of texts.keys()) void run(pageIndex);
    },
    closed() {
      session = null;
      texts.clear();
      annotations.clear();
    },
    textLayer(pageIndex, handle) {
      if (!handle) {
        texts.delete(pageIndex);
        return;
      }
      texts.set(pageIndex, handle);
      void run(pageIndex);
    },
    annotationLayer(pageIndex, handle) {
      if (!handle) {
        annotations.delete(pageIndex);
        return;
      }
      annotations.set(pageIndex, handle);
      void run(pageIndex);
    },
  });
  return () => {
    stopped = true;
    remove();
    for (const handle of annotations.values()) {
      for (const element of handle.layer.div.querySelectorAll(`[${INFERRED}]`)) element.remove();
    }
  };
}
