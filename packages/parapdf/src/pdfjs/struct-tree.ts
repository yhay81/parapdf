// Derived from PDF.js `web/struct_tree_layer_builder.js` (pdfjs-dist 6.4.299),
// Copyright Mozilla Foundation, Apache License 2.0, and changed for ParaPDF;
// see NOTICE.md.

/**
 * The structure tree of a tagged PDF page as accessible fallback content.
 * Ported from `StructTreeLayerBuilder` in PDF.js
 * `web/struct_tree_layer_builder.js`.
 *
 * pdf.js's text layer wraps the runs of each marked-content sequence in a
 * span whose id the structure tree refers to. The tree becomes elements
 * with ARIA roles (headings, paragraphs, lists, tables, figures) whose
 * `aria-owns` take the text layer's spans in, so assistive technology reads
 * the page in its tagged order and structure. Figures' alternative text
 * becomes an image placed in the text layer, and annotations named in the
 * tree get their labels through `getAriaAttributes`, which pdf.js's
 * annotation layer calls.
 */

/** A node of the tree pdf.js's `PDFPageProxy.getStructTree()` returns. */
interface StructNode {
  role?: string;
  type?: string;
  id?: string;
  structId?: string;
  alt?: string;
  lang?: string;
  short?: string;
  summary?: string;
  scope?: string;
  rowSpan?: number;
  colSpan?: number;
  headers?: string[];
  bbox?: number[];
  mathML?: string;
  children?: StructNode[];
}

/** The page's dimensions in PDF points, pdf.js's `PageViewport.rawDims`. */
export interface RawDims {
  pageWidth: number;
  pageHeight: number;
  pageX: number;
  pageY: number;
}

const PDF_ROLE_TO_HTML_ROLE: Record<string, string | null> = {
  // Document level structure types
  Document: null, // There's a "document" role, but it doesn't make sense here.
  DocumentFragment: null,
  // Grouping level structure types
  Part: "group",
  Art: "article",
  Sect: "group",
  Div: "group",
  BlockQuote: "blockquote",
  Aside: "note",
  NonStruct: "none",
  // Block level structure types
  P: "paragraph",
  // H<n>,
  H: "heading",
  Title: null,
  FENote: "note",
  // Sub-block level structure type
  Sub: "group",
  // General inline level structure types
  Lbl: null,
  Span: null,
  Em: "emphasis",
  Strong: "strong",
  Note: "note",
  Code: "code",
  Link: "link",
  Annot: "note",
  Form: "form",
  // Ruby and warichu structure types
  Ruby: null,
  RB: null,
  RT: null,
  RP: null,
  Warichu: null,
  WT: null,
  WP: null,
  // List standard structure types
  L: "list",
  LI: "listitem",
  LBody: null,
  // Table standard structure types
  Table: "table",
  TR: "row",
  TH: "columnheader",
  TD: "cell",
  THead: "rowgroup",
  TBody: "rowgroup",
  TFoot: "rowgroup",
  // Standard structure type Caption
  Caption: "caption",
  // Standard structure type Figure
  Figure: "figure",
  // Standard structure type Formula
  Formula: null,
  // standard structure type Artifact
  Artifact: null,
};

const ARIA_ROLES_WITH_PROHIBITED_NAMES = new Set([
  "caption",
  "code",
  "emphasis",
  "generic",
  "none",
  "paragraph",
  "strong",
]);

const MATHML_ELEMENTS = new Set([
  "math",
  "merror",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "semantics",
]);
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

const MATHML_ATTRIBUTES = [
  "dir",
  "displaystyle",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "scriptlevel",
  "encoding",
  "display",
  "linethickness",
  "intent",
  "arg",
  "form",
  "fence",
  "separator",
  "lspace",
  "rspace",
  "stretchy",
  "symmetric",
  "maxsize",
  "minsize",
  "largeop",
  "movablelimits",
  "width",
  "height",
  "depth",
  "voffset",
  "accent",
  "accentunder",
  "columnspan",
  "rowspan",
];

/** The HTML Sanitizer API, where the browser has it, which TypeScript's DOM library lacks. */
interface SanitizerApi {
  Sanitizer: new (config: unknown) => unknown;
}
interface SettableHtml {
  setHTML(html: string, options: { sanitizer: unknown }): void;
}

let mathMLSanitizer: unknown | undefined;

/** A sanitizer that keeps MathML only, or null where the browser has no Sanitizer API. */
function getMathMLSanitizer(): unknown | null {
  if (mathMLSanitizer !== undefined) return mathMLSanitizer;
  const api = globalThis as unknown as Partial<SanitizerApi>;
  mathMLSanitizer =
    typeof api.Sanitizer === "function" && "setHTML" in Element.prototype
      ? new api.Sanitizer({
          elements: Array.from(MATHML_ELEMENTS, (name) => ({ name, namespace: MATHML_NAMESPACE })),
          replaceWithChildrenElements: [{ name: "maction", namespace: MATHML_NAMESPACE }],
          attributes: MATHML_ATTRIBUTES,
          comments: false,
        })
      : null;
  return mathMLSanitizer;
}

const HEADING_PATTERN = /^H(\d+)$/;

/** pdf.js's removeNullCharacters: drops NUL and, when asked, turns control characters into spaces. */
function removeNullCharacters(text: string, replaceInvisible = false): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it replaces.
  const visible = replaceInvisible ? text.replaceAll(/[\x00-\x1F]/g, " ") : text;
  return visible.replaceAll("\x00", "");
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

let builders = 0;

export class StructTreeBuilder {
  #treePromise: Promise<Element | null> | undefined;
  readonly #treeSource: Promise<StructNode | null>;
  #treeDom: Element | null = null;
  readonly #annotationIds = new Set<string>();
  readonly #elementAttributes = new Map<string, Map<string, string>>();
  readonly #pendingLinkOwnership = new Map<string, { element: Element; ids: string[] }>();
  #linkTextId = 0;
  readonly #structElementIdPrefix = `parapdf_struct_${builders++}_`;
  readonly #structElementIds = new Map<string, string>();
  readonly #structElements = new Map<string, StructNode>();
  readonly #rawDims: RawDims | null;
  #elementsToAddToTextLayer: Map<string, HTMLElement> | null = null;
  #elementsToHideInTextLayer: string[] | null = null;
  #elementsToStealFromTextLayer: (Element | string[])[] | null = null;

  /** `tree` is the page's `getStructTree()`. */
  constructor(tree: Promise<unknown>, rawDims: RawDims | null) {
    this.#treeSource = tree as Promise<StructNode | null>;
    this.#rawDims = rawDims;
  }

  /** The tree as elements, or null for an untagged page. */
  render(): Promise<Element | null> {
    this.#treePromise ??= this.#treeSource.then((tree) => {
      this.#collectStructElements(tree);
      this.#collectAnnotations(tree);
      this.#treeDom = this.#walk(tree);
      this.#treeDom?.classList.add("structTree");
      return this.#treeDom;
    });
    return this.#treePromise;
  }

  /** The ARIA attributes the tree gives an annotation's element; pdf.js's annotation layer calls this. */
  async getAriaAttributes(
    annotationId: string,
    { enableLinkOwnership = false } = {},
  ): Promise<Map<string, string> | null> {
    try {
      await this.render();
      const ownership = this.#pendingLinkOwnership.get(annotationId);
      if (ownership && enableLinkOwnership) {
        const { element, ids } = ownership;
        element.removeAttribute("role");
        if (ids.length > 0) {
          getOrCreate(this.#elementAttributes, annotationId, () => new Map()).set(
            "aria-owns",
            ids.join(" "),
          );
        }
        this.#pendingLinkOwnership.delete(annotationId);
      }
      return this.#elementAttributes.get(annotationId) ?? null;
    } catch {
      return null;
    }
  }

  async getAnnotationIds(): Promise<Set<string> | null> {
    try {
      await this.render();
      return this.#annotationIds;
    } catch {
      return null;
    }
  }

  /** Adds figures' images to the rendered text layer and hides the text MathML replaces. */
  updateTextLayer(): void {
    if (this.#elementsToAddToTextLayer) {
      for (const [id, img] of this.#elementsToAddToTextLayer) {
        document.getElementById(id)?.append(img);
      }
      this.#elementsToAddToTextLayer = null;
    }
    if (this.#elementsToHideInTextLayer) {
      for (const id of this.#elementsToHideInTextLayer) {
        document.getElementById(id)?.setAttribute("aria-hidden", "true");
      }
      this.#elementsToHideInTextLayer = null;
    }
    if (this.#elementsToStealFromTextLayer) {
      for (let i = 0; i < this.#elementsToStealFromTextLayer.length; i += 2) {
        const element = this.#elementsToStealFromTextLayer[i] as Element;
        const ids = this.#elementsToStealFromTextLayer[i + 1] as string[];
        let textContent = "";
        for (const id of ids) {
          const owned = document.getElementById(id);
          if (owned) {
            textContent += owned.textContent?.trim() || "";
            owned.setAttribute("aria-hidden", "true");
          }
        }
        if (textContent) element.textContent = textContent;
      }
      this.#elementsToStealFromTextLayer = null;
    }
  }

  #collectStructElements(node: StructNode | null | undefined): void {
    if (!node) return;
    if (node.structId && !this.#structElements.has(node.structId)) {
      this.#structElements.set(node.structId, node);
    }
    for (const child of node.children || []) this.#collectStructElements(child);
  }

  #collectAnnotations(node: StructNode | null | undefined): void {
    if (!node) return;
    if (node.type === "annotation" && node.id) {
      this.#annotationIds.add(node.id);
      return;
    }
    for (const child of node.children || []) this.#collectAnnotations(child);
  }

  #getStructElementId(structId: string): string {
    return getOrCreate(
      this.#structElementIds,
      structId,
      () => `${this.#structElementIdPrefix}${this.#structElementIds.size}`,
    );
  }

  #getHeaderIds(headers: string[]): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const pending = headers.toReversed();
    while (pending.length > 0) {
      const structId = pending.pop() as string;
      if (visited.has(structId)) continue;
      visited.add(structId);
      const header = this.#structElements.get(structId);
      if (header?.role !== "TH") continue;
      result.push(this.#getStructElementId(structId));
      if (header.headers) {
        for (let i = header.headers.length - 1; i >= 0; i--) {
          pending.push(header.headers[i] as string);
        }
      }
    }
    return result;
  }

  #setAttributes(structElement: StructNode, htmlElement: Element): void {
    const { alt, colSpan, headers, id, lang, rowSpan, short, structId, summary } = structElement;
    if (alt !== undefined) {
      // Don't add the label in the struct tree layer but on the annotation
      // in the annotation layer.
      let added = false;
      const label = removeNullCharacters(alt);
      for (const child of structElement.children || []) {
        if (child.type === "annotation" && child.id) {
          getOrCreate(this.#elementAttributes, child.id, () => new Map()).set("aria-label", label);
          added = true;
        }
      }
      const role =
        htmlElement.getAttribute("role") || (htmlElement.localName === "span" ? "generic" : null);
      if (!added && role !== "none") {
        htmlElement.setAttribute(
          role && ARIA_ROLES_WITH_PROHIBITED_NAMES.has(role) ? "aria-description" : "aria-label",
          label,
        );
      }
    }
    if (id !== undefined) htmlElement.setAttribute("aria-owns", id);
    if (structId !== undefined && this.#structElements.get(structId) === structElement) {
      const elementId = this.#getStructElementId(structId);
      if (short !== undefined) {
        const abbreviation = document.createElement("span");
        abbreviation.setAttribute("id", elementId);
        abbreviation.setAttribute("aria-hidden", "true");
        abbreviation.textContent = removeNullCharacters(short);
        htmlElement.append(abbreviation);
      } else {
        htmlElement.setAttribute("id", elementId);
      }
    }
    if (lang !== undefined) htmlElement.setAttribute("lang", removeNullCharacters(lang, true));
    if (rowSpan !== undefined) htmlElement.setAttribute("aria-rowspan", String(rowSpan));
    if (colSpan !== undefined) htmlElement.setAttribute("aria-colspan", String(colSpan));
    if (headers && headers.length > 0) {
      const headerIds = this.#getHeaderIds(headers);
      if (headerIds.length > 0) htmlElement.setAttribute("aria-describedby", headerIds.join(" "));
    }
    if (summary !== undefined) {
      htmlElement.setAttribute("aria-description", removeNullCharacters(summary));
    }
  }

  #addImageInTextLayer(node: StructNode, element: Element): boolean {
    const { alt, bbox, children } = node;
    const child = children?.[0];
    if (!this.#rawDims || !alt || !bbox || child?.type !== "content") return false;
    const { id } = child;
    if (!id) return false;
    // We cannot add the image directly to the structure tree because the
    // text layer may not be rendered yet: it is added to the text layer
    // once it is.
    element.setAttribute("aria-owns", id);
    const img = document.createElement("span");
    this.#elementsToAddToTextLayer ??= new Map();
    this.#elementsToAddToTextLayer.set(id, img);
    img.setAttribute("role", "img");
    img.setAttribute("aria-label", removeNullCharacters(alt));
    const { pageHeight, pageX, pageY } = this.#rawDims;
    const calc = "calc(var(--total-scale-factor) *";
    const { style } = img;
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = bbox;
    style.width = `${calc}${x1 - x0}px)`;
    style.height = `${calc}${y1 - y0}px)`;
    style.left = `${calc}${x0 - pageX}px)`;
    style.top = `${calc}${pageHeight - y1 + pageY}px)`;
    return true;
  }

  #collectIds(node: StructNode | null | undefined, ids: string[]): void {
    if (!node) return;
    if (node.id !== undefined) ids.push(node.id);
    for (const kid of node.children || []) this.#collectIds(kid, ids);
  }

  #walk(node: StructNode | null | undefined, parentNodes: StructNode[] = []): Element | null {
    if (!node) return null;
    let element: Element | null = null;
    let visitChildren = true;
    if (node.role !== undefined) {
      const { role } = node;
      if (MATHML_ELEMENTS.has(role)) {
        element = document.createElementNS(MATHML_NAMESPACE, role);
        const ids: string[] = [];
        this.#elementsToStealFromTextLayer ??= [];
        this.#elementsToStealFromTextLayer.push(element, ids);
        for (const { type, id } of node.children || []) {
          if (type === "content" && id) ids.push(id);
        }
      } else {
        element = document.createElement("span");
      }
      const match = role.match(HEADING_PATTERN);
      if (match) {
        element.setAttribute("role", "heading");
        element.setAttribute("aria-level", match[1] as string);
      } else if (PDF_ROLE_TO_HTML_ROLE[role]) {
        let htmlRole: string | null = PDF_ROLE_TO_HTML_ROLE[role] ?? null;
        if (role === "TH") {
          if (node.scope === "Row") htmlRole = "rowheader";
          else if (node.scope === "Column") htmlRole = "columnheader";
          else if (parentNodes.at(-1)?.role === "TR" && parentNodes.at(-2)?.role === "TBody") {
            htmlRole = "rowheader";
          }
        } else if (role === "Caption") {
          const parentRole = parentNodes.at(-1)?.role;
          if (parentRole !== "Table" && parentRole !== "Figure") htmlRole = null;
        }
        if (htmlRole) element.setAttribute("role", htmlRole);
      }
      if (role === "Figure" && this.#addImageInTextLayer(node, element)) return element;
      if (role === "Formula") {
        const sanitizer = node.mathML ? getMathMLSanitizer() : null;
        if (node.mathML && sanitizer) {
          visitChildren = false;
          (element as unknown as SettableHtml).setHTML(node.mathML, { sanitizer });
          // Hide the text layer content the MathML stands for.
          this.#elementsToHideInTextLayer ??= [];
          this.#collectIds(node, this.#elementsToHideInTextLayer);
          delete node.alt;
        }
        if (!node.mathML && node.children?.length === 1 && node.children[0]?.role !== "math") {
          element = document.createElementNS(MATHML_NAMESPACE, "math");
          delete node.alt;
        }
      }
    }
    element ??= document.createElement("span");
    this.#setAttributes(node, element);
    if (node.children) {
      const only = node.children[0];
      if (
        node.children.length === 1 &&
        only !== undefined &&
        only.role === undefined &&
        only.id !== undefined &&
        element.getAttribute("role") !== "none"
      ) {
        // Avoid a span that only owns one other element: own it directly.
        this.#setAttributes(only, element);
      } else if (visitChildren) {
        parentNodes.push(node);
        for (const kid of node.children) {
          const child = this.#walk(kid, parentNodes);
          if (child) element.append(child);
        }
        parentNodes.pop();
      }
    }
    if (node.role === "Link") {
      const annotations = node.children?.filter((child) => child.type === "annotation");
      const annotation = annotations?.length === 1 ? annotations[0] : undefined;
      if (annotation?.id) {
        const ids: string[] = [];
        for (const child of element.children) {
          if (child.getAttribute("aria-owns") === annotation.id) continue;
          child.id ||= `${this.#structElementIdPrefix}link_${this.#linkTextId++}`;
          ids.push(child.id);
        }
        this.#pendingLinkOwnership.set(annotation.id, { element, ids });
      }
    }
    return element;
  }
}
