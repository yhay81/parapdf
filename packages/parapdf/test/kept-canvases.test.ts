import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ANNOTATION_SETUP } from "../src/render/dom-layers.ts";
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

/** Mounts page `index` in `host`; returns its canvases as built. */
function mount(renderer: Renderer, index: number, host = fakeHost()) {
  renderer.attach(index, host);
  const [base, detail, spare] = canvasesOf(host) as [
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement,
  ];
  return { host, base, detail, spare };
}

/** Whether anything was copied into `canvases`. */
const copied = (...canvases: HTMLCanvasElement[]) =>
  canvases.some((canvas) => (canvas as unknown as FakeElement).copied.length > 0);

/** Two US Letter pages, page `page` in view. */
function input(scale: number, page = 0): ViewInput {
  const layout = computeLayout(
    [
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ],
    scale,
    { gap: 10 },
  );
  return {
    layout,
    first: page,
    last: page,
    focus: page,
    viewport: {
      left: 0,
      top: layout.tops[page] ?? 0,
      width: 800,
      height: 900,
      scrollerWidth: 800,
      scrollerHeight: 900,
    },
    devicePixelRatio: 1,
    settled: true,
  };
}

const whole = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

describe("Renderer kept canvases", () => {
  it("moves a page's kept canvas into its new host when it mounts again, without drawing it", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    const { detail } = mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    assert.equal(renders.length, 1);
    renders[0]?.resolve();
    await settle();

    renderer.detach(0);
    assert.equal(detail.width * detail.height, 612 * 792, "a kept canvas keeps its pixels");
    assert.equal(
      renderer.keptPixels,
      612 * 792,
      "the whole-page detail alone, which covers the base",
    );

    const again = mount(renderer, 0);
    assert.equal(again.detail, detail, "the same canvas, moved");
    assert.equal(detail.width * detail.height, 612 * 792, "with its pixels");
    assert.equal(detail.style.visibility, "");
    assert.ok(!copied(again.base, again.detail, again.spare), "nothing is copied");
    assert.equal(renderer.keptPixels, 0);
    assert.equal(renderer.stats.kept, 1);
    assert.equal(renderer.sharpness(0, whole, 1), 1);
    renderer.update(input(1));
    await settle();
    assert.equal(renders.length, 1, "nothing is drawn again");
  });

  it("takes the canvases back when React mounts the page in the same host again", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    const { host, detail } = mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    renders[0]?.resolve();
    await settle();
    renderer.detach(0);
    const again = mount(renderer, 0, host);
    assert.equal(again.detail, detail);
    assert.equal(detail.width * detail.height, 612 * 792);
    assert.equal(renderer.hasPixels(0), true);
    assert.equal(
      (host as unknown as FakeElement).all("parapdf-canvas-wrapper").length,
      1,
      "one page's DOM in the host",
    );
  });

  it("shows a drawing kept at another zoom until the page is drawn again", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    renders[0]?.resolve();
    await settle();
    renderer.detach(0);
    renderer.update(input(1.5));
    const { spare } = mount(renderer, 0);
    assert.equal(renderer.hasPixels(0), true);
    assert.equal(renderer.sharpness(0, whole, 1.5), 2 / 3);
    await settle();
    // The new detail is drawn into the spare while the kept one shows.
    assert.equal(renders.at(-1)?.request.scale, 1.5);
    assert.equal(renders.at(-1)?.request.canvas, spare);
  });

  it("lets the least recently kept canvases go beyond its budget", async (t) => {
    const { doc, renders } = await controlledDocument();
    // Room for one page's drawing.
    const renderer = new Renderer(doc, { maxKeptPixels: 600_000 });
    t.after(() => renderer.dispose());
    const details: HTMLCanvasElement[] = [];
    for (const page of [0, 1]) {
      details.push(mount(renderer, page).detail);
      renderer.update(input(1, page));
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      renderer.detach(page);
    }
    // The least recently kept go once the commit's mounting pages took theirs.
    assert.equal(details[0]?.width, 612);
    await settle();
    assert.equal(details[0]?.width, 0, "released");
    assert.equal(details[1]?.width, 612);
    assert.equal(renderer.keptPixels, 612 * 792);
  });

  it("lets a page mounting in the same commit take its canvases before others go", async (t) => {
    const { doc, renders } = await controlledDocument();
    // Room for one page's drawing.
    const renderer = new Renderer(doc, { maxKeptPixels: 600_000 });
    t.after(() => renderer.dispose());
    const first = mount(renderer, 0).detail;
    renderer.update(input(1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(0);
    const second = mount(renderer, 1).detail;
    renderer.update(input(1, 1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    // One commit: page 2 unmounts, over the budget with page 1's, and page 1 mounts.
    renderer.detach(1);
    const again = mount(renderer, 0);
    await settle();
    assert.equal(again.detail, first);
    assert.equal(first.width, 612);
    assert.equal(second.width, 612, "page 2's canvas is kept, within the budget again");
  });

  it("keeps nothing drawn before the content changed or the view turned", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    for (const change of [() => renderer.invalidateContent(), () => renderer.rotate(90)]) {
      const { detail } = mount(renderer, 0);
      renderer.update(input(1));
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      renderer.detach(0);
      assert.ok(renderer.keptPixels > 0);
      change();
      assert.equal(renderer.keptPixels, 0);
      assert.equal(detail.width, 0);
    }
  });

  it("lets kept canvases go first within maxCanvasPixels", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, {
      maxKeptPixels: 4_000_000,
      maxCanvasPixels: 1_200_000,
    });
    t.after(() => renderer.dispose());
    const kept = mount(renderer, 0).detail;
    renderer.update(input(1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(0);
    assert.equal(kept.width, 612);
    mount(renderer, 1);
    renderer.update(input(1.5, 1));
    // Page 2's drawing at the old zoom, begun as an overscan page, is
    // cancelled and its base begins.
    await settle();
    assert.equal(renders.at(-1)?.request.scale, 0.75);
    assert.equal(kept.width, 612, "the base of page 2 fits beside it");
    renders.at(-1)?.resolve();
    await settle();
    // Its detail does not, with the kept 484,704 pixels.
    assert.equal(renders.at(-1)?.request.scale, 1.5);
    assert.equal(kept.width, 0, "the kept canvas went");
    assert.equal(renderer.keptPixels, 0);
  });

  it("keeps nothing with a budget of 0", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 0 });
    t.after(() => renderer.dispose());
    const { detail } = mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    renders[0]?.resolve();
    await settle();
    renderer.detach(0);
    assert.equal(detail.width, 0);
    assert.equal(renderer.keptPixels, 0);
  });

  it("keeps six viewports' worth of device pixels by default, and no page larger than that", async () => {
    for (const [maxKeptPixels, kept] of [
      [undefined, 612 * 792],
      [400_000, 0],
    ] as const) {
      const { doc, renders } = await controlledDocument();
      const renderer = new Renderer(doc, maxKeptPixels === undefined ? {} : { maxKeptPixels });
      const { detail } = mount(renderer, 0);
      renderer.update(input(1));
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      renderer.detach(0);
      assert.equal(renderer.keptPixels, kept, `maxKeptPixels ${maxKeptPixels}`);
      assert.equal(detail.width * detail.height, kept);
      renderer.dispose();
    }
  });

  it("keeps a base and a partial detail, and moves both back", async (t) => {
    const { doc, renders } = await controlledDocument();
    // At scale 2, the whole page (1,938,816 pixels) is over its detail budget.
    const renderer = new Renderer(doc, {
      maxKeptPixels: 4_000_000,
      maxDetailPixels: 1_000_000,
    });
    t.after(() => renderer.dispose());
    const { base, detail } = mount(renderer, 0);
    renderer.update(input(2));
    await settle();
    // The base, then the partial detail.
    for (let round = 0; round < 3; round++) {
      for (const render of renders) render.resolve();
      await settle();
    }
    assert.ok(
      renders.some((render) => render.request.region),
      "part of the page",
    );
    assert.ok(base.width > 0 && detail.width > 0);
    const pixels = base.width * base.height + detail.width * detail.height;
    renderer.detach(0);
    assert.equal(renderer.keptPixels, pixels);

    const again = mount(renderer, 0);
    assert.equal(again.base, base);
    assert.equal(again.detail, detail);
    assert.ok(detail.style.width && detail.style.width !== "100%", "over its region");
    assert.equal(renderer.stats.kept, 2);
    assert.equal(renderer.keptPixels, 0);
  });

  it("keeps the detail drawn into the spare, which the page shows", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    const { spare } = mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    // A zoom draws the new detail into the spare, which then shows.
    renderer.update(input(1.5));
    await settle();
    assert.equal(renders.at(-1)?.request.canvas, spare);
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(0);
    assert.equal(spare.width, Math.floor(612 * 1.5), "the canvas shown is kept");

    const again = mount(renderer, 0);
    assert.equal(again.detail, spare);
    assert.equal(spare.width, Math.floor(612 * 1.5), "and not cleared");
    assert.equal(renderer.sharpness(0, whole, 1.5), 1);
    const drawn = renders.length;
    renderer.update(input(1.5));
    await settle();
    assert.equal(renders.length, drawn, "nothing is drawn again");
  });

  it("keeps nothing of pages whose form fields are shown as HTML", async () => {
    for (const forms of [false, true]) {
      const { doc, renders } = await controlledDocument();
      const renderer = new Renderer(doc, {
        maxKeptPixels: 4_000_000,
        annotationSetup: { ...DEFAULT_ANNOTATION_SETUP, forms },
      });
      const { base } = mount(renderer, 0);
      // Unsettled, the page draws its base alone, and builds no layers.
      renderer.update({ ...input(1), settled: false });
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      const pixels = base.width * base.height;
      assert.ok(pixels > 0);
      renderer.detach(0);
      assert.equal(renderer.keptPixels, forms ? 0 : pixels, `forms ${forms}`);
      assert.equal(base.width * base.height, forms ? 0 : pixels);
      renderer.dispose();
    }
  });

  it("keeps nothing while the viewer has no viewport", async (t) => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => renderer.dispose());
    const first = mount(renderer, 0).detail;
    renderer.update(input(1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(0);
    assert.ok(renderer.keptPixels > 0);

    renderer.setKeeping(false);
    assert.equal(renderer.keptPixels, 0);
    assert.equal(first.width, 0, "released");
    const second = mount(renderer, 1).detail;
    renderer.update(input(1, 1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(1);
    assert.equal(renderer.keptPixels, 0);
    assert.equal(second.width, 0);
  });

  it("lets kept canvases go when it is disposed", async () => {
    const { doc, renders } = await controlledDocument();
    const renderer = new Renderer(doc, { maxKeptPixels: 4_000_000 });
    const { detail } = mount(renderer, 0);
    renderer.update(input(1));
    await settle();
    renders.at(-1)?.resolve();
    await settle();
    renderer.detach(0);
    assert.ok(detail.width > 0);
    renderer.dispose();
    assert.equal(detail.width, 0);
    assert.equal(renderer.keptPixels, 0);
  });
});
