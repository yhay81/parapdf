import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type RawDims, StructTreeBuilder } from "../src/pdfjs/struct-tree.ts";

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** As much of an element as the builder uses. */
class El {
  readonly children: El[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new Set<string>();
  readonly style: Record<string, string> = {};
  textContent = "";
  readonly localName: string;
  readonly namespaceURI: string | null;
  constructor(localName: string, namespaceURI: string | null = null) {
    this.localName = localName;
    this.namespaceURI = namespaceURI;
  }
  get id(): string {
    return this.attributes.get("id") ?? "";
  }
  set id(value: string) {
    this.attributes.set("id", value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  append(...nodes: El[]): void {
    this.children.push(...nodes);
  }
  /** Its attributes, for comparing in one assertion. */
  get attrs(): Record<string, string> {
    return Object.fromEntries(this.attributes);
  }
}

/** The text layer's spans, by id, that `document.getElementById` finds. */
const textLayer = new Map<string, El>();
const span = (id: string, text = "") => {
  const element = new El("span");
  element.id = id;
  element.textContent = text;
  textLayer.set(id, element);
  return element;
};

/** The page's tree, rendered with `rawDims`, as elements of the fake. */
async function render(tree: unknown, rawDims: RawDims | null = null) {
  const builder = new StructTreeBuilder(Promise.resolve(tree), rawDims);
  const root = (await builder.render()) as unknown as El;
  return { builder, root };
}

const content = (id: string) => ({ type: "content", id });
const LETTER: RawDims = { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 };

describe("a page's structure tree", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  before(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: (name: string) => new El(name),
        createElementNS: (namespace: string, name: string) => new El(name, namespace),
        getElementById: (id: string) => textLayer.get(id) ?? null,
      },
    });
  });
  after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else Reflect.deleteProperty(globalThis, "document");
  });

  it("is nothing for an untagged page, read once", async () => {
    const builder = new StructTreeBuilder(Promise.resolve(null), LETTER);
    assert.equal(builder.render(), builder.render());
    assert.equal(await builder.render(), null);
    assert.deepEqual(await builder.getAnnotationIds(), new Set());
    assert.equal(await builder.getAriaAttributes("1R"), null);
    builder.updateTextLayer();
  });

  it("answers no annotation's attributes when the tree cannot be read", async () => {
    const tree = Promise.reject(new Error("broken tree"));
    const builder = new StructTreeBuilder(tree, LETTER);
    await assert.rejects(builder.render(), /broken tree/);
    assert.equal(await builder.getAriaAttributes("1R"), null);
    assert.equal(await builder.getAnnotationIds(), null);
  });

  it("gives headings their level and other elements their roles, owning the text's spans", async () => {
    const { root } = await render({
      role: "Root",
      children: [
        { role: "H2", children: [content("mc0")] },
        { role: "H", children: [content("mc1"), content("mc2")] },
        { role: "P", alt: "Intro\u0000", children: [content("mc3")] },
        { role: "Figure", alt: "Chart", children: [content("mc4")] },
        { role: "NonStruct", alt: "Hidden", children: [content("mc5")] },
      ],
    });
    assert.equal(root.classList.has("structTree"), true);
    assert.deepEqual(root.attrs, {}, "a role HTML has not");
    const [h2, h, p, figure, none] = root.children as [El, El, El, El, El];
    assert.deepEqual(h2.attrs, { role: "heading", "aria-level": "2", "aria-owns": "mc0" });
    assert.deepEqual(h2.children, [], "it owns its only span itself");
    assert.deepEqual(h.attrs, { role: "heading" });
    assert.deepEqual(
      h.children.map((child) => child.attrs),
      [{ "aria-owns": "mc1" }, { "aria-owns": "mc2" }],
    );
    // A paragraph's name is prohibited: its alternative text describes it.
    assert.deepEqual(p.attrs, {
      role: "paragraph",
      "aria-description": "Intro",
      "aria-owns": "mc3",
    });
    assert.deepEqual(figure.attrs, { role: "figure", "aria-label": "Chart", "aria-owns": "mc4" });
    assert.deepEqual(none.attrs, { role: "none" });
    assert.deepEqual(none.children[0]?.attrs, { "aria-owns": "mc5" });
  });

  it("describes a table's cells by their headers, through the headers' own", async () => {
    const { root } = await render({
      role: "Table",
      children: [
        {
          role: "THead",
          children: [
            {
              role: "TR",
              children: [
                { role: "TH", structId: "h1", children: [content("mc0")] },
                { role: "TH", structId: "h2", headers: ["h1"], children: [content("mc1")] },
                { role: "TH", structId: "h3", scope: "Row", children: [content("mc2")] },
              ],
            },
          ],
        },
        {
          role: "TBody",
          children: [
            {
              role: "TR",
              children: [
                { role: "TH", structId: "r1", children: [content("mc3")] },
                {
                  role: "TD",
                  headers: ["h2", "r1", "h2", "td", "missing"],
                  rowSpan: 2,
                  colSpan: 3,
                  children: [content("mc4")],
                },
                { role: "TD", structId: "td", children: [content("mc5")] },
              ],
            },
          ],
        },
        { role: "Caption", children: [content("mc6")] },
      ],
    });
    assert.equal(root.getAttribute("role"), "table");
    const [head, body, caption] = root.children as [El, El, El];
    const [h1, h2, h3] = (head.children[0] as El).children as [El, El, El];
    const [r1, cell] = (body.children[0] as El).children as [El, El];
    assert.equal(head.getAttribute("role"), "rowgroup");
    assert.deepEqual(
      [h1, h2, h3, r1].map((th) => th.getAttribute("role")),
      ["columnheader", "columnheader", "rowheader", "rowheader"],
    );
    assert.equal(new Set([h1.id, h2.id, h3.id, r1.id]).size, 4);
    assert.deepEqual(cell.attrs, {
      role: "cell",
      "aria-owns": "mc4",
      "aria-rowspan": "2",
      "aria-colspan": "3",
      "aria-describedby": [h2.id, h1.id, r1.id].join(" "),
    });
    assert.equal(caption.getAttribute("role"), "caption");
    const { root: loose } = await render({ role: "Caption", children: [content("mc0")] });
    assert.equal(loose.getAttribute("role"), null, "a caption outside a table or figure");
  });

  it("places a figure's alternative text in the text layer, over the figure's box", async () => {
    const tree = {
      role: "Figure",
      alt: "A chart",
      bbox: [72, 500, 272, 700],
      children: [content("mc0")],
    };
    const { builder, root } = await render(tree, { ...LETTER, pageX: 10, pageY: 20 });
    assert.deepEqual(root.attrs, { role: "figure", "aria-owns": "mc0" });
    const text = span("mc0");
    span("mc0-other");
    builder.updateTextLayer();
    const [img] = text.children as [El];
    assert.deepEqual(img.attrs, { role: "img", "aria-label": "A chart" });
    const calc = (value: number) => `calc(var(--total-scale-factor) *${value}px)`;
    assert.deepEqual(img.style, {
      width: calc(200),
      height: calc(200),
      left: calc(62),
      top: calc(112),
    });
    builder.updateTextLayer();
    assert.equal(text.children.length, 1, "added once");
    // Without the page's dimensions, or a box, the figure is labelled itself.
    const { root: labelled } = await render({ ...tree, bbox: undefined }, LETTER);
    assert.equal(labelled.getAttribute("aria-label"), "A chart");
  });

  it("labels annotations, and gives a link's text to its annotation when asked", async () => {
    const { builder, root } = await render({
      role: "Root",
      children: [
        {
          role: "Link",
          alt: "Docs",
          children: [{ type: "annotation", id: "12R" }, content("mc0"), content("mc1")],
        },
        { role: "Annot", children: [{ type: "annotation", id: "13R" }] },
      ],
    });
    assert.deepEqual(await builder.getAnnotationIds(), new Set(["12R", "13R"]));
    const [link, annot] = root.children as [El, El];
    assert.deepEqual(link.attrs, { role: "link" }, "the annotation takes the label");
    assert.deepEqual(annot.attrs, { role: "note", "aria-owns": "13R" });
    assert.deepEqual(await builder.getAriaAttributes("12R"), new Map([["aria-label", "Docs"]]));
    assert.equal(link.getAttribute("role"), "link", "not without link ownership");
    const owned = link.children.slice(1).map((child) => child.id);
    assert.equal(owned.length, 2);
    assert.ok(owned.every((id) => id !== ""));
    const attributes = new Map([
      ["aria-label", "Docs"],
      ["aria-owns", owned.join(" ")],
    ]);
    assert.deepEqual(
      await builder.getAriaAttributes("12R", { enableLinkOwnership: true }),
      attributes,
    );
    assert.equal(link.getAttribute("role"), null, "the annotation is the link now");
    assert.deepEqual(await builder.getAriaAttributes("12R"), attributes);
    assert.equal(await builder.getAriaAttributes("13R"), null);
  });

  it("writes formulas and MathML elements as MathML, with the text they stand for", async () => {
    span("mc0", "  x ");
    span("mc1", "2");
    const { builder, root } = await render({
      role: "Root",
      children: [
        { role: "Formula", alt: "x squared", children: [content("mc2")] },
        {
          role: "msup",
          children: [
            { role: "mi", children: [content("mc0")] },
            { role: "mn", children: [content("mc1")] },
          ],
        },
      ],
    });
    const [formula, msup] = root.children as [El, El];
    assert.equal(formula.localName, "math");
    assert.equal(formula.namespaceURI, MATHML);
    assert.deepEqual(formula.attrs, { "aria-owns": "mc2" }, "its alternative text goes");
    assert.equal(msup.namespaceURI, MATHML);
    const [mi, mn] = msup.children as [El, El];
    builder.updateTextLayer();
    assert.deepEqual([mi.textContent, mn.textContent], ["x", "2"]);
    assert.equal(textLayer.get("mc0")?.getAttribute("aria-hidden"), "true");
  });

  it("gives an element its language, summary, and abbreviation", async () => {
    const { root } = await render({
      role: "Sect",
      structId: "s1",
      lang: "fr\u0001CA",
      summary: "Résumé",
      short: "Dr.",
      children: [content("mc0"), content("mc1")],
    });
    assert.equal(root.getAttribute("role"), "group");
    assert.equal(root.getAttribute("lang"), "fr CA");
    assert.equal(root.getAttribute("aria-description"), "Résumé");
    const abbreviation = root.children[0] as El;
    assert.equal(abbreviation.getAttribute("aria-hidden"), "true");
    assert.equal(abbreviation.textContent, "Dr.");
    assert.ok(abbreviation.id);
    assert.equal(root.id, "", "the abbreviation takes the element's id");
  });
});
