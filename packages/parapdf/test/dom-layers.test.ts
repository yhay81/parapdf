import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { RenderCancelledError, type Rotation } from "../src/pdfjs/draw.ts";
import type { AnnotationEditor, AnnotationLayerEditor } from "../src/pdfjs/editor-types.ts";
import {
  DEFAULT_ANNOTATION_SETUP,
  type DomLayerStats,
  DomLayers,
} from "../src/render/dom-layers.ts";
import { mountPage } from "../src/render/page.ts";
import type { ViewInput } from "../src/render/planner.ts";
import { computeLayout } from "../src/view/layout.ts";
import { fakeHost } from "./fake-dom.ts";
import { LETTER, openSession, settle } from "./fake-pdfjs.ts";

/** Three pages, `first` to `last` in view, the focus on `first`. */
function view(first: number, last: number, settled = true, rotation: Rotation = 0): ViewInput {
  return {
    layout: computeLayout([LETTER, LETTER, LETTER], 1, { gap: 10, rotation }),
    first,
    last,
    focus: first,
    viewport: { left: 0, top: 0, width: 800, height: 900, scrollerWidth: 800, scrollerHeight: 900 },
    devicePixelRatio: 1,
    settled,
  };
}

/** An annotation editor whose page layers stay pending until the test builds or fails them. */
function fakeEditor() {
  const layers: {
    pageIndex: number;
    build(): void;
    fail(error: Error): void;
    cancelled: number;
    destroyed: number;
    updates: [number, Rotation][];
  }[] = [];
  const editor = {
    layerEditing: { editing: false },
    renderLayer({ pageIndex }: { pageIndex: number }) {
      let resolve!: (handle: AnnotationLayerEditor) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<AnnotationLayerEditor>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const layer = {
        pageIndex,
        cancelled: 0,
        destroyed: 0,
        updates: [] as [number, Rotation][],
        build: () =>
          resolve({
            update: (scale, rotation) => layer.updates.push([scale, rotation]),
            destroy: () => layer.destroyed++,
          }),
        fail: (error: Error) => reject(error),
      };
      layers.push(layer);
      // Like a task that cannot stop: it completes or fails as the test says.
      return { promise, cancel: () => layer.cancelled++ };
    },
  };
  return { editor: editor as unknown as AnnotationEditor, layers };
}

/** DOM layers of a three-page document, editing annotations unless `editor` is false. */
async function setup(t: TestContext, { editor = true, text = false } = {}) {
  const { session } = await openSession({ pages: [LETTER, LETTER, LETTER] });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fakeEditor();
  const stats: DomLayerStats = {
    text: 0,
    textUpdates: 0,
    annotations: 0,
    editors: 0,
    cancelled: 0,
    failed: 0,
  };
  const state = { waiting: false };
  const layers = new DomLayers(
    session,
    { annotationSetup: { ...DEFAULT_ANNOTATION_SETUP, editor: editor ? fake.editor : null } },
    stats,
    () => state.waiting,
  );
  const attach = (index: number) =>
    layers.attach(index, mountPage(fakeHost(), { text, annotations: false, editor: true }));
  /** Runs the next idle period, 16 ms in Node, and what it starts. */
  const idle = async () => {
    t.mock.timers.tick(16);
    await settle();
  };
  return { layers, stats, state, attach, idle, built: fake.layers };
}

describe("DomLayers", () => {
  it("builds one layer at a time in idle periods once scrolling settles, visible pages first", async (t) => {
    const { layers, attach, idle, built, stats } = await setup(t);
    for (const index of [0, 1, 2]) attach(index);
    layers.update(view(2, 2, false));
    layers.schedule();
    await idle();
    assert.equal(built.length, 0, "not while scrolling");
    layers.update(view(2, 2));
    layers.schedule();
    t.mock.timers.tick(15);
    await settle();
    assert.equal(built.length, 0, "not before an idle period");
    await idle();
    assert.deepEqual(
      built.map(({ pageIndex }) => pageIndex),
      [2],
    );
    layers.schedule();
    await idle();
    assert.equal(built.length, 1, "one at a time");
    built[0]?.build();
    await settle();
    await idle();
    assert.deepEqual(
      built.map(({ pageIndex }) => pageIndex),
      [2, 1],
      "then the overscan page nearest the focus",
    );
    assert.equal(stats.editors, 1);
  });

  it("waits while a visible page waits for its first pixels, until scheduled again", async (t) => {
    const { layers, attach, idle, built, state } = await setup(t);
    attach(0);
    state.waiting = true;
    layers.update(view(0, 0));
    layers.schedule();
    await idle();
    assert.equal(built.length, 0);
    state.waiting = false;
    await idle();
    assert.equal(built.length, 0);
    layers.schedule();
    await idle();
    assert.equal(built.length, 1);
  });

  it("builds a failed layer again only once its page mounts again or annotations change, and the others meanwhile", async (t) => {
    const error = t.mock.method(console, "error", () => {});
    const { layers, attach, idle, built, stats } = await setup(t, { text: true });
    attach(0);
    attach(1);
    layers.update(view(0, 1));
    layers.schedule();
    // The fake pdf.js builds no text layer: page 1's fails, then page 2's.
    for (let period = 0; period < 3; period++) await idle();
    assert.equal(stats.failed, 2);
    assert.deepEqual(
      built.map(({ pageIndex }) => pageIndex),
      [0],
      "then page 1's editor layer",
    );
    built[0]?.fail(new Error("broken annotations"));
    await settle();
    await idle();
    assert.equal(built[1]?.pageIndex, 1);
    built[1]?.build();
    await settle();
    for (let period = 0; period < 5; period++) await idle();
    assert.equal(built.length, 2);
    assert.equal(stats.failed, 3);
    assert.equal(error.mock.callCount(), 3);

    layers.invalidateAnnotations();
    layers.schedule();
    await idle();
    assert.equal(built[2]?.pageIndex, 0, "annotations changed");
    built[2]?.build();
    await settle();
    await idle();
    built[3]?.build();
    await settle();
    await idle();
    assert.equal(stats.failed, 3, "text layers stay failed");

    layers.detach(0);
    attach(0);
    layers.schedule();
    await idle();
    assert.equal(stats.failed, 4, "the page mounted again");
  });

  it("tells whether a page gets its editor layer: once built, at once, or not if it unmounts or within ten seconds", async (t) => {
    const { layers, attach, idle, built } = await setup(t);
    attach(0);
    attach(1);
    layers.update(view(0, 1));
    const first = layers.whenEditable(0);
    const unmounted = layers.whenEditable(1);
    const never = layers.whenEditable(2);
    layers.schedule();
    await idle();
    built[0]?.build();
    await settle();
    assert.equal(await first, true);
    assert.equal(await layers.whenEditable(0), true);
    layers.detach(1);
    assert.equal(await unmounted, false);
    t.mock.timers.tick(10_000);
    assert.equal(await never, false);
  });

  it("tells at once that no page gets an editor layer without an editor", async (t) => {
    const { layers, attach } = await setup(t, { editor: false });
    attach(0);
    assert.equal(await layers.whenEditable(0), false);
  });

  it("destroys an editor layer that completes after its page unmounted, and builds a cancelled one again", async (t) => {
    const { layers, attach, idle, built, stats } = await setup(t);
    attach(0);
    layers.update(view(0, 0));
    layers.schedule();
    await idle();
    layers.detach(0);
    assert.equal(built[0]?.cancelled, 1);
    built[0]?.build();
    await settle();
    assert.equal(built[0]?.destroyed, 1);
    assert.equal(stats.editors, 0);

    attach(0);
    layers.schedule();
    await idle();
    built[1]?.fail(new RenderCancelledError("cancelled"));
    await settle();
    assert.deepEqual([stats.cancelled, stats.failed], [1, 0]);
    await idle();
    assert.equal(built.length, 3);
  });

  it("turns editor layers with the view, the one being built once it is", async (t) => {
    const { layers, attach, idle, built } = await setup(t);
    attach(0);
    layers.update(view(0, 0));
    layers.schedule();
    await idle();
    layers.update(view(0, 0, true, 90));
    built[0]?.build();
    await settle();
    assert.deepEqual(built[0]?.updates, [[1, 90]]);
    layers.rotate(180);
    assert.deepEqual(built[0]?.updates.at(-1), [1, 180]);
  });
});
