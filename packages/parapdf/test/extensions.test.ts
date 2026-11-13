import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentSession } from "../src/document/session.ts";
import { ExtensionSet, type ViewerExtension } from "../src/view/extensions.ts";

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
    closed: (kept) => heard.push(`closed ${kept}`),
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
    set.closed(true);
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
    assert.deepEqual(kept.heard, [...told, "detaching", "closed true"]);
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

  it("tells an extension added while a hook runs each hook once, as add() replays it", () => {
    const { signal } = new AbortController();
    const heard = (hook: "prepare" | "ready" | "viewport" | "painted") => {
      const set = new ExtensionSet();
      const late = listening();
      const viewport = hook === "viewport" ? { scroller, content, signal } : null;
      set.add({ [hook]: () => set.add(late.extension, viewport) }, null);
      set.prepare(session, signal);
      set.ready(session, signal);
      set.viewport(scroller, content, signal);
      set.painted();
      return late.heard;
    };
    const all = ["prepare true false", "ready true false", "viewport true", "painted"];
    assert.deepEqual(heard("prepare"), all);
    assert.deepEqual(heard("ready"), all);
    assert.deepEqual(heard("viewport"), all);
    assert.deepEqual(heard("painted"), ["prepare true false", "ready true false", "painted"]);
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
    set.closed(false);
    const late = listening();
    set.add(late.extension, null);
    assert.deepEqual(late.heard, []);
  });
});
