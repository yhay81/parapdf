import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { DocumentSession, PdfInitialView } from "../src/document/session.ts";
import { Store } from "../src/document/store.ts";
import {
  followFragments,
  fragmentDestinations,
  initialViewOpening,
  openingFragment,
  openingOf,
} from "../src/features/initial-view.ts";
import { toShownView } from "../src/features/view-state.ts";
import type { Destination } from "../src/pdfjs/destinations.ts";
import type { ViewerExtension } from "../src/view/extensions.ts";
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

describe("a URL's open parameters", () => {
  it("treats inherited object names as unknown zooms", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.deepEqual(fragmentDestinations(`page=2&zoom=${name}`, 0), [
        [1, { name: "XYZ" }, null, null, null],
      ]);
    }
  });

  it("reads page and zoom as pdf.js's viewer does", () => {
    assert.deepEqual(fragmentDestinations("page=3", 0), [[2, { name: "XYZ" }, null, null, null]]);
    assert.deepEqual(fragmentDestinations("page=3&zoom=150,10,700", 0), [
      [2, { name: "XYZ" }, 10, 700, 1.5],
    ]);
    // A zoom without a page applies to the current one; a junk page is the first.
    assert.deepEqual(fragmentDestinations("zoom=200", 4), [[4, { name: "XYZ" }, null, null, 2]]);
    assert.deepEqual(fragmentDestinations("page=x", 4), [[0, { name: "XYZ" }, null, null, null]]);
    assert.deepEqual(fragmentDestinations("PAGE=2&zoom=FitH,300", 0), [[1, { name: "FitH" }, 300]]);
    assert.deepEqual(fragmentDestinations("page=1&zoom=Fit", 0), [[0, { name: "Fit" }]]);
    assert.deepEqual(fragmentDestinations("page=1&zoom=FitR,1,2,3,4", 0), [
      [0, { name: "FitR" }, 1, 2, 3, 4],
    ]);
    assert.deepEqual(fragmentDestinations("page=1&zoom=page-width,0,500", 0), [
      [0, { name: "FitH" }, 500],
    ]);
    // A zoom it cannot use leaves the page alone, as pdf.js's viewer does.
    assert.deepEqual(fragmentDestinations("page=2&zoom=FitR,1,2", 0), [
      [1, { name: "XYZ" }, null, null, null],
    ]);
    assert.deepEqual(fragmentDestinations("page=2&zoom=auto", 0), [
      [1, { name: "XYZ" }, null, null, null],
    ]);
  });

  it("tries a named destination first, and leaves the rest to the application", () => {
    assert.deepEqual(fragmentDestinations("nameddest=intro&page=2", 0), [
      "intro",
      [1, { name: "XYZ" }, null, null, null],
    ]);
    assert.deepEqual(fragmentDestinations("search=word&pagemode=bookmarks", 0), []);
    assert.deepEqual(fragmentDestinations("intro", 0), []);
    assert.deepEqual(fragmentDestinations("", 0), []);
  });

  it("opens there, over the document's destination and the application's page", () => {
    const linked = { pageIndex: 4, x: null, y: 100 };
    assert.deepEqual(
      openingOf(asked(), 5, { initialView: "document", initialPage: 1 }, linked)?.view,
      { target: linked },
    );
    // Outside the document, it opens as though it had none.
    assert.deepEqual(
      openingOf(asked(), 5, { initialView: "document" }, { ...linked, pageIndex: 7 }),
      { spread: "even", scrollMode: "page", destination },
    );
    // A view state wins, and opens there when it names no page.
    assert.deepEqual(
      openingOf(null, 5, { initialViewState: { page: 1, scale: 2 } }, linked)?.view,
      { scale: 2, target: { pageIndex: 1, x: null, y: null } },
    );
    assert.deepEqual(openingOf(null, 5, { initialViewState: { scale: 2 } }, linked)?.view, {
      scale: 2,
      target: linked,
    });
  });

  it("resolves the fragment as the document opens, past a name it lacks", async () => {
    const resolved: Destination[] = [];
    const session = {
      pageCount: 5,
      initialView: async () => ({ destination, pageLayout: null, pageMode: null }),
      resolveDestination: async (dest: Destination) => {
        resolved.push(dest);
        if (typeof dest === "string") return null;
        const [pageIndex] = dest as unknown as [number];
        return { pageIndex, x: null, y: null };
      },
    } as unknown as DocumentSession;
    let fragment = "nameddest=missing&zoom=50";
    const opening = initialViewOpening({ initialView: "document", fragment: () => fragment });
    assert.ok(opening);
    // The zoom applies to the page the document asks to open at.
    assert.deepEqual((await opening(session))?.view, {
      target: { pageIndex: 2, x: null, y: null },
    });
    assert.deepEqual(resolved, ["missing", [2, { name: "XYZ" }, null, null, 0.5]]);
    fragment = "";
    assert.equal((await opening(session))?.view, undefined);
  });
});

describe("following URL fragments", () => {
  it("cancels superseded moves and follows changes made while unavailable", async () => {
    const source = new Store({ fragment: "page=1" });
    const moves: { destination: Destination; signal: AbortSignal }[] = [];
    let extension: ViewerExtension | null = null;
    const viewer = {
      store: new Store({ currentPage: 0 }),
      extend(next: ViewerExtension) {
        extension = next;
        return () => {
          extension = null;
        };
      },
      async goToDestination(destination: Destination, signal: AbortSignal) {
        moves.push({ destination, signal });
        return !signal.aborted;
      },
    } as unknown as Viewer;
    const ready = () => {
      const control = new AbortController();
      (extension as ViewerExtension | null)?.ready?.({} as DocumentSession, control.signal);
      return control;
    };
    assert.equal(openingFragment(viewer, source), "page=1");
    let detach = followFragments(viewer, source);
    const first = ready();
    assert.equal(moves.length, 0, "the opening already applied this fragment");
    source.set({ fragment: "page=2" });
    source.set({ fragment: "page=3" });
    assert.equal(moves[0]?.signal.aborted, true);
    assert.equal(moves[1]?.signal.aborted, false);
    await settle();
    first.abort();
    source.set({ fragment: "page=4" });
    assert.equal(moves.length, 2, "wait until the viewport is ready");
    ready();
    await settle();
    assert.deepEqual(moves[2]?.destination, [3, { name: "XYZ" }, null, null, null]);
    detach();
    source.set({ fragment: "page=5" });
    detach = followFragments(viewer, source);
    ready();
    await settle();
    assert.deepEqual(moves[3]?.destination, [4, { name: "XYZ" }, null, null, null]);
    ready();
    assert.equal(moves.length, 4, "reattaching without a new fragment keeps the view");
    detach();
    assert.equal(moves[3]?.signal.aborted, true);
  });
});
