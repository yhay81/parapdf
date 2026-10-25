import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RenderScheduler, type ScheduleInput } from "../src/runtime/scheduler.ts";
import { computeLayout } from "../src/view/layout.ts";
import { fakeCanvas as canvas, LETTER, openSession, settle } from "./fake-pdfjs.ts";

/** A session of two pages, whose drawings stay pending until the test settles them. */
async function controlledDocument() {
  const { session, drawings } = await openSession({ pages: [LETTER, LETTER] });
  return { doc: session, renders: drawings };
}

function input(scale = 1, settled = false): ScheduleInput {
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

describe("RenderScheduler failures", () => {
  it("tries a base after detail fails, then leaves both failed layers alone", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc);
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    const view = input(1, true);
    scheduler.update(view);
    await settle();
    assert.equal(renders.length, 1);
    assert.equal(renders[0]?.request.scale, 1);
    renders[0]?.reject(new Error("unsupported drawing"));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.request.scale, 0.5);
    renders[1]?.reject(new Error("unsupported drawing"));
    await settle();
    for (let frame = 0; frame < 10; frame++) scheduler.update(view);
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(scheduler.stats.failed, 2);
    assert.equal(scheduler.hasPixels(0), false);
  });

  for (const initialBase of [false, true]) {
    it(`replaces stale detail with a base after a content change${initialBase ? " with an existing base" : ""}`, async (t) => {
      t.mock.method(console, "error", () => {});
      const { doc, renders } = await controlledDocument();
      const scheduler = new RenderScheduler(doc);
      t.after(() => scheduler.dispose());
      const base = canvas();
      const detail = canvas();
      const spare = canvas();
      scheduler.attach(0, base, detail, null, null, null, spare);
      if (initialBase) {
        scheduler.update(input());
        await settle();
        renders[0]?.resolve();
        await settle();
      }
      const view = input(1, true);
      scheduler.update(view);
      await settle();
      renders.at(-1)?.resolve();
      await settle();
      assert.equal(detail.style.visibility, "");
      const before = renders.length;

      scheduler.invalidateContent();
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
      assert.equal(scheduler.hasPixels(0), true);
      for (let frame = 0; frame < 10; frame++) scheduler.update(view);
      await settle();
      assert.equal(renders.length, before + 2);
      assert.equal(scheduler.stats.failed, 1);
    });
  }

  it("keeps stale detail if its replacement and base fallback both fail", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc);
    t.after(() => scheduler.dispose());
    const detail = canvas();
    scheduler.attach(0, canvas(), detail, null, null, null, canvas());
    const view = input(1, true);
    scheduler.update(view);
    await settle();
    renders[0]?.resolve();
    await settle();
    scheduler.invalidateContent();
    await settle();
    renders[1]?.reject(new Error("failed replacement detail"));
    await settle();
    assert.equal(renders.length, 3);
    renders[2]?.reject(new Error("failed fallback base"));
    await settle();
    for (let frame = 0; frame < 10; frame++) scheduler.update(view);
    await settle();
    assert.equal(renders.length, 3);
    assert.equal(detail.style.visibility, "");
    assert.equal(scheduler.hasPixels(0), true);
    assert.equal(scheduler.stats.failed, 2);
  });

  it("lets other pages draw when a page fails", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxConcurrent: 1 });
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.attach(1, canvas(), canvas(), null, null);
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
    scheduler.update(view);
    await settle();
    renders[0]?.reject(new Error("broken page"));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.pageIndex, 1);
    renders[1]?.resolve();
    await settle();
    assert.equal(scheduler.hasPixels(1), true);
    assert.equal(renders.length, 2);
  });

  it("retries after zooming or changing the page's drawing", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc);
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.update(input());
    await settle();
    renders[0]?.reject(new Error("failed at the first zoom"));
    await settle();
    scheduler.update(input(2));
    await settle();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]?.request.scale, 1);
    renders[1]?.reject(new Error("failed at the second zoom"));
    await settle();
    scheduler.invalidateContent();
    await settle();
    assert.equal(renders.length, 3);
    assert.equal(renders[2]?.request.scale, 1);
    renders[2]?.resolve();
    await settle();
    assert.equal(scheduler.hasPixels(0), true);
    assert.equal(renders.length, 3);
  });

  it("retries a failed page when it mounts again", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc);
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.update(input());
    await settle();
    renders[0]?.reject(new Error("failed before leaving the mounted window"));
    await settle();
    scheduler.detach(0);
    scheduler.attach(0, canvas(), canvas(), null, null);
    await settle();
    assert.equal(renders.length, 2);
    renders[1]?.resolve();
    await settle();
    assert.equal(scheduler.hasPixels(0), true);
  });

  it("blocks a failed region until scrolling asks for a different region", async (t) => {
    t.mock.method(console, "error", () => {});
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc, { maxDetailPixels: 1_000_000 });
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    const view = input(4, true);
    scheduler.update(view);
    await settle();
    renders[0]?.resolve();
    await settle();
    assert.equal(renders.length, 2);
    assert.ok(renders[1]?.request.region);
    renders[1]?.reject(new Error("failed region"));
    await settle();
    scheduler.update(view);
    await settle();
    assert.equal(renders.length, 2);
    scheduler.update({ ...view, viewport: { ...view.viewport, top: 300 } });
    await settle();
    assert.equal(renders.length, 3);
    assert.notDeepEqual(renders[2]?.request.region, renders[1]?.request.region);
    renders[2]?.resolve();
    await settle();
    assert.equal(scheduler.stats.detail, 1);
  });

  it("does not count cancellation as a failed drawing", async (t) => {
    const { doc, renders } = await controlledDocument();
    const scheduler = new RenderScheduler(doc);
    t.after(() => scheduler.dispose());
    scheduler.attach(0, canvas(), canvas(), null, null);
    scheduler.update(input());
    await settle();
    renders[0]?.task.cancel();
    await settle();
    assert.equal(renders.length, 2);
    renders[1]?.resolve();
    await settle();
    assert.equal(scheduler.hasPixels(0), true);
    assert.equal(scheduler.stats.failed, 0);
    assert.equal(scheduler.stats.cancelled, 1);
  });
});

describe("RenderScheduler lifecycle", () => {
  it("disposes itself when its signal aborts: drawings stop, and pages are given back", async () => {
    const { session, drawings, cleaned } = await openSession({ pages: [LETTER, LETTER] });
    const controller = new AbortController();
    const scheduler = new RenderScheduler(session, { signal: controller.signal });
    const base = canvas();
    scheduler.attach(0, base, canvas(), null, null);
    scheduler.update(input());
    await settle();
    assert.equal(drawings.length, 1);
    controller.abort();
    await settle();
    assert.equal(drawings[0]?.cancellations, 1, "the drawing in progress is cancelled");
    assert.equal(base.width, 0, "the page's canvases are given back");
    assert.deepEqual(cleaned, [0], "and pdf.js's parsing results of it");
    scheduler.update(input());
    await settle();
    assert.equal(drawings.length, 1, "nothing is drawn after");
  });
});
