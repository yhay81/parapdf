import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentSession } from "../src/document/session.ts";
import { ExtensionSet, type ViewerExtension } from "../src/view/extensions.ts";
import { settle } from "./fake-pdfjs.ts";

const session = {} as DocumentSession;
const scroller = {} as HTMLElement;
const content = {} as HTMLElement;

/** An extension that lists the hooks it hears, in order. */
function listening() {
  const heard: string[] = [];
  const extension: ViewerExtension = {
    prepare: (from, signal) => heard.push(`prepare ${from === session} ${signal.aborted}`),
    ready: (from, signal) => heard.push(`ready ${from === session} ${signal.aborted}`),
    viewport: (element, inner) =>
      heard.push(`viewport ${element === scroller && inner === content}`),
    detaching: () => heard.push("detaching"),
    closed: () => heard.push("closed"),
    painted: () => heard.push("painted"),
    textLayer: (index, handle) => heard.push(`text ${index} ${handle}`),
    annotationLayer: (index, handle) => heard.push(`annotations ${index} ${handle}`),
    jumping: () => heard.push("jumping"),
    namedAction: (action) => heard.push(`action ${action}`),
    layersChanged: () => heard.push("layers"),
  };
  return { heard, extension };
}

describe("ExtensionSet", () => {
  it("tells every extension what happens, and nothing once it is removed", () => {
    const set = new ExtensionSet();
    const kept = listening();
    const removed = listening();
    set.add(kept.extension, null);
    const remove = set.add(removed.extension, null);
    const { signal } = new AbortController();
    set.prepare(session, signal);
    set.ready(session, signal);
    set.viewport(scroller, content, signal);
    set.painted();
    set.textLayer(1, null);
    set.annotationLayer(2, null);
    set.jumping();
    set.namedAction("Print");
    set.layersChanged();
    remove();
    set.detaching();
    set.closed();
    const told = [
      "prepare true false",
      "ready true false",
      "viewport true",
      "painted",
      "text 1 null",
      "annotations 2 null",
      "jumping",
      "action Print",
      "layers",
    ];
    assert.deepEqual(kept.heard, [...told, "detaching", "closed"]);
    assert.deepEqual(removed.heard, told);
  });

  it("does not tell an extension that another removed while it was told", () => {
    const set = new ExtensionSet();
    const later = listening();
    let remove = () => {};
    set.add({ painted: () => remove() }, null);
    remove = set.add(later.extension, null);
    set.painted();
    assert.deepEqual(later.heard, []);
  });

  it("tells a late extension of the ready document, the viewport, and the first paint", () => {
    const set = new ExtensionSet();
    const { signal } = new AbortController();
    set.prepare(session, signal);
    set.ready(session, signal);
    set.painted();
    const late = listening();
    set.add(late.extension, { scroller, content, signal });
    assert.deepEqual(late.heard, [
      "prepare true false",
      "ready true false",
      "viewport true",
      "painted",
    ]);
  });

  it("tells a late extension nothing of a document whose work stopped", () => {
    const set = new ExtensionSet();
    const work = new AbortController();
    set.ready(session, work.signal);
    set.painted();
    work.abort();
    const late = listening();
    set.add(late.extension, null);
    assert.deepEqual(late.heard, []);
  });

  it("forgets the first paint as the viewport detaches, and the document as it is rebuilt", () => {
    const set = new ExtensionSet();
    const { signal } = new AbortController();
    set.ready(session, signal);
    set.painted();
    set.detaching();
    const reattaching = listening();
    set.add(reattaching.extension, null);
    assert.deepEqual(reattaching.heard, ["prepare true false", "ready true false"]);
    set.detaching(true);
    const rebuilding = listening();
    set.add(rebuilding.extension, null);
    assert.deepEqual(rebuilding.heard, []);
  });

  it("forgets the document and its paint once it closes", () => {
    const set = new ExtensionSet();
    const { signal } = new AbortController();
    set.ready(session, signal);
    set.painted();
    set.closed();
    const late = listening();
    set.add(late.extension, null);
    assert.deepEqual(late.heard, []);
  });

  it("waits for the features loading now, and goes on when one fails to load", async (context) => {
    const errors = context.mock.method(console, "error", () => {});
    const set = new ExtensionSet();
    let load = () => {};
    set.defer(new Promise<void>((resolve) => (load = resolve)));
    set.defer(Promise.reject(new Error("no module")));
    let loaded = false;
    void set.loaded().then(() => (loaded = true));
    // A feature that starts loading later does not hold up the wait before it.
    set.defer(new Promise<void>(() => {}));
    await settle();
    assert.equal(loaded, false);
    assert.equal(errors.mock.callCount(), 1);
    load();
    await settle();
    assert.equal(loaded, true);
  });

  it("is loaded at once with no feature loading", async () => {
    const set = new ExtensionSet();
    set.defer(Promise.resolve());
    await settle();
    let loaded = false;
    void set.loaded().then(() => (loaded = true));
    await Promise.resolve();
    assert.equal(loaded, true);
  });
});
