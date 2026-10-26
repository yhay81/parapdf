import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PdfInitialView } from "../src/document/session.ts";
import { initialViewOpening, openingOf } from "../src/features/initial-view.ts";
import { toShownView } from "../src/features/view-state.ts";
import { Viewer } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

const destination = { pageIndex: 2, x: 0, y: 300, view: { fit: "zoom" as const, zoom: 2 } };
const asked = (view: Partial<PdfInitialView> = {}): PdfInitialView => ({
  destination,
  pageLayout: "TwoPageRight",
  pageMode: null,
  ...view,
});

describe("view states", () => {
  it("keeps the fields of the right kind", () => {
    assert.deepEqual(
      toShownView({
        page: 3.7,
        x: 10,
        y: 20,
        scale: 1.5,
        rotation: 450 as never,
        spread: "odd",
        scrollMode: "wrapped",
      }),
      {
        rotation: 90,
        spread: "odd",
        scrollMode: "wrapped",
        scale: 1.5,
        target: { pageIndex: 3, x: 10, y: 20 },
      },
    );
    assert.deepEqual(toShownView({ scale: "fit-page", rotation: -90 as never }), {
      rotation: 270,
      scale: "fit-page",
    });
  });

  it("leaves out what a URL could hold wrongly", () => {
    const shown = toShownView({
      page: "x",
      x: Number.NaN,
      scale: -1,
      rotation: Number.NaN,
      spread: "sideways",
      scrollMode: 3,
    } as never);
    assert.deepEqual(shown, {});
    assert.deepEqual(toShownView({ page: 1, x: Number.POSITIVE_INFINITY }).target, {
      pageIndex: 1,
      x: null,
      y: null,
    });
  });
});

describe("the opening", () => {
  it("arranges the pages and opens where the document asks", () => {
    assert.deepEqual(openingOf(asked(), 5, { initialView: "document" }), {
      spread: "even",
      scrollMode: "page",
      destination,
    });
    // A document that asks for no layout gets the default one.
    assert.deepEqual(openingOf(asked({ pageLayout: null }), 5, { initialView: "document" }), {
      spread: "none",
      scrollMode: "vertical",
      destination,
    });
  });

  it("lets the options the application set win", () => {
    assert.deepEqual(
      openingOf(asked(), 5, { initialView: "document", initialSpread: "none", initialPage: 1 }),
      { scrollMode: "page" },
    );
    const { view: _, ...point } = destination;
    assert.deepEqual(openingOf(asked(), 5, { initialView: "document", initialScale: 2 }), {
      spread: "even",
      scrollMode: "page",
      destination: point,
    });
  });

  it("drops a destination outside the document, and follows the options alone by default", () => {
    assert.equal(openingOf(asked(), 2, { initialView: "document" })?.destination, undefined);
    assert.equal(openingOf(asked(), 5, {}), null);
    assert.equal(initialViewOpening({}), undefined);
  });

  it("shows a view state, at the document's destination when it names no page", () => {
    assert.deepEqual(openingOf(asked(), 5, { initialView: "document", initialViewState: {} }), {
      spread: "even",
      scrollMode: "page",
      destination,
      view: { target: destination },
    });
    assert.deepEqual(
      openingOf(null, 5, { initialViewState: { page: 4, scale: "fit-width" } })?.view,
      { scale: "fit-width", target: { pageIndex: 4, x: null, y: null } },
    );
  });
});

describe("a viewer's opening", () => {
  const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const close: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
  });

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
    if (cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", cancelFrame);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });

  it("arranges the first layout as the document asks", async () => {
    const document = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      proxy: { getPageLayout: async () => "TwoColumnRight" },
    });
    const opening = initialViewOpening({ initialView: "document" });
    const viewer = new Viewer({ opening });
    close.push(show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader).close);
    await settle();
    const state = viewer.store.get();
    assert.ok(state.layout);
    assert.equal(state.spread, "even");
    assert.equal(state.scrollMode, "vertical");
    assert.equal(state.layout?.spread, "even");
  });
});
