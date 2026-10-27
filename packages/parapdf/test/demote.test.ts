import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  return { base, detail, spare };
}

const copies = (canvas: HTMLCanvasElement) => (canvas as unknown as FakeElement).copied;

/** Two US Letter pages at `scale`, page 0 in view. */
function input(scale: number): ViewInput {
  const layout = computeLayout([LETTER, LETTER], scale, { gap: 10 });
  return {
    layout,
    first: 0,
    last: 0,
    focus: 0,
    viewport: { left: 0, top: 0, width: 800, height: 900, scrollerWidth: 800, scrollerHeight: 900 },
    devicePixelRatio: 1,
    settled: true,
  };
}

// A whole page fits the detail budget at scale 1 (484,704 pixels) but not at
// 2; no text or annotation layers.
const options = { maxDetailPixels: 1_000_000, textLayer: false, annotationLayer: false };

/** Draws both pages' whole-page details at scale 1, sized as pdf.js sizes them. */
async function zoomedOut(
  renderer: Renderer,
  renders: Awaited<ReturnType<typeof controlledDocument>>["renders"],
) {
  renderer.update(input(1));
  await settle();
  for (const render of renders) {
    render.request.canvas.width = 612;
    render.request.canvas.height = 792;
    render.resolve();
  }
  await settle();
  assert.equal(renders.length, 2, "a whole-page detail each, no base");
}

describe("Renderer whole-page details zoomed past their budget (decision 0012)", () => {
  it("shows a small one as the base under the partial detail instead of drawing a base", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, options);
    t.after(() => renderer.dispose());
    const page = mount(renderer, 0);
    mount(renderer, 1);
    await zoomedOut(renderer, renders);

    renderer.update(input(2));
    await settle();
    const drawing = renders[2];
    assert.equal(renders.length, 3, "no base is drawn");
    assert.equal(drawing?.request.canvas, page.spare);
    assert.ok(drawing?.request.region, "part of the page");
    assert.notEqual(page.detail.style.visibility, "hidden", "the whole-page detail still shows");
    drawing?.resolve();
    await settle();

    assert.deepEqual(copies(page.base), [page.detail]);
    assert.equal(page.base.width, 612);
    assert.equal(page.base.height, 792);
    assert.equal(page.base.style.visibility, "");
    for (let frame = 0; frame < 5; frame++) renderer.update(input(2));
    await settle();
    assert.equal(renders.length, 3, "still no base");
  });

  it("makes a small one the base of a page that leaves the viewport", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, options);
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    const outside = mount(renderer, 1);
    await zoomedOut(renderer, renders);

    renderer.update(input(2));
    assert.deepEqual(copies(outside.base), [outside.detail], "copied at the zoom's commit");
    assert.equal(outside.detail.width, 0, "the detail is given back");
    await settle();
    assert.ok(
      renders.slice(2).every((render) => render.pageIndex === 0),
      "page 2 draws no base",
    );
    assert.equal(renderer.stats.demoted, 1);
  });

  it("draws a base again under a whole-page detail larger than a base", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { ...options, maxBasePixels: 400_000 });
    t.after(() => renderer.dispose());
    const page = mount(renderer, 0);
    const outside = mount(renderer, 1);
    await zoomedOut(renderer, renders);

    renderer.update(input(2));
    await settle();
    assert.equal(renders[2]?.request.canvas, page.base);
    assert.deepEqual(copies(page.base), []);
    assert.deepEqual(copies(outside.base), []);
    assert.equal(renderer.stats.demoted, 0);
  });
});
