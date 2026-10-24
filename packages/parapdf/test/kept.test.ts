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

/**
 * Keeps each render pending until the test settles it; a completed render
 * sizes its canvas as the engine does. Records the drawings kept canvases
 * were drawn back from.
 */
function controlledDocument() {
  const renders: {
    request: RenderRequest;
    resolve: () => void;
    reject: (error: Error) => void;
    task: RenderTask;
  }[] = [];
  const drawnBack: { into: HTMLCanvasElement; from: HTMLCanvasElement }[] = [];
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
      renders.push({ request, resolve, reject, task });
      return task;
    },
    releasePage() {},
    drawKept(into: HTMLCanvasElement, from: HTMLCanvasElement) {
      into.width = from.width;
      into.height = from.height;
      drawnBack.push({ into, from });
    },
  } as unknown as PdfEngineDocument;
  return { doc, renders, drawnBack };
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

const whole = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

describe("RenderScheduler kept canvases", () => {
  it("draws a page's kept canvas back when it mounts again, without rendering it", async (t) => {
    const { doc, renders, drawnBack } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    const detail = canvas();
    scheduler.attach(0, canvas(), detail, null, null);
    scheduler.update(input(1));
    assert.equal(renders.length, 1);
    renders[0]?.resolve();
    await settle();

    scheduler.detach(0);
    assert.equal(detail.width * detail.height, 612 * 792, "a kept canvas keeps its pixels");
    assert.equal(
      scheduler.keptPixels,
      612 * 792,
      "the whole-page detail alone, which covers the base",
    );

    const again = canvas();
    scheduler.attach(0, canvas(), again, null, null);
    assert.deepEqual(drawnBack, [{ into: again, from: detail }]);
    assert.equal(detail.width * detail.height, 0, "drawn back, the kept canvas goes");
    assert.equal(scheduler.keptPixels, 0);
    assert.equal(scheduler.stats.kept, 1);
    assert.equal(scheduler.sharpness(0, whole, 1), 1);
    scheduler.update(input(1));
    assert.equal(renders.length, 1, "nothing is rendered again");
  });

  it("keeps the canvases as they are when React mounts the same ones again", async (t) => {
    const { doc, renders, drawnBack } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    const base = canvas();
    const detail = canvas();
    scheduler.attach(0, base, detail, null, null);
    scheduler.update(input(1));
    renders[0]?.resolve();
    await settle();
    scheduler.detach(0);
    scheduler.attach(0, base, detail, null, null);
    assert.equal(drawnBack.length, 0);
    assert.equal(detail.width * detail.height, 612 * 792);
    assert.equal(scheduler.hasPixels(0), true);
  });

  it("shows a drawing kept at another zoom until the page is rendered again", async (t) => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.update(input(1));
    renders[0]?.resolve();
    await settle();
    scheduler.detach(0);
    scheduler.update(input(1.5));
    // With a spare canvas, the new detail is drawn while the kept one shows.
    const spare = canvas();
    scheduler.attach(0, canvas(), canvas(), null, null, null, spare);
    assert.equal(scheduler.hasPixels(0), true);
    assert.equal(scheduler.sharpness(0, whole, 1.5), 2 / 3);
    assert.equal(renders.at(-1)?.request.scale, 1.5);
    assert.equal(renders.at(-1)?.request.canvas, spare);
  });

  it("lets the least recently kept canvases go beyond its budget", async (t) => {
    const { doc, renders } = controlledDocument();
    // Room for one page's drawing.
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 600_000 });
    t.after(() => scheduler.dispose());
    const details = [canvas(), canvas()];
    for (const page of [0, 1]) {
      scheduler.attach(page, canvas(), details[page] as HTMLCanvasElement, null, null);
      scheduler.update(input(1, page));
      renders.at(-1)?.resolve();
      await settle();
      scheduler.detach(page);
    }
    // The least recently kept go once the commit's mounting pages took theirs.
    assert.equal(details[0]?.width, 612);
    await settle();
    assert.equal(details[0]?.width, 0, "released");
    assert.equal(details[1]?.width, 612);
    assert.equal(scheduler.keptPixels, 612 * 792);
  });

  it("lets a page mounting in the same commit take its canvases before others go", async (t) => {
    const { doc, renders, drawnBack } = controlledDocument();
    // Room for one page's drawing.
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 600_000 });
    t.after(() => scheduler.dispose());
    const first = canvas();
    scheduler.attach(0, canvas(), first, null, null);
    scheduler.update(input(1));
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(0);
    const second = canvas();
    scheduler.attach(1, canvas(), second, null, null);
    scheduler.update(input(1, 1));
    renders.at(-1)?.resolve();
    await settle();
    // One commit: page 2 unmounts, over the budget with page 1's, and page 1 mounts.
    scheduler.detach(1);
    const again = canvas();
    scheduler.attach(0, canvas(), again, null, null);
    await settle();
    assert.deepEqual(drawnBack, [{ into: again, from: first }]);
    assert.equal(second.width, 612, "page 2's canvas is kept, within the budget again");
  });

  it("keeps nothing drawn before the content changed or the view turned", async (t) => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    for (const change of [() => scheduler.invalidateContent(), () => scheduler.rotate(90)]) {
      const detail = canvas();
      scheduler.attach(0, canvas(), detail, null, null);
      scheduler.update(input(1));
      renders.at(-1)?.resolve();
      await settle();
      scheduler.detach(0);
      assert.ok(scheduler.keptPixels > 0);
      change();
      assert.equal(scheduler.keptPixels, 0);
      assert.equal(detail.width, 0);
    }
  });

  it("lets kept canvases go first within maxCanvasPixels", async (t) => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, {
      maxKeptPixels: 4_000_000,
      maxCanvasPixels: 1_200_000,
    });
    t.after(() => scheduler.dispose());
    const kept = canvas();
    scheduler.attach(0, canvas(), kept, null, null);
    scheduler.update(input(1));
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(0);
    assert.equal(kept.width, 612);
    scheduler.attach(1, canvas(), canvas(), null, null);
    scheduler.update(input(1.5, 1));
    // Page 2's render at the old zoom, begun as an overscan page, is cancelled
    // and its base begins.
    await settle();
    assert.equal(renders.at(-1)?.request.scale, 0.75);
    assert.equal(kept.width, 612, "the base of page 2 fits beside it");
    renders.at(-1)?.resolve();
    await settle();
    // Its detail does not, with the kept 484,704 pixels.
    assert.equal(renders.at(-1)?.request.scale, 1.5);
    assert.equal(kept.width, 0, "the kept canvas went");
    assert.equal(scheduler.keptPixels, 0);
  });

  it("keeps nothing with a budget of 0", async (t) => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 0 });
    t.after(() => scheduler.dispose());
    const detail = canvas();
    scheduler.attach(0, canvas(), detail, null, null);
    scheduler.update(input(1));
    renders[0]?.resolve();
    await settle();
    scheduler.detach(0);
    assert.equal(detail.width, 0);
    assert.equal(scheduler.keptPixels, 0);
  });

  it("keeps six viewports' worth of device pixels by default, and no page larger than that", async () => {
    for (const [maxKeptPixels, kept] of [
      [undefined, 612 * 792],
      [400_000, 0],
    ] as const) {
      const { doc, renders } = controlledDocument();
      const scheduler = new RenderScheduler(doc, { maxKeptPixels });
      const detail = canvas();
      scheduler.attach(0, canvas(), detail, null, null);
      scheduler.update(input(1));
      renders.at(-1)?.resolve();
      await settle();
      scheduler.detach(0);
      assert.equal(scheduler.keptPixels, kept, `maxKeptPixels ${maxKeptPixels}`);
      assert.equal(detail.width * detail.height, kept);
      scheduler.dispose();
    }
  });

  it("keeps a base and a partial detail, and draws both back", async (t) => {
    const { doc, renders, drawnBack } = controlledDocument();
    // At scale 2, the whole page (1,938,816 pixels) is over its detail budget.
    const scheduler = new RenderScheduler(doc, {
      maxKeptPixels: 4_000_000,
      maxDetailPixels: 1_000_000,
    });
    t.after(() => scheduler.dispose());
    const base = canvas();
    const detail = canvas();
    scheduler.attach(0, base, detail, null, null);
    scheduler.update(input(2));
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
    scheduler.detach(0);
    assert.equal(scheduler.keptPixels, pixels);

    const [newBase, newDetail] = [canvas(), canvas()];
    scheduler.attach(0, newBase, newDetail, null, null);
    assert.deepEqual(drawnBack, [
      { into: newBase, from: base },
      { into: newDetail, from: detail },
    ]);
    assert.ok(newDetail.style.width && newDetail.style.width !== "100%", "over its region");
    assert.equal(scheduler.stats.kept, 2);
    assert.equal(scheduler.keptPixels, 0);
  });

  it("takes a detail drawn into the spare back as it is when React mounts the same canvases again", async (t) => {
    const { doc, renders, drawnBack } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    const base = canvas();
    const detail = canvas();
    const spare = canvas();
    scheduler.attach(0, base, detail, null, null, null, spare);
    scheduler.update(input(1));
    renders.at(-1)?.resolve();
    await settle();
    // A zoom draws the new detail into the spare, which then shows.
    scheduler.update(input(1.5));
    assert.equal(renders.at(-1)?.request.canvas, spare);
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(0);
    assert.equal(spare.width, Math.floor(612 * 1.5), "the canvas shown is kept");

    scheduler.attach(0, base, detail, null, null, null, spare);
    assert.deepEqual(drawnBack, []);
    assert.equal(spare.width, Math.floor(612 * 1.5), "and not cleared");
    assert.equal(scheduler.sharpness(0, whole, 1.5), 1);
    const drawn = renders.length;
    scheduler.update(input(1.5));
    await settle();
    assert.equal(renders.length, drawn, "nothing is drawn again");
  });

  it("keeps nothing of pages whose form fields are shown as HTML", async () => {
    const container = { replaceChildren() {} } as unknown as HTMLElement;
    for (const forms of [false, true]) {
      const { doc, renders } = controlledDocument();
      const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000, forms });
      const base = canvas();
      // Unsettled, the page draws its base alone, and builds no layers.
      scheduler.attach(0, base, canvas(), null, container);
      scheduler.update({ ...input(1), settled: false });
      renders.at(-1)?.resolve();
      await settle();
      const pixels = base.width * base.height;
      assert.ok(pixels > 0);
      scheduler.detach(0);
      assert.equal(scheduler.keptPixels, forms ? 0 : pixels, `forms ${forms}`);
      assert.equal(base.width * base.height, forms ? 0 : pixels);
      scheduler.dispose();
    }
  });

  it("keeps nothing while the viewer has no viewport", async (t) => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    t.after(() => scheduler.dispose());
    const first = canvas();
    scheduler.attach(0, canvas(), first, null, null);
    scheduler.update(input(1));
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(0);
    assert.ok(scheduler.keptPixels > 0);

    scheduler.setKeeping(false);
    assert.equal(scheduler.keptPixels, 0);
    assert.equal(first.width, 0, "released");
    const second = canvas();
    scheduler.attach(1, canvas(), second, null, null);
    scheduler.update(input(1, 1));
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(1);
    assert.equal(scheduler.keptPixels, 0);
    assert.equal(second.width, 0);
  });

  it("lets kept canvases go when it is disposed", async () => {
    const { doc, renders } = controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxKeptPixels: 4_000_000 });
    const detail = canvas();
    scheduler.attach(0, canvas(), detail, null, null);
    scheduler.update(input(1));
    renders.at(-1)?.resolve();
    await settle();
    scheduler.detach(0);
    assert.ok(detail.width > 0);
    scheduler.dispose();
    assert.equal(detail.width, 0);
    assert.equal(scheduler.keptPixels, 0);
  });
});
