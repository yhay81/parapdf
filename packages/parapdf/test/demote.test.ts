import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type PdfEngineDocument,
  RenderCancelledError,
  type RenderRequest,
  type RenderTask,
} from "../src/engine/types.ts";
import { computeLayout } from "../src/runtime/layout.ts";
import { RenderScheduler, type ScheduleInput } from "../src/runtime/scheduler.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function canvas(): HTMLCanvasElement {
  return { width: 0, height: 0, style: {} } as HTMLCanvasElement;
}

/** Renders the test settles itself, sized as the engine sizes them, and canvases drawn into others. */
function controlledDocument() {
  const renders: { request: RenderRequest; resolve: () => void; task: RenderTask }[] = [];
  const copies: { into: HTMLCanvasElement; from: HTMLCanvasElement }[] = [];
  const doc = {
    render(request: RenderRequest) {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((done, fail) => {
        resolve = () => {
          const { canvas, region, scale } = request;
          canvas.width = region ? region.width : Math.floor(612 * scale);
          canvas.height = region ? region.height : Math.floor(792 * scale);
          done();
        };
        reject = fail;
      });
      const task = { promise, cancel: () => reject(new RenderCancelledError()) };
      renders.push({ request, resolve, task });
      return task;
    },
    releasePage() {},
    drawKept(
      into: HTMLCanvasElement,
      from: HTMLCanvasElement,
      size: { width: number; height: number } = from,
    ) {
      into.width = size.width;
      into.height = size.height;
      copies.push({ into, from });
    },
  } as unknown as PdfEngineDocument;
  return { doc, renders, copies };
}

/** Two US Letter pages, page `page` in view. */
function input(scale: number, page = 0): ScheduleInput {
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

// A whole page fits the detail budget at scale 1 (484,704 pixels) but not at 2.
const options = { maxDetailPixels: 1_000_000 };

describe("RenderScheduler whole-page details zoomed past their budget", () => {
  it("shows a whole-page detail as the base under the partial one instead of drawing a base", async (t) => {
    const { doc, renders, copies } = controlledDocument();
    const scheduler = new RenderScheduler(doc, options);
    t.after(() => scheduler.dispose());
    const base = canvas();
    const detail = canvas();
    const spare = canvas();
    scheduler.attach(0, base, detail, null, null, null, spare);
    scheduler.update(input(1));
    assert.equal(renders.length, 1);
    renders[0]?.resolve();
    await settle();

    scheduler.update(input(2));
    assert.equal(renders.length, 2, "no base is drawn");
    assert.equal(renders[1]?.request.canvas, spare);
    assert.ok(renders[1]?.request.region, "part of the page");
    assert.notEqual(detail.style.visibility, "hidden", "the whole-page detail still shows");
    renders[1]?.resolve();
    await settle();

    assert.deepEqual(copies, [{ into: base, from: detail }]);
    assert.equal(base.width, 612);
    assert.equal(detail.width, 0, "the replaced canvas is released");
    // Outside the partial detail, the page shows the old detail at scale 1 of 2.
    assert.equal(scheduler.sharpness(0, { minX: 0, minY: 0.9, maxX: 1, maxY: 1 }, 2), 0.5);
    scheduler.update(input(2));
    assert.equal(renders.length, 2, "nothing more is drawn");
  });

  it("keeps a page's whole-page detail as its base when it leaves the viewport", async (t) => {
    const { doc, renders, copies } = controlledDocument();
    const scheduler = new RenderScheduler(doc, options);
    t.after(() => scheduler.dispose());
    const base = canvas();
    const detail = canvas();
    scheduler.attach(0, base, detail, null, null, null, canvas());
    scheduler.attach(1, canvas(), canvas(), null, null, null, canvas());
    scheduler.update(input(1));
    renders.find((render) => render.request.pageIndex === 0)?.resolve();
    await settle();

    // Page 2 in view at a zoom where page 1 gets no detail outside the viewport.
    scheduler.update(input(2, 1));
    assert.deepEqual(copies, [{ into: base, from: detail }]);
    assert.equal(detail.width, 0);
    assert.equal(scheduler.hasPixels(0), true);
    await settle();
    assert.equal(
      renders.filter((render) => render.request.pageIndex === 0).length,
      1,
      "page 1 draws no base",
    );
  });

  it("scales the detail down to the base's resolution", async (t) => {
    const { doc, renders, copies } = controlledDocument();
    // A base of at most 150,000 pixels: 0.56 device pixels per point here,
    // and the first whole-page detail, at most four bases, needs no base first.
    const scheduler = new RenderScheduler(doc, { ...options, maxBasePixels: 150_000 });
    t.after(() => scheduler.dispose());
    const base = canvas();
    scheduler.attach(0, base, canvas(), null, null, null, canvas());
    scheduler.update(input(1));
    renders[0]?.resolve();
    await settle();
    scheduler.update(input(2));
    renders.at(-1)?.resolve();
    await settle();
    assert.equal(copies.length, 1);
    assert.equal(base.width, Math.floor(612 * Math.sqrt(150_000 / (612 * 792))));
    assert.ok(base.width * base.height <= 150_000);
  });

  it("draws a base when a partial detail must be drawn in place", async (t) => {
    const { doc, renders, copies } = controlledDocument();
    const scheduler = new RenderScheduler(doc, options);
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.update(input(1));
    renders[0]?.resolve();
    await settle();
    // Without a spare, a partial detail is drawn in place: the page needs a base meanwhile.
    scheduler.update(input(2));
    assert.ok(renders.some((render) => render.request.scale === 1 && !render.request.region));
    assert.equal(copies.length, 0);
  });
});
