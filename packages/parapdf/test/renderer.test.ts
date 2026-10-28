import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AnnotationSetup, DEFAULT_ANNOTATION_SETUP } from "../src/render/dom-layers.ts";
import type { ViewInput } from "../src/render/planner.ts";
import { Renderer } from "../src/render/renderer.ts";
import { computeLayout } from "../src/view/layout.ts";
import { canvasesOf, type FakeElement, fakeHost } from "./fake-dom.ts";
import { LETTER, openSession, settle } from "./fake-pdfjs.ts";

/** A session of two pages, whose drawings stay pending until the test settles them. */
async function controlledDocument() {
  const { session, drawings } = await openSession({ pages: [LETTER, LETTER] });
  return { doc: session, renders: drawings };
}

/** Mounts page `index` in a new host; returns its canvases as built. */
function mount(renderer: Renderer, index: number) {
  const host = fakeHost();
  renderer.attach(index, host);
  const [base, detail, spare] = canvasesOf(host) as [
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement,
  ];
  return { host, base, detail, spare };
}

function input(scale = 1, settled = false): ViewInput {
  return {
    layout: computeLayout([{ width: 612, height: 792 }], scale, { gap: 10 }),
    first: 0,
    last: 0,
    focus: 0,
    viewport: {
      left: 0,
      top: 0,
      width: 800,
      height: 900,
      scrollerWidth: 800,
      scrollerHeight: 900,
    },
    devicePixelRatio: 1,
    settled,
  };
}

/**
 * No text or annotation layers: the renderer builds them in an idle period
 * once the view settles, 16 ms later in Node, and the fake pdf.js fails them,
 * so tests that count failed drawings counted them too when a run was slow.
 */
const drawingsOnly = { textLayer: false, annotationLayer: false };

describe("Renderer page DOM", () => {
  it("builds the page's canvases and layers before what React rendered in the host", async (t) => {
    const { doc } = await controlledDocument();
    const renderer = new Renderer(doc);
    t.after(() => renderer.dispose());
    const host = fakeHost("parapdf-overlay-layer");
    renderer.attach(0, host);
    const children = (host as unknown as FakeElement).children;
    assert.deepEqual(
      children.map((child) => child.className),
      [
        "parapdf-canvas-wrapper",
        "parapdf-structure",
        "parapdf-text-layer",
        "parapdf-annotation-layer",
        "parapdf-overlay-layer",
      ],
    );
    assert.equal(children[0]?.getAttribute("aria-hidden"), "true");
    const canvases = canvasesOf(host);
    assert.equal(canvases.length, 3, "base, detail, and spare");
    for (const canvas of canvases) {
      assert.equal(canvas.width * canvas.height, 0, "a new canvas holds no pixels");
      assert.equal(canvas.style.visibility, "hidden");
    }

    renderer.detach(0);
    assert.deepEqual(
      (host as unknown as FakeElement).children.map((child) => child.className),
      ["parapdf-overlay-layer"],
      "React's own children stay",
    );
  });

  it("builds only the layers the viewer asks for", async (t) => {
    const { doc } = await controlledDocument();
    const renderer = new Renderer(doc, { textLayer: false, annotationLayer: false });
    t.after(() => renderer.dispose());
    const host = fakeHost();
    renderer.attach(0, host);
    assert.deepEqual(
      (host as unknown as FakeElement).children.map((child) => child.className),
      ["parapdf-canvas-wrapper"],
    );
  });

  it("adds and removes the editor layer with the annotation editor", async (t) => {
    const { doc } = await controlledDocument();
    const renderer = new Renderer(doc);
    t.after(() => renderer.dispose());
    const host = fakeHost("parapdf-overlay-layer");
    renderer.attach(0, host);
    const classes = () => (host as unknown as FakeElement).children.map((child) => child.className);
    const editor = { layerEditing: { editing: false } } as AnnotationSetup["editor"];
    const editing = { ...DEFAULT_ANNOTATION_SETUP, editor };
    renderer.setAnnotationSetup(editing);
    assert.deepEqual(classes().slice(-2), ["parapdf-editor-layer", "parapdf-overlay-layer"]);
    renderer.setAnnotationSetup(DEFAULT_ANNOTATION_SETUP);
    assert.ok(!classes().includes("parapdf-editor-layer"));

    renderer.setAnnotationSetup(editing);
    const later = fakeHost();
    renderer.attach(1, later);
    assert.deepEqual(
      (later as unknown as FakeElement).children.map((child) => child.className).at(-1),
      "parapdf-editor-layer",
      "pages mounting while it edits get one at once",
    );
    renderer.setAnnotationSetup(DEFAULT_ANNOTATION_SETUP);
  });
});

describe("Renderer failures", () => {
  it("tries a base after detail fails, then leaves both failed layers alone", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, drawingsOnly);
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    const view = input(1, true);
    renderer.update(view);
    await settle();
    assert.equal(renders.length, 1);
    assert.equal(renders[0]?.request.scale, 1);
    renders[0]?.reject(new Error("unsupported drawing"));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.request.scale, 0.5);
    renders[1]?.reject(new Error("unsupported drawing"));
    await settle();
    for (let frame = 0; frame < 10; frame++) renderer.update(view);
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renderer.stats.failed, 2);
    assert.equal(renderer.hasPixels(0), false);
  });

  for (const initialBase of [false, true]) {
    it(`replaces stale detail with a base after a content change${initialBase ? " with an existing base" : ""}`, async (t) => {
      t.mock.method(console, "error", () => {});
      const { doc, renders } = await controlledDocument();
      const renderer = new Renderer(doc, drawingsOnly);
      t.after(() => renderer.dispose());
      const { base, detail, spare } = mount(renderer, 0);
      if (initialBase) {
        renderer.update(input());
        await settle();
        renders[0]?.resolve();
        await settle();
      }
      const view = input(1, true);
      renderer.update(view);
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      assert.equal(detail.style.visibility, "");
      const before = renders.length;

      renderer.invalidateContent();
      await settle();
      assert.equal(renders.length, before + 1);
      assert.equal(renders.at(-1)?.request.canvas, spare);
      renders.at(-1)?.reject(new Error("failed replacement detail"));
      await settle();
      assert.equal(renders.length, before + 2);
      assert.equal(renders.at(-1)?.request.canvas, base);
      assert.equal(renders.at(-1)?.request.scale, 0.5);
      assert.equal(detail.style.visibility, "");
      assert.equal(base.style.visibility, "hidden");

      renders.at(-1)?.resolve();
      await settle();
      assert.equal(base.style.visibility, "");
      assert.equal(detail.style.visibility, "hidden");
      assert.equal(spare.style.visibility, "hidden");
      assert.equal(renderer.hasPixels(0), true);
      for (let frame = 0; frame < 10; frame++) renderer.update(view);
      await settle();
      assert.equal(renders.length, before + 2);
      assert.equal(renderer.stats.failed, 1);
    });
  }

  it("keeps stale detail if its replacement and base fallback both fail", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, drawingsOnly);
    t.after(() => renderer.dispose());
    const { detail } = mount(renderer, 0);
    const view = input(1, true);
    renderer.update(view);
    await settle();
    renders[0]?.resolve();
    await settle();
    renderer.invalidateContent();
    await settle();
    renders[1]?.reject(new Error("failed replacement detail"));
    await settle();
    assert.equal(renders.length, 3);
    renders[2]?.reject(new Error("failed fallback base"));
    await settle();
    for (let frame = 0; frame < 10; frame++) renderer.update(view);
    await settle();
    assert.equal(renders.length, 3);
    assert.equal(detail.style.visibility, "");
    assert.equal(renderer.hasPixels(0), true);
    assert.equal(renderer.stats.failed, 2);
  });

  it("lets other pages draw when a page fails", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { ...drawingsOnly, maxConcurrent: 1 });
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    mount(renderer, 1);
    const view = input();
    view.layout = computeLayout(
      [
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ],
      1,
      { gap: 10 },
    );
    view.last = 1;
    renderer.update(view);
    await settle();
    renders[0]?.reject(new Error("broken page"));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.pageIndex, 1);
    renders[1]?.resolve();
    await settle();
    assert.equal(renderer.hasPixels(1), true);
    assert.equal(renders.length, 2);
  });

  it("retries after zooming or changing the page's drawing", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, drawingsOnly);
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    renderer.update(input());
    await settle();
    renders[0]?.reject(new Error("failed at the first zoom"));
    await settle();
    renderer.update(input(2));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.request.scale, 1);
    renders[1]?.reject(new Error("failed at the second zoom"));
    await settle();
    renderer.invalidateContent();
    await settle();
    assert.equal(renders.length, 3);
    assert.equal(renders[2]?.request.scale, 1);
    renders[2]?.resolve();
    await settle();
    assert.equal(renderer.hasPixels(0), true);
    assert.equal(renders.length, 3);
  });

  it("retries a failed page when it mounts again", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, drawingsOnly);
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    renderer.update(input());
    await settle();
    renders[0]?.reject(new Error("failed before leaving the mounted window"));
    await settle();
    renderer.detach(0);
    mount(renderer, 0);
    await settle();
    assert.equal(renders.length, 2);
    renders[1]?.resolve();
    await settle();
    assert.equal(renderer.hasPixels(0), true);
  });

  it("blocks a failed region until scrolling asks for a different region", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { ...drawingsOnly, maxDetailPixels: 1_000_000 });
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    const view = input(4, true);
    renderer.update(view);
    await settle();
    renders[0]?.resolve();
    await settle();
    assert.equal(renders.length, 2);
    assert.ok(renders[1]?.request.region);
    renders[1]?.reject(new Error("failed region"));
    await settle();
    renderer.update(view);
    await settle();
    assert.equal(renders.length, 2);
    renderer.update({ ...view, viewport: { ...view.viewport, top: 300 } });
    await settle();
    assert.equal(renders.length, 3);
    assert.notDeepEqual(renders[2]?.request.region, renders[1]?.request.region);
    renders[2]?.resolve();
    await settle();
    assert.equal(renderer.stats.detail, 1);
  });

  it("does not count cancellation as a failed drawing", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, drawingsOnly);
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    renderer.update(input());
    await settle();
    renders[0]?.task.cancel();
    await settle();
    assert.equal(renders.length, 2);
    renders[1]?.resolve();
    await settle();
    assert.equal(renderer.hasPixels(0), true);
    assert.equal(renderer.stats.failed, 0);
    assert.equal(renderer.stats.cancelled, 1);
  });
});

describe("Renderer lifecycle", () => {
  it("disposes itself when its signal aborts: drawings stop, and pages are given back", async () => {
    const { session, drawings, cleaned } = await openSession({ pages: [LETTER, LETTER] });
    const controller = new AbortController();
    const renderer = new Renderer(session, { signal: controller.signal });
    const { host, base } = mount(renderer, 0);
    renderer.update(input());
    await settle();
    assert.equal(drawings.length, 1);
    controller.abort();
    await settle();
    assert.equal(drawings[0]?.cancellations, 1, "the drawing in progress is cancelled");
    assert.equal(base.width, 0, "the page's canvases are given back");
    assert.equal((host as unknown as FakeElement).children.length, 0, "and its DOM");
    assert.deepEqual(cleaned, [0], "and pdf.js's parsing results of it");
    renderer.update(input());
    await settle();
    assert.equal(drawings.length, 1, "nothing is drawn after");
  });
});
