import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { DocumentSession } from "../src/document/session.ts";
import { attachAutoLinks, coveredByLink, findLinks } from "../src/features/auto-links.ts";
import { buildPageIndex } from "../src/features/search/text-search.ts";
import type { AnnotationLayerHandle } from "../src/pdfjs/annotation-layer.ts";
import type { PageText, TextLayerHandle } from "../src/pdfjs/text.ts";
import type { ViewerExtension } from "../src/view/extensions.ts";
import type { Viewer } from "../src/view/viewer.ts";
import { settle } from "./fake-pdfjs.ts";

/** A page of `lines`, an item each, each ending a line. */
function page(...lines: string[]): PageText {
  return {
    items: lines,
    endsLine: lines.map(() => true),
    boxes: new Float32Array(lines.length * 4),
  };
}

const links = (text: PageText) =>
  findLinks(buildPageIndex(text, { caseSensitive: true, matchDiacritics: true, keepDashes: true }));

describe("findLinks", () => {
  it("finds URLs, www. addresses, and e-mail addresses, with where they are", () => {
    const found = links(
      page(
        "See https://example.com/Guide?page=2.",
        "or www.example.org/mirror",
        "Mail me@example.net",
      ),
    );
    assert.deepEqual(
      found.map(({ url }) => url),
      [
        "https://example.com/Guide?page=2",
        "http://www.example.org/mirror",
        "mailto:me@example.net",
      ],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 4 });
    assert.deepEqual(found[0]?.end, { item: 0, offset: 36 });
    assert.deepEqual(found[2]?.start, { item: 2, offset: 5 });
    assert.deepEqual(found[2]?.end, { item: 2, offset: 19 });
  });

  it("leaves out what is no address", () => {
    assert.deepEqual(links(page("version 1.2.3", "a@b.", "user@10.0.0.1", "www.example")), []);
  });

  it("keeps a hyphen at a line's end inside a URL, as pdf.js's viewer does", () => {
    const found = links(page("https://example.com/long-", "path"));
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/long-path"],
    );
    assert.deepEqual(found[0]?.end, { item: 1, offset: 4 });
  });

  it("ends a link at a line end without a hyphen", () => {
    assert.deepEqual(
      links(page("https://example.com/a", "b")).map(({ url }) => url),
      ["https://example.com/a"],
    );
  });

  it("finds a link written in several items of one line, as search reads them", () => {
    const text: PageText = {
      items: ["Visit https://exa", "mple.com today"],
      endsLine: [false, true],
      boxes: new Float32Array(8),
    };
    const found = links(text);
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/"],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 6 });
    assert.deepEqual(found[0]?.end, { item: 1, offset: 8 });
  });

  it("maps a link back through compatibility forms and ligatures", () => {
    // Full-width letters and the fi ligature, which read as their plain letters.
    const found = links(page("Go to ｈｔｔｐｓ://example.com/ﬁle now"));
    assert.deepEqual(
      found.map(({ url }) => url),
      ["https://example.com/file"],
    );
    assert.deepEqual(found[0]?.start, { item: 0, offset: 6 });
    assert.deepEqual(found[0]?.end, { item: 0, offset: 29 });
  });

  it("keeps mailto: addresses as they are", () => {
    assert.deepEqual(
      links(page("mailto:me@example.net")).map(({ url }) => url),
      ["mailto:me@example.net"],
    );
  });
});

describe("coveredByLink", () => {
  const link = { rect: [100, 100, 200, 120] as [number, number, number, number] };

  it("leaves out a link the file covers by more than half", () => {
    assert.equal(coveredByLink(link, [{ rect: [90, 95, 180, 125] }]), true);
  });

  it("keeps a link the file covers by half or less, or not at all", () => {
    assert.equal(coveredByLink(link, [{ rect: [150, 95, 300, 125] }]), false);
    assert.equal(coveredByLink(link, [{ rect: [300, 300, 400, 320] }]), false);
    assert.equal(coveredByLink(link, []), false);
    // Two of the file's links that cover two fifths each: each counts on its own.
    const twoFifths: { rect: [number, number, number, number] }[] = [
      { rect: [100, 95, 140, 125] },
      { rect: [160, 95, 200, 125] },
    ];
    assert.equal(coveredByLink(link, twoFifths), false);
  });

  it("measures a link over two lines by both lines", () => {
    // Two lines of 100 by 20 points, as quadrilaterals.
    const twoLines = {
      rect: [0, 0, 100, 60] as [number, number, number, number],
      quadPoints: [0, 60, 100, 60, 0, 40, 100, 40, 0, 20, 100, 20, 0, 0, 100, 0],
    };
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 40, 100, 60] }]), false, "one line of two");
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 30, 100, 60] }]), false);
    assert.equal(coveredByLink(twoLines, [{ rect: [0, 0, 100, 50] }]), true);
  });

  it("measures a file's link by its quadrilaterals", () => {
    // Two lines; only the second overlaps the link.
    const quadPoints = [0, 50, 50, 50, 0, 40, 50, 40, 100, 120, 200, 120, 100, 100, 200, 100];
    assert.equal(coveredByLink(link, [{ rect: [0, 40, 200, 120], quadPoints }]), true);
    const elsewhere = [0, 50, 50, 50, 0, 40, 50, 40, 0, 70, 50, 70, 0, 60, 50, 60];
    assert.equal(coveredByLink(link, [{ rect: [0, 40, 200, 120], quadPoints: elsewhere }]), false);
  });
});

describe("attachAutoLinks", () => {
  /** The text node of a text layer's span. */
  class FakeText {
    readonly data: string;
    constructor(data: string) {
      this.data = data;
    }
    get length(): number {
      return this.data.length;
    }
  }

  /** A range in a text layer, which shows as one box. */
  class FakeRange {
    setStart(): void {}
    setEnd(): void {}
    getClientRects() {
      return [{ left: 10, top: 10, right: 50, bottom: 20, width: 40, height: 10 }];
    }
  }

  const names = ["Text", "Range"];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    for (const [name, value] of [
      ["Text", FakeText],
      ["Range", FakeRange],
    ] as const) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
  });

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  /** A document whose pages read `items`, with no links of their own. */
  const documentOf = (...items: string[]) =>
    ({
      pdfjs: { pdfjs: { AnnotationType: { LINK: 2 } } },
      text: async () => ({
        items,
        endsLine: items.map(() => true),
        boxes: new Float32Array(items.length * 4),
      }),
      page: async () => ({
        getAnnotations: async () => [],
        getViewport: () => ({
          width: 100,
          height: 100,
          convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
        }),
      }),
    }) as unknown as DocumentSession;

  /** A text layer of `items`, a span each; an empty one is in no layer, as pdf.js builds it. */
  const textLayer = (...items: string[]): TextLayerHandle => {
    const container = {
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    };
    return {
      elements: items.map((item) => ({
        firstChild: item ? new FakeText(item) : null,
        closest: () => (item ? container : null),
      })) as unknown as HTMLElement[],
      structTree: null,
      update() {},
    };
  };

  /** An annotation layer that keeps the links given to it. */
  const annotationLayer = () => {
    const given: { url: string }[] = [];
    const handle = {
      layer: {
        div: { append() {}, querySelectorAll: () => [] },
        addLinkAnnotations: async (links: { url: string }[]) => {
          given.push(...links);
        },
      },
      update() {},
    } as unknown as AnnotationLayerHandle;
    return { handle, given };
  };

  /** autoLinks on a viewer with no layers yet, whose hooks the test calls for `session`. */
  const attach = (session: DocumentSession) => {
    const extensions: ViewerExtension[] = [];
    const viewer = {
      textLayers: new Map(),
      annotationLayers: new Map(),
      extend(extension: ViewerExtension) {
        extensions.push(extension);
        return () => {};
      },
    } as unknown as Viewer;
    const stop = attachAutoLinks(viewer);
    const [hooks] = extensions;
    assert.ok(hooks);
    hooks.ready?.(session, new AbortController().signal);
    return { hooks, stop };
  };

  it("finds the text layer by a span in it when the page's first item is empty", async () => {
    const items = ["", "See https://example.com/guide"];
    const { hooks, stop } = attach(documentOf(...items));
    const { handle, given } = annotationLayer();
    hooks.annotationLayer?.(0, handle);
    hooks.textLayer?.(0, textLayer(...items));
    await settle();
    assert.deepEqual(
      given.map(({ url }) => url),
      ["https://example.com/guide"],
    );
    stop();
  });

  it("links a page whose text layer was built again while its links were found", async () => {
    const items = ["See https://example.com/guide"];
    const { hooks, stop } = attach(documentOf(...items));
    const { handle, given } = annotationLayer();
    hooks.annotationLayer?.(0, handle);
    hooks.textLayer?.(0, textLayer(...items));
    hooks.textLayer?.(0, null);
    hooks.textLayer?.(0, textLayer(...items));
    await settle();
    assert.deepEqual(
      given.map(({ url }) => url),
      ["https://example.com/guide"],
      "once, in the layer built again",
    );
    stop();
  });
});
