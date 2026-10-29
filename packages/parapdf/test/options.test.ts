import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rendererChanged, rendererOptions, type ViewerOptions } from "../src/view/options.ts";

describe("rendererChanged", () => {
  it("builds the renderer again when an option it is built with changes", () => {
    const changes: ViewerOptions[] = [
      { textLayer: false },
      { annotationLayer: false },
      { externalLinks: "disabled" },
      { pageColors: { background: "Canvas", foreground: "CanvasText" } },
      { maxConcurrentRenders: 4 },
      { maxDetailPixels: 1 },
      { maxDetailViewports: 1 },
      { maxBasePixels: 1 },
      { maxCanvasPixels: 1 },
      { maxKeptPixels: 0 },
    ];
    for (const change of changes) {
      const name = Object.keys(change).join();
      assert.equal(rendererChanged({}, change), true, name);
      assert.equal(rendererChanged(change, {}), true, name);
    }
  });

  it("keeps it for the options that apply at once or as a document opens", () => {
    const previous: ViewerOptions = { textLayer: false, maxCanvasPixels: 1e6 };
    const next: ViewerOptions = {
      ...previous,
      gap: 4,
      overscan: 0,
      minScale: 1,
      maxScale: 2,
      direction: "rtl",
      destinationZoom: false,
      initialScale: "auto",
      initialPage: 3,
      openAttachment: () => {},
      opening: async () => null,
    };
    assert.equal(rendererChanged(previous, next), false);
  });

  it("compares the page colors by value, as applications pass them inline", () => {
    const colors = () => ({ background: "Canvas", foreground: "CanvasText" });
    assert.equal(rendererChanged({ pageColors: colors() }, { pageColors: colors() }), false);
    assert.equal(
      rendererChanged(
        { pageColors: colors() },
        { pageColors: { ...colors(), foreground: "LinkText" } },
      ),
      true,
    );
  });
});

describe("rendererOptions", () => {
  it("fills in the defaults, and leaves out page colors unless they are set", () => {
    assert.deepEqual(rendererOptions({}), {
      maxConcurrent: 2,
      textLayer: true,
      annotationLayer: true,
      maxDetailPixels: undefined,
      maxDetailViewports: undefined,
      maxBasePixels: undefined,
      maxCanvasPixels: undefined,
      maxKeptPixels: undefined,
    });
  });

  it("passes the options the renderer is built with, but the external links", () => {
    const pageColors = { background: "black", foreground: "white" };
    const options = rendererOptions({
      maxConcurrentRenders: 1,
      textLayer: false,
      annotationLayer: false,
      maxDetailPixels: 1,
      maxDetailViewports: 2,
      maxBasePixels: 3,
      maxCanvasPixels: 4,
      maxKeptPixels: 0,
      pageColors,
      externalLinks: "disabled",
    });
    assert.deepEqual(options, {
      maxConcurrent: 1,
      textLayer: false,
      annotationLayer: false,
      maxDetailPixels: 1,
      maxDetailViewports: 2,
      maxBasePixels: 3,
      maxCanvasPixels: 4,
      maxKeptPixels: 0,
      pageColors,
    });
  });
});
