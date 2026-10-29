import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import {
  copyDrawing,
  drawPage,
  isRenderCancelled,
  pageViewport,
  RenderCancelledError,
} from "../src/pdfjs/draw.ts";
import { FakeDocument } from "./fake-dom.ts";
import { LETTER, openSession, settle } from "./fake-pdfjs.ts";

const canvas = () => new FakeDocument().createElement("canvas") as unknown as HTMLCanvasElement;

describe("isRenderCancelled", () => {
  it("recognizes ParaPDF's and pdf.js's cancellations", () => {
    assert.equal(isRenderCancelled(new RenderCancelledError("cancelled")), true);
    for (const name of ["RenderingCancelledException", "AbortException"]) {
      const error = new Error("cancelled");
      error.name = name;
      assert.equal(isRenderCancelled(error), true, name);
    }
  });

  it("leaves every other failure alone", () => {
    assert.equal(isRenderCancelled(new Error("broken")), false);
    assert.equal(isRenderCancelled("RenderCancelledError"), false);
    assert.equal(isRenderCancelled(null), false);
  });
});

describe("drawPage", () => {
  it("sizes the canvas to whole pixels past a scale's rounding error", async () => {
    const { session, drawings } = await openSession({ pages: [{ width: 596, height: 842 }] });
    // 596 points at 240 / 596 come out at 239.99… pixels.
    const scale = 240 / 596;
    assert.ok(596 * scale < 240);
    const target = canvas();
    const task = drawPage(session.pdfjs, session.page(0), { scale, canvas: target });
    await settle();
    assert.deepEqual([target.width, target.height], [240, 339]);
    assert.equal(drawings[0]?.request.region, undefined);
    drawings[0]?.resolve();
    await task.promise;
  });

  it("draws a region into a canvas of its size, the page shifted to its corner", async () => {
    const { session, drawings } = await openSession({ pages: [LETTER] });
    const target = canvas();
    const region = { x: 30, y: 40, width: 100, height: 50 };
    drawPage(session.pdfjs, session.page(0), { scale: 2, canvas: target, region });
    await settle();
    assert.deepEqual([target.width, target.height], [100, 50]);
    assert.deepEqual(drawings[0]?.request.region, region);
  });

  it("draws nothing once cancelled before the page loads", async () => {
    const { session, drawings } = await openSession({ pages: [LETTER] });
    const task = drawPage(session.pdfjs, session.page(0), { scale: 1, canvas: canvas() });
    task.cancel();
    await assert.rejects(task.promise, RenderCancelledError);
    assert.equal(drawings.length, 0);
  });
});

describe("pageViewport", () => {
  it("turns the page by the view on top of its own rotation", () => {
    const turns: number[] = [];
    const page = {
      rotate: 90,
      getViewport: ({ rotation }: { rotation: number }) => turns.push(rotation),
    } as unknown as Pdfjs.PDFPageProxy;
    pageViewport(page, 1);
    pageViewport(page, 1, 180);
    pageViewport(page, 1, 270);
    assert.deepEqual(turns, [90, 270, 0]);
  });
});

describe("copyDrawing", () => {
  it("sizes the canvas and draws the source into all of it", async () => {
    const { session } = await openSession();
    const source = canvas();
    const target = canvas();
    copyDrawing(session.pdfjs, target, source, 120, 80);
    assert.deepEqual([target.width, target.height], [120, 80]);
    assert.deepEqual((target as unknown as { copied: unknown[] }).copied, [source]);
  });
});
