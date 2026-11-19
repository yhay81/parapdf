import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getSelection } from "../src/features/selection.ts";
import { TextSelectionTracker } from "../src/render/selection.ts";
import type { ViewerController } from "../src/view/viewer.ts";

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
    const content = new FakeElement([], section);
    content.querySelectorAll = () => {
      throw new Error("getSelection must read viewer.textLayers rather than querySelectorAll");
    };
    const viewer = {
      content,
      pageHost: (index: number) => (index === 0 ? section : undefined),
      store: { get: () => ({ layout: { sizes: [{ width: 612, height: 792 }], rotation: 0 } }) },
      textLayers: new Map([[0, { layer, elements: [hello, empty, world] }]]),
    } as unknown as ViewerController;
    return { viewer, layer, hello, world, end };
  }

  /** The ends of a selection from `start` to `end`, as items and offsets. */
  function ends(viewer: ViewerController, start: Point, end: Point) {
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

describe("TextSelectionTracker", () => {
  const names = [
    "document",
    "window",
    "navigator",
    "CSS",
    "Element",
    "HTMLElement",
    "Node",
    "Range",
  ];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    saved.clear();
  });

  it("clears userSelect on reset and avoids WrongDocumentError after a selected page unmounts in WebKit", () => {
    for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));

    class TrackerNode {
      nodeType = 1;
      parentNode: TrackerElement | null = null;
      readonly childNodes: TrackerNode[] = [];
      get parentElement(): TrackerElement | null {
        return this.parentNode;
      }
      get firstChild(): TrackerNode | null {
        return this.childNodes[0] ?? null;
      }
      get lastChild(): TrackerNode | null {
        return this.childNodes.at(-1) ?? null;
      }
      get nextSibling(): TrackerNode | null {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
      }
      get previousSibling(): TrackerNode | null {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx > 0 ? (this.parentNode.childNodes[idx - 1] ?? null) : null;
      }
      get isConnected(): boolean {
        return this.getRootNode() === docRoot;
      }
      getRootNode(): TrackerNode {
        let cur: TrackerNode = this;
        while (cur.parentNode) cur = cur.parentNode;
        return cur;
      }
      hasChildNodes(): boolean {
        return this.childNodes.length > 0;
      }
      contains(other: TrackerNode | null): boolean {
        for (let cur = other; cur; cur = cur.parentNode) if (cur === this) return true;
        return false;
      }
    }

    class TrackerText extends TrackerNode {
      override nodeType = 3;
      readonly data: string;
      constructor(data: string) {
        super();
        this.data = data;
      }
    }

    class TrackerElement extends TrackerNode {
      className = "";
      readonly style: Record<string, string> = { width: "600px", height: "800px", userSelect: "" };
      readonly classes = new Set<string>();
      readonly classList = {
        add: (...tokens: string[]) => {
          for (const token of tokens) this.classes.add(token);
        },
        remove: (...tokens: string[]) => {
          for (const token of tokens) this.classes.delete(token);
        },
      };
      append(...nodes: TrackerNode[]): void {
        for (const node of nodes) this.insertBefore(node, null);
      }
      insertBefore(node: TrackerNode, ref: TrackerNode | null): TrackerNode {
        if (node.parentNode) {
          const prevIdx = node.parentNode.childNodes.indexOf(node);
          if (prevIdx >= 0) node.parentNode.childNodes.splice(prevIdx, 1);
        }
        node.parentNode = this;
        const at = ref ? this.childNodes.indexOf(ref) : -1;
        if (at >= 0) this.childNodes.splice(at, 0, node);
        else this.childNodes.push(node);
        return node;
      }
      replaceChildren(): void {
        for (const child of this.childNodes) child.parentNode = null;
        this.childNodes.length = 0;
      }
      closest(selector: string): TrackerElement | null {
        for (let cur: TrackerElement | null = this; cur; cur = cur.parentNode) {
          if (selector === ".parapdf-text-layer" && cur.className === "parapdf-text-layer") {
            return cur;
          }
        }
        return null;
      }
    }

    class StrictRange {
      static readonly START_TO_START = 0;
      static readonly START_TO_END = 1;
      static readonly END_TO_END = 2;
      static readonly END_TO_START = 3;
      startContainer!: TrackerNode;
      startOffset = 0;
      endContainer!: TrackerNode;
      endOffset = 0;
      setStart(node: TrackerNode, offset: number): void {
        this.startContainer = node;
        this.startOffset = offset;
        if (!this.endContainer) {
          this.endContainer = node;
          this.endOffset = offset;
        }
      }
      setEnd(node: TrackerNode, offset: number): void {
        this.endContainer = node;
        this.endOffset = offset;
      }
      cloneRange(): StrictRange {
        const copy = new StrictRange();
        copy.startContainer = this.startContainer;
        copy.startOffset = this.startOffset;
        copy.endContainer = this.endContainer;
        copy.endOffset = this.endOffset;
        return copy;
      }
      intersectsNode(node: TrackerNode): boolean {
        return node.contains(this.startContainer) || node.contains(this.endContainer);
      }
      comparePoint(): number {
        return 1;
      }
      compareBoundaryPoints(how: number, source: StrictRange): number {
        // Per WHATWG DOM §5.5: different roots throw WrongDocumentError.
        if (this.startContainer.getRootNode() !== source.startContainer.getRootNode()) {
          throw new DOMException("Different roots", "WrongDocumentError");
        }
        if (how === StrictRange.START_TO_START) {
          return this.startContainer === source.startContainer
            ? Math.sign(this.startOffset - source.startOffset)
            : 1;
        }
        if (how === StrictRange.END_TO_END) {
          return this.endContainer === source.endContainer
            ? Math.sign(this.endOffset - source.endOffset)
            : 1;
        }
        return 1;
      }
    }

    const docRoot = new TrackerElement();
    const docListeners = new Map<string, ((event?: unknown) => void)[]>();
    const winListeners = new Map<string, ((event?: unknown) => void)[]>();
    let activeRange: StrictRange | null = null;

    const fakeDoc = {
      addEventListener(type: string, fn: (event?: unknown) => void) {
        docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
      },
      createRange: () => new StrictRange(),
      getSelection: () => ({
        get rangeCount() {
          return activeRange ? 1 : 0;
        },
        get isCollapsed() {
          return !activeRange;
        },
        get focusNode() {
          return activeRange?.endContainer ?? null;
        },
        get focusOffset() {
          return activeRange?.endOffset ?? 0;
        },
        getRangeAt: () => activeRange,
        toString: () => "text",
      }),
    };
    const fakeWin = {
      addEventListener(type: string, fn: (event?: unknown) => void) {
        winListeners.set(type, [...(winListeners.get(type) ?? []), fn]);
      },
    };

    for (const [name, value] of Object.entries({
      document: fakeDoc,
      window: fakeWin,
      navigator: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15",
      },
      CSS: { supports: () => false },
      Element: TrackerElement,
      HTMLElement: TrackerElement,
      Node: { TEXT_NODE: 3 },
      Range: StrictRange,
    })) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }

    const makeLayer = (label: string) => {
      const layer = new TrackerElement();
      layer.className = "parapdf-text-layer";
      const span = new TrackerElement();
      const text = new TrackerText(label);
      span.append(text);
      const end = new TrackerElement();
      end.className = "endOfContent";
      layer.append(span, end);
      docRoot.append(layer);
      return { layer, span, text, end };
    };

    const page1 = makeLayer("Page one");
    const page2 = makeLayer("Page two");
    const tracker = new TextSelectionTracker();
    tracker.add(page1.layer as unknown as HTMLElement, page1.end as unknown as HTMLElement);
    tracker.add(page2.layer as unknown as HTMLElement, page2.end as unknown as HTMLElement);

    const fireDoc = (type: string, event?: unknown) => {
      for (const fn of docListeners.get(type) ?? []) fn(event);
    };

    // Select on page 1: WebKit moves `.endOfContent` with inline `userSelect = "text"`.
    activeRange = new StrictRange();
    activeRange.setStart(page1.text, 0);
    activeRange.setEnd(page1.text, 4);
    fireDoc("selectionchange");
    assert.equal(page1.end.style.userSelect, "text");

    // Pointer release resets `.endOfContent` back to the end of its layer AND clears inline `userSelect`.
    fireDoc("pointerup");
    assert.equal(page1.end.style.userSelect, "");
    assert.equal(page1.layer.lastChild, page1.end);

    // Unmount page 1 (detaching its text nodes as DomLayers.detach does), then select on page 2:
    // must not throw WrongDocumentError comparing against detached #previousRange.
    tracker.remove(page1.layer as unknown as HTMLElement);
    page1.layer.replaceChildren();
    activeRange = new StrictRange();
    activeRange.setStart(page2.text, 0);
    activeRange.setEnd(page2.text, 4);
    assert.doesNotThrow(() => fireDoc("selectionchange"));
    assert.equal(page2.end.style.userSelect, "text");

    // Even if a node detaches without remove(), selectionchange guards isConnected / root equality.
    page2.span.parentNode = null;
    const page3 = makeLayer("Page three");
    tracker.add(page3.layer as unknown as HTMLElement, page3.end as unknown as HTMLElement);
    activeRange = new StrictRange();
    activeRange.setStart(page3.text, 0);
    activeRange.setEnd(page3.text, 4);
    assert.doesNotThrow(() => fireDoc("selectionchange"));

    tracker.clear();
  });
});
