"use client";

import type * as Pdfjs from "pdfjs-dist";
import { pageViewport, RenderCancelledError, type Rotation, setLayerUnit } from "./draw.ts";
import type { LoadedPdfjs } from "./loader.ts";
import { type RawDims, StructTreeBuilder } from "./struct-tree.ts";

// The text layer and the search index must see the same items in the same
// order, so both read text content with identical options.
const TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true } as const;

/**
 * Reading advance axis of a text item in `PageText.boxes`'s unturned page space:
 * `0` (+x), `1` (-x), `2` (+y), `3` (-y).
 */
export type TextAdvanceDirection = 0 | 1 | 2 | 3;

/** The text of one page as positioned runs, in content order. */
export interface PageText {
  readonly items: readonly string[];
  /** Whether a line ends after each item. */
  readonly endsLine: readonly boolean[];
  /**
   * Approximate box of each item in PDF points from the page's top-left corner,
   * with the page's own rotation applied but no view rotation:
   * `[x, y, width, height]` per item. Used to scroll to and locate matches
   * without a mounted text layer.
   */
  readonly boxes: Float32Array;
  /** Reading advance direction (`0` +x, `1` -x, `2` +y, `3` -y) of each item in `boxes`. */
  readonly directions?: Uint8Array;
}

/** The text of `page`, read in pdf.js's worker, as the text layer lays it out. */
export async function readPageText(page: Pdfjs.PDFPageProxy): Promise<PageText> {
  const content = await page.getTextContent(TEXT_OPTIONS);
  const viewport = page.getViewport({ scale: 1 });
  let ma: number;
  let mb: number;
  let mc: number;
  let md: number;
  let ox: number;
  let oy: number;
  const vt = (viewport as { transform?: readonly number[] }).transform;
  if (vt && vt.length >= 6) {
    ma = vt[0] ?? 0;
    mb = vt[1] ?? 0;
    mc = vt[2] ?? 0;
    md = vt[3] ?? 0;
    ox = vt[4] ?? 0;
    oy = vt[5] ?? 0;
  } else {
    const [p0x = 0, p0y = 0] = viewport.convertToViewportPoint(0, 0);
    const [p1x = 0, p1y = 0] = viewport.convertToViewportPoint(1, 0);
    const [p2x = 0, p2y = 0] = viewport.convertToViewportPoint(0, 1);
    ox = p0x;
    oy = p0y;
    ma = p1x - p0x;
    mb = p1y - p0y;
    mc = p2x - p0x;
    md = p2y - p0y;
  }
  const styles = content.styles as Record<string, { vertical?: boolean } | undefined> | undefined;
  let count = 0;
  for (const item of content.items) {
    if ("str" in item) count++;
  }
  const items = new Array<string>(count);
  const endsLine = new Array<boolean>(count);
  const boxes = new Float32Array(count * 4);
  const directions = new Uint8Array(count);
  let index = 0;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    items[index] = item.str;
    endsLine[index] = item.hasEOL;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform as number[];
    const ab = Math.hypot(a, b);
    const cd = Math.hypot(c, d);
    const ux = ab > 0 ? a / ab : 1;
    const uy = ab > 0 ? b / ab : 0;
    const vx = cd > 0 ? c / cd : -uy;
    const vy = cd > 0 ? d / cd : ux;
    const vertical = Boolean(styles?.[item.fontName]?.vertical) || item.dir === "ttb";
    let originX = e;
    let originY = f;
    let advX: number;
    let advY: number;
    let crossX: number;
    let crossY: number;
    let dirVecX: number;
    let dirVecY: number;
    if (vertical) {
      const width = ab || cd || item.width;
      originX = e - ux * (width / 2);
      originY = f - uy * (width / 2);
      advX = -vx * item.height;
      advY = -vy * item.height;
      crossX = ux * width;
      crossY = uy * width;
      dirVecX = -vx;
      dirVecY = -vy;
    } else {
      const height = cd || ab || item.height;
      advX = ux * item.width;
      advY = uy * item.width;
      crossX = vx * height;
      crossY = vy * height;
      dirVecX = ux;
      dirVecY = uy;
    }
    const x0 = ox + ma * originX + mc * originY;
    const y0 = oy + mb * originX + md * originY;
    const adx = ma * advX + mc * advY;
    const ady = mb * advX + md * advY;
    const cdx = ma * crossX + mc * crossY;
    const cdy = mb * crossX + md * crossY;
    const x1 = x0 + adx;
    const y1 = y0 + ady;
    const x2 = x0 + cdx;
    const y2 = y0 + cdy;
    const x3 = x1 + cdx;
    const y3 = y1 + cdy;
    const minX = Math.min(x0, x1, x2, x3);
    const minY = Math.min(y0, y1, y2, y3);
    const at = index * 4;
    boxes[at] = minX;
    boxes[at + 1] = minY;
    boxes[at + 2] = Math.max(x0, x1, x2, x3) - minX;
    boxes[at + 3] = Math.max(y0, y1, y2, y3) - minY;
    const sign = item.dir === "rtl" ? -1 : 1;
    const dx = (ma * dirVecX + mc * dirVecY) * sign;
    const dy = (mb * dirVecX + md * dirVecY) * sign;
    directions[index] = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 0) : dy < 0 ? 3 : 2;
    index++;
  }
  return { items, endsLine, boxes, directions };
}

export interface TextLayerRequest {
  /**
   * Receives the positioned text runs; sized by the `--total-scale-factor`
   * CSS variable. Its `lang` becomes the language the runs are sized in:
   * the PDF's, or the language it inherits when the PDF has none.
   */
  container: HTMLElement;
  /** CSS pixels per PDF point. */
  cssScale: number;
  rotation?: Rotation;
  /**
   * Receives a tagged page's structure, after the text: elements with ARIA
   * roles (headings, lists, tables, figures with their alternative text)
   * that take the text layer's runs in through `aria-owns`. It should be
   * accessible but not rendered, as a canvas's fallback content is.
   */
  structure?: HTMLElement;
}

export interface TextLayerHandle {
  /** The `.parapdf-text-layer` container holding the positioned runs. */
  readonly layer: HTMLElement;
  /** One element per item of `PageText.items`, in the same order. */
  readonly elements: readonly HTMLElement[];
  /** The page's structure tree, which labels its annotations; null without `structure`. */
  readonly structTree: StructTreeBuilder | null;
  /** Re-measure the runs for a new zoom level, or turn them with the view. */
  update(cssScale: number, rotation: Rotation): void;
}

export interface TextLayerTask {
  readonly promise: Promise<TextLayerHandle>;
  cancel(): void;
}

/** The language `element` inherits, "" when none is declared. */
function inheritedLanguage(element: Element): string {
  let node: Element | null = element;
  while (node) {
    const lang = node.getAttribute("lang");
    if (lang !== null) return lang;
    const root = node.getRootNode();
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return "";
}

/**
 * pdf.js's `TextLayer` sizes each run by measuring it on a hidden canvas
 * whose `lang` is the text content's: the PDF's /Lang, or empty, an unknown
 * language, when the PDF declares none. The generic families runs are drawn
 * in, such as `serif`, resolve by language, and an unknown language resolves
 * apart from the page's: to the operating system's in Firefox, to the
 * browser's default in Chromium and WebKit. Runs drawn in other fonts than
 * they were measured in end short of their glyphs or past them: 12–15% short
 * in Firefox on a Japanese system under an English page, 12–18% past in
 * Chromium and WebKit under a Japanese page. So the text content declares the
 * PDF's language or, when it has none, the one the layer inherits, and the
 * layer carries that language itself. For PDFs without a language, assistive
 * technology keeps announcing the page's.
 */
function inLayerLanguage(source: ReadableStream, container: HTMLElement): ReadableStream {
  const inherited = container.parentElement ? inheritedLanguage(container.parentElement) : "";
  container.lang = inherited;
  return source.pipeThrough(
    new TransformStream<{ lang: string | null }, { lang: string | null }>({
      transform(chunk, controller) {
        chunk.lang ||= inherited;
        if (container.lang !== chunk.lang) container.lang = chunk.lang;
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Build a selectable, searchable, screen-reader-visible text layer for `page` once it has loaded. */
export function buildTextLayer(
  { pdfjs }: LoadedPdfjs,
  page: Promise<Pdfjs.PDFPageProxy>,
  { container, cssScale, rotation, structure }: TextLayerRequest,
): TextLayerTask {
  let layer: Pdfjs.TextLayer | undefined;
  let cancelled = false;
  const promise = page.then(async (page): Promise<TextLayerHandle> => {
    if (cancelled) throw new RenderCancelledError("text layer cancelled before it started");
    setLayerUnit(container, page);
    const viewport = pageViewport(page, cssScale, rotation);
    const tree = structure
      ? new StructTreeBuilder(page.getStructTree(), viewport.rawDims as RawDims)
      : null;
    const rendered = new pdfjs.TextLayer({
      textContentSource: inLayerLanguage(page.streamTextContent(TEXT_OPTIONS), container),
      container,
      // The layer is laid out unturned; pdf.js marks it with
      // data-main-rotation and the viewer CSS turns it.
      viewport,
    });
    layer = rendered;
    await rendered.render();
    if (tree && structure) {
      // An untagged page has no tree; a broken one leaves the text as it is.
      const dom = await tree.render().catch((error: unknown) => {
        console.error(`page ${page.pageNumber}: structure tree failed`, error);
        return null;
      });
      if (cancelled) throw new RenderCancelledError("text layer cancelled");
      if (dom) {
        tree.updateTextLayer(container.querySelectorAll<HTMLElement>(".markedContent[id]"));
        structure.replaceChildren(dom);
      }
    }
    return {
      layer: container,
      elements: rendered.textDivs,
      structTree: tree,
      update(nextScale, nextRotation) {
        rendered.update({ viewport: pageViewport(page, nextScale, nextRotation) });
      },
    };
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      layer?.cancel();
    },
  };
}
