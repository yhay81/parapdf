import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { enforcePermissions } from "../src/features/permissions.ts";
import { type PrintState, print, printOf } from "../src/features/print/index.ts";
import { printDocument } from "../src/features/print/print.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, openSession, settle, show } from "./fake-pdfjs.ts";

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

describe("print orientation", () => {
  const LANDSCAPE = { width: 792, height: 612 };
  const pages = [LETTER, LANDSCAPE, LETTER, LANDSCAPE];

  async function turns(options?: { autoRotate?: boolean }) {
    const { session, drawings } = await openSession({ pages });
    const printing = printDocument(session, options);
    for (let index = 0; index < pages.length; index++) {
      await settle();
      drawings[index]?.resolve();
    }
    await printing;
    return drawings.map((drawing) => drawing.request.rotation ?? 0);
  }

  it("turns pages whose orientation differs from the first page's, as pdf.js's viewer does", async (t) => {
    environment(t);
    assert.deepEqual(await turns(), [0, 270, 0, 270]);
  });

  it("prints every page upright without autoRotate", async (t) => {
    environment(t);
    assert.deepEqual(await turns({ autoRotate: false }), [0, 0, 0, 0]);
  });
});

describe("print annotations", () => {
  it("takes one snapshot for every sheet in the job", async (t) => {
    environment(t);
    const { session, drawings } = await openSession({ pages: [LETTER, LETTER] });
    const storage = session.proxy.annotationStorage;
    const snapshot = storage.print;
    let reads = 0;
    Object.defineProperty(storage, "print", {
      get() {
        reads++;
        return snapshot;
      },
    });
    const printing = printDocument(session);
    for (let i = 0; i < 2; i++) {
      await settle();
      assert.equal(drawings[i]?.request.intent, "print");
      drawings[i]?.resolve();
    }
    await printing;
    assert.equal(reads, 1);
  });
});

describe("print job replacement", () => {
  it("waits for pending edits before WillPrint and sends DidPrint when the dialog closes", async (t) => {
    const env = environment(t);
    const document = fakeDocument();
    const viewer = new ViewerController();
    const { close } = show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader);
    t.after(close);
    await settle();
    const events: string[] = [];
    viewer.session?.onOutput(
      async (event) => void events.push(event),
      new AbortController().signal,
    );
    let restored = () => {};
    viewer.session?.onCommit(
      () =>
        new Promise<void>((resolve) => {
          restored = resolve;
        }),
      new AbortController().signal,
    );
    const printing = print(viewer);
    await settle();
    assert.deepEqual(events, []);
    assert.equal(document.drawings.length, 0);
    restored();
    await settle();
    document.drawings[0]?.resolve();
    await printing;
    assert.deepEqual(events, ["WillPrint"]);
    env.afterPrint();
    await settle();
    assert.deepEqual(events, ["WillPrint", "DidPrint"]);
  });

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
    const viewer = new ViewerController();
    const { close: closeDocument } = show(
      viewer,
      { url: "/a.pdf" },
      fakePdfjs(async () => document.proxy).loader,
    );
    await settle();
    const printing = print(viewer);
    await settle();
    assert.equal(document.drawings.length, 1);
    closeDocument();
    await assert.rejects(printing, { name: "RenderingCancelledException" });
    assert.equal(document.drawings[0]?.cancellations, 1);
    assert.equal(env.prints(), 0);
    assert.equal(env.head.children.length + env.body.children.length + env.listeners.size, 0);
  });
});

describe("printOf(viewer)", () => {
  it("shares print state across holders and cancels preparation only when the last holder disconnects", async (t) => {
    const env = environment(t);
    const doc = fakeDocument({ pages: [LETTER, LETTER] });
    const viewer = new ViewerController();
    const { close } = show(
      viewer,
      { url: "/shared-print.pdf" },
      fakePdfjs(async () => doc.proxy).loader,
    );
    t.after(close);
    await settle();

    const slot = printOf(viewer);
    const holdToolbar = slot.hold();
    const holdMenu = slot.hold();

    const job1 = slot.store.get().print();
    await settle();
    assert.equal(slot.store.get().printing, true);
    assert.deepEqual(slot.store.get().progress, { done: 0, total: 2 });

    // Unmounting a secondary holder leaves preparation running.
    holdMenu();
    assert.equal(slot.store.get().printing, true);
    doc.drawings[0]?.resolve();
    await settle();
    assert.deepEqual(slot.store.get().progress, { done: 1, total: 2 });
    doc.drawings[1]?.resolve();
    await job1;
    assert.equal(env.prints(), 1);
    assert.equal(slot.store.get().printing, false);

    // Disconnecting the last holder cancels in-flight preparation cleanly.
    const job2 = slot.store.get().print();
    await settle();
    assert.equal(slot.store.get().printing, true);
    holdToolbar();
    assert.equal(slot.store.get().printing, false);
    assert.equal(slot.store.get().progress, null);
    await job2;
    assert.equal(env.prints(), 1);
  });

  it("tracks progress, supports clean cancel(), and rejects on caller abort or restricted permissions", async (t) => {
    const env = environment(t);
    const doc = fakeDocument({ pages: [LETTER, LETTER, LETTER] });
    const viewer = new ViewerController();
    const { close } = show(viewer, { url: "/three.pdf" }, fakePdfjs(async () => doc.proxy).loader);
    t.after(close);
    await settle();

    const states: PrintState[] = [];
    const slot = printOf(viewer);
    const unsub = slot.store.subscribe(() => {
      const { printing, progress } = slot.store.get();
      states.push({ printing, progress });
    });
    t.after(unsub);

    const firstRun = slot.store.get().print();
    for (let index = 0; index < 3; index++) {
      await settle();
      doc.drawings[index]?.resolve();
    }
    await firstRun;
    assert.equal(env.prints(), 1);
    assert.deepEqual(states, [
      { printing: true, progress: { done: 0, total: 3 } },
      { printing: true, progress: { done: 1, total: 3 } },
      { printing: true, progress: { done: 2, total: 3 } },
      { printing: true, progress: { done: 3, total: 3 } },
      { printing: false, progress: null },
    ]);

    // Cancelling mid-preparation resolves cleanly and resets to idle immediately.
    states.length = 0;
    const cancelledRun = slot.store.get().print();
    await settle();
    assert.deepEqual(states, [{ printing: true, progress: { done: 0, total: 3 } }]);
    slot.store.get().cancel();
    assert.deepEqual(states.at(-1), { printing: false, progress: null });
    await cancelledRun;
    assert.equal(env.prints(), 1);

    // Caller AbortSignal rejects instead of being swallowed as cancel().
    const callerAbort = new AbortController();
    const abortedRun = slot.store.get().print({ signal: callerAbort.signal });
    await settle();
    const reason = new Error("caller aborted");
    callerAbort.abort(reason);
    await assert.rejects(abortedRun, /Rendering cancelled/);
    await assert.rejects(
      slot.store.get().print({ signal: AbortSignal.abort(reason) }),
      (err) => err === reason,
    );

    // Restricted permissions reject immediately.
    const restrictedDoc = fakeDocument({
      pages: [LETTER],
      proxy: { getPermissions: async () => new Set<number>() },
    });
    const restrictedViewer = new ViewerController();
    const detachPermissions = enforcePermissions(restrictedViewer);
    const { close: closeRestricted } = show(
      restrictedViewer,
      { url: "/locked.pdf" },
      fakePdfjs(async () => restrictedDoc.proxy).loader,
    );
    t.after(() => {
      detachPermissions();
      closeRestricted();
    });
    await settle();
    await assert.rejects(printOf(restrictedViewer).store.get().print(), /does not permit printing/);
  });
});
