/**
 * The little of the DOM the renderer uses to build a page inside its host:
 * elements that hold children, styles, and canvases whose size counts
 * their pixels.
 */
export class FakeElement {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = "";
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  /** A new canvas is 300 by 150, as in browsers. */
  width = 300;
  height = 150;
  /** Drawings copied into this canvas with `drawImage`. */
  readonly copied: FakeElement[] = [];

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    const style = {
      setProperty(name: string, value: string) {
        style[name] = value;
      },
      removeProperty(name: string) {
        delete style[name];
      },
    } as FakeElement["style"];
    this.style = style;
  }

  get parentElement(): FakeElement | null {
    return this.parent;
  }

  get parentNode(): FakeElement | null {
    return this.parent;
  }

  get previousSibling(): FakeElement | null {
    const siblings = this.parent?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  prepend(...nodes: FakeElement[]): void {
    for (const node of nodes) node.remove();
    for (const node of nodes) node.parent = this;
    this.children.unshift(...nodes);
  }

  after(node: FakeElement): void {
    const parent = this.parent;
    if (!parent) return;
    node.remove();
    node.parent = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }

  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  replaceChildren(): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  getContext(): { drawImage(source: FakeElement): void } {
    return { drawImage: (source) => this.copied.push(source) };
  }

  /** Descendants with `className`, in document order. */
  all(className: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(child.className === className ? [child] : []),
      ...child.all(className),
    ]);
  }
}

export class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

/** A page's host as React places it, holding `children` it rendered, such as an overlay. */
export function fakeHost(...children: string[]): HTMLElement {
  const document = new FakeDocument();
  const host = document.createElement("section");
  for (const className of children) {
    const child = document.createElement("div");
    child.className = className;
    host.append(child);
  }
  return host as unknown as HTMLElement;
}

/** The base, detail, and spare canvases the renderer built in `host`, in that order. */
export function canvasesOf(host: HTMLElement): HTMLCanvasElement[] {
  const [drawings] = (host as unknown as FakeElement).all("parapdf-canvas-wrapper");
  return (drawings?.children ?? []) as unknown as HTMLCanvasElement[];
}
