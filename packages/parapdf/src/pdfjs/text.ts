import type * as Pdfjs from "pdfjs-dist";
import { pageViewport, RenderCancelledError, type Rotation } from "./draw.ts";
import type { LoadedPdfjs } from "./loader.ts";
import { type RawDims, StructTreeBuilder } from "./struct-tree.ts";

// The text layer and the search index must see the same items in the same
// order, so both read text content with identical options.
const TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true } as const;

/** The text of one page as positioned runs, in content order. */
export interface PageText {
  readonly items: readonly string[];
  /** Whether a line ends after each item. */
  readonly endsLine: readonly boolean[];
  /**
   * Approximate box of each item in PDF points from the page's top-left corner,
   * with the page's own rotation applied but no view rotation:
   * `[x, y, width, height]` per item. Used to scroll to matches before a
   * page's text layer exists.
   */
  readonly boxes: Float32Array;
}

/** The text of `page`, read in pdf.js's worker, as the text layer lays it out. */
export async function readPageText(page: Pdfjs.PDFPageProxy): Promise<PageText> {
  const content = await page.getTextContent(TEXT_OPTIONS);
  const viewport = page.getViewport({ scale: 1 });
  const items: string[] = [];
  const endsLine: boolean[] = [];
  const boxes: number[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    items.push(item.str);
    endsLine.push(item.hasEOL);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform as number[];
    const [x = 0, baseline = 0] = viewport.convertToViewportPoint(e, f);
    const height = Math.hypot(c, d) || Math.hypot(a, b) || item.height;
    boxes.push(x, baseline - height, item.width, height);
  }
  return { items, endsLine, boxes: Float32Array.from(boxes) };
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
        tree.updateTextLayer();
        structure.replaceChildren(dom);
      }
    }
    return {
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
