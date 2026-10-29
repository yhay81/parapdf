import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getSelection } from "../src/features/selection.ts";
import type { Viewer } from "../src/view/viewer.ts";

/** A node of a small DOM tree. */
class FakeNode {
  parentNode: FakeElement | null = null;
  readonly childNodes: FakeNode[] = [];
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  contains(node: FakeNode | null): boolean {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
}

class FakeText extends FakeNode {
  readonly data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
  override get textContent(): string {
    return this.data;
  }
}

/** An element that matches the selectors it is given. */
class FakeElement extends FakeNode {
  readonly selectors: readonly string[];
  readonly dataset: Record<string, string> = {};
  constructor(selectors: readonly string[], ...children: FakeNode[]) {
    super();
    this.selectors = selectors;
    for (const child of children) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  closest(selector: string): FakeElement | null {
    for (let at: FakeElement | null = this; at; at = at.parentNode) {
      if (at.selectors.includes(selector)) return at;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.childNodes.flatMap((child) =>
      child instanceof FakeElement
        ? [
            ...(child.selectors.includes(selector) ? [child] : []),
            ...child.querySelectorAll(selector),
          ]
        : [],
    );
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

type Point = readonly [FakeNode, number];

/** A boundary point's place in document order: the child indexes down to its node, then its offset. */
const placeOf = ([node, offset]: Point): number[] => {
  const place = [offset];
  for (let at = node; at.parentNode; at = at.parentNode) {
    place.unshift(at.parentNode.childNodes.indexOf(at));
  }
  return place;
};

const compare = (a: Point, b: Point): number => {
  const [x, y] = [placeOf(a), placeOf(b)];
  for (let at = 0; at < Math.min(x.length, y.length); at++) {
    if (x[at] !== y[at]) return Math.sign((x[at] ?? 0) - (y[at] ?? 0));
  }
  return Math.sign(x.length - y.length);
};

/** A DOM range over the fake tree, with the DOM's checks. */
class FakeRange {
  static readonly START_TO_START = 0;
  start: Point | null = null;
  end: Point | null = null;
  commonAncestorContainer: FakeNode | null = null;
  get startContainer() {
    return this.start?.[0];
  }
  get startOffset() {
    return this.start?.[1];
  }
  get endContainer() {
    return this.end?.[0];
  }
  get endOffset() {
    return this.end?.[1];
  }
  setStart(node: FakeNode, offset: number): void {
    this.start = [node, offset];
  }
  setEnd(node: FakeNode, offset: number): void {
    this.end = [node, offset];
  }
  selectNodeContents(node: FakeNode): void {
    this.start = [node, 0];
    this.end = [node, node instanceof FakeText ? node.data.length : node.childNodes.length];
  }
  selectNode(node: FakeNode): void {
    const parent = node.parentNode;
    if (!parent) throw new DOMException("The node has no parent.", "InvalidNodeTypeError");
    const index = parent.childNodes.indexOf(node);
    this.start = [parent, index];
    this.end = [parent, index + 1];
  }
  compareBoundaryPoints(_how: number, source: FakeRange): number {
    if (!this.start || !source.start) throw new Error("a range without a start");
    return compare(this.start, source.start);
  }
  intersectsNode(): boolean {
    return true;
  }
  toString(): string {
    const { start, end } = this;
    if (!start || !end) return "";
    let root = start[0];
    while (root.parentNode) root = root.parentNode;
    let text = "";
    const visit = (node: FakeNode) => {
      if (node instanceof FakeText) {
        for (let at = 0; at < node.data.length; at++) {
          if (compare([node, at], start) >= 0 && compare([node, at + 1], end) <= 0) {
            text += node.data[at];
          }
        }
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return text;
  }
}

describe("getSelection", () => {
  const names = ["document", "Element", "Range"];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  let range = new FakeRange();

  beforeEach(() => {
    for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const document = {
      getSelection: () => ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => range.toString(),
      }),
      createRange: () => new FakeRange(),
    };
    for (const [name, value] of Object.entries({
      document,
      Element: FakeElement,
      Range: FakeRange,
    })) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
  });

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  /**
   * A viewer of a page whose text is "Hello", an empty item that ends the
   * line, and "World": pdf.js keeps a run for the empty item but leaves it
   * out of the layer, which holds the line end's <br> and `.endOfContent`.
   */
  function page() {
    const hello = new FakeElement([], new FakeText("Hello"));
    const empty = new FakeElement([]);
    const world = new FakeElement([], new FakeText("World"));
    const end = new FakeElement([]);
    const layer = new FakeElement([".parapdf-text-layer"], hello, new FakeElement([]), world, end);
    const section = new FakeElement(["section[data-page]"], layer);
    section.dataset.page = "1";
    const viewer = {
      content: new FakeElement([], section),
      store: { get: () => ({ layout: { sizes: [{ width: 612, height: 792 }], rotation: 0 } }) },
      textLayers: new Map([[0, { elements: [hello, empty, world] }]]),
    } as unknown as Viewer;
    return { viewer, layer, hello, world, end };
  }

  /** The ends of a selection from `start` to `end`, as items and offsets. */
  function ends(viewer: Viewer, start: Point, end: Point) {
    range = new FakeRange();
    range.setStart(...start);
    range.setEnd(...end);
    range.commonAncestorContainer = start[0];
    const selection = getSelection(viewer);
    return [selection?.text, selection?.start, selection?.end].map((at) =>
      at && typeof at === "object" ? [at.item, at.offset] : at,
    );
  }

  it("places an end between runs at the next run, past runs left out of the layer", () => {
    const { viewer, layer, hello, world, end } = page();
    const [first, second] = [hello.childNodes[0], world.childNodes[0]] as FakeNode[];
    assert.ok(first && second);
    assert.deepEqual(ends(viewer, [first, 1], [second, 3]), ["elloWor", [0, 1], [2, 3]]);
    // Before the first run, between the line end and "World", and on the
    // blank space after the runs, where `.endOfContent` is.
    assert.deepEqual(ends(viewer, [layer, 0], [layer, 2]), ["Hello", [0, 0], [2, 0]]);
    assert.deepEqual(ends(viewer, [first, 4], [end, 0]), ["oWorld", [0, 4], [2, 5]]);
  });
});
