import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { printDocument } from "../src/runtime/print.ts";
import { Viewer } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, openSession, settle } from "./fake-pdfjs.ts";

/** Only the element operations printDocument uses; rendering is controlled separately. */
class PrintElement {
  children: PrintElement[] = [];
  parent: PrintElement | null = null;
  width = 640;
  height = 480;
  append(child: PrintElement) {
    this.children.push(child);
    child.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  removeAttribute(name: string) {
    Reflect.deleteProperty(this, name);
  }
  async decode() {}
  toBlob(callback: BlobCallback) {
    callback(new Blob(["PNG"]));
  }
}

function environment(t: TestContext, holdEncoding = false) {
  const head = new PrintElement();
  const body = new PrintElement();
  const listeners = new Set<() => void>();
  const encodings: BlobCallback[] = [];
  const revoked: string[] = [];
  let prints = 0;
  let urls = 0;
  const afterPrint = () => {
    for (const listener of [...listeners]) listener();
  };
  const replacements = {
    document: {
      head,
      body,
      createElement() {
        const element = new PrintElement();
        if (holdEncoding) element.toBlob = (callback) => void encodings.push(callback);
        return element;
      },
    },
    window: {
      print: () => prints++,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      afterPrint();
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(URL, "createObjectURL", () => `blob:print-${++urls}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  return { head, body, listeners, encodings, revoked, afterPrint, prints: () => prints };
}

/** A session of one page, whose drawings stay pending until the test settles them. */
async function controlledDocument() {
  const { session, drawings } = await openSession();
  return { doc: session, renders: drawings };
}

describe("print job replacement", () => {
  it("cancels an active render and prints only its replacement, with no cleanup left behind", async (t) => {
    const env = environment(t);
    const { doc, renders } = await controlledDocument();
    const old = printDocument(doc);
    await settle();
    const replacement = printDocument(doc);
    await settle();
    assert.equal(renders[0]?.cancellations, 1);
    assert.equal(renders[1]?.cancellations, 0);
    renders[1]?.resolve();
    await Promise.all([old, replacement]);
    assert.equal(env.prints(), 1);
    assert.equal(renders[0]?.request.canvas.width, 0);
    assert.equal(renders[0]?.request.canvas.height, 0);
    assert.equal(env.head.children.length, 1);
    assert.equal(env.body.children.length, 1);
    assert.equal(env.listeners.size, 1);
    env.afterPrint();
    assert.equal(env.head.children.length, 0);
    assert.equal(env.body.children.length, 0);
    assert.equal(env.listeners.size, 0);
    assert.deepEqual(env.revoked, ["blob:print-1"]);
  });

  it("does not revive an old job when its pending image encoding finishes", async (t) => {
    const env = environment(t, true);
    const { doc, renders } = await controlledDocument();
    const old = printDocument(doc);
    await settle();
    renders[0]?.resolve();
    await settle();
    assert.equal(env.encodings.length, 1);
    const replacement = printDocument(doc);
    await settle();
    renders[1]?.resolve();
    await settle();
    env.encodings[1]?.(new Blob(["new"]));
    await replacement;
    env.encodings[0]?.(new Blob(["old"]));
    await old;
    assert.equal(env.prints(), 1);
    assert.equal(renders[0]?.request.canvas.width, 0);
    env.afterPrint();
    assert.equal(env.head.children.length + env.body.children.length + env.listeners.size, 0);
    assert.deepEqual(env.revoked, ["blob:print-1"]);
  });

  it("still rejects when the user aborts an active render", async (t) => {
    const env = environment(t);
    const { doc, renders } = await controlledDocument();
    const abort = new AbortController();
    const printing = printDocument(doc, { signal: abort.signal });
    await settle();
    abort.abort();
    // pdf.js's own exception for the cancelled render.
    await assert.rejects(printing, { name: "RenderingCancelledException" });
    assert.equal(renders[0]?.cancellations, 1);
    assert.equal(renders[0]?.request.canvas.width, 0);
    assert.equal(renders[0]?.request.canvas.height, 0);
    assert.equal(env.prints(), 0);
    assert.equal(env.head.children.length + env.body.children.length + env.listeners.size, 0);
  });

  it("stops when the viewer's document closes", async (t) => {
    const env = environment(t);
    const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
    t.after(() => {
      if (cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", cancelFrame);
      else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    });
    const document = fakeDocument();
    const viewer = new Viewer({}, fakePdfjs(async () => document.proxy).loader);
    const closeDocument = viewer.open({ url: "/a.pdf" });
    await settle();
    const printing = viewer.print();
    await settle();
    assert.equal(document.drawings.length, 1);
    closeDocument();
    await assert.rejects(printing, { name: "RenderingCancelledException" });
    assert.equal(document.drawings[0]?.cancellations, 1);
    assert.equal(env.prints(), 0);
    assert.equal(env.head.children.length + env.body.children.length + env.listeners.size, 0);
  });
});
