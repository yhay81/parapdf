import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  type PdfSession,
  PdfSessionController,
  sessionControllerOf,
} from "../src/document/pdf-session.ts";
import { useAnnotations } from "../src/react/annotations.ts";
import {
  activeTracked,
  createTrackedSnapshot,
  hasTrackedChange,
  SessionContext,
  selectCached,
  shallowEqual,
  useDocumentState,
  useViewState,
  ViewerContext,
} from "../src/react/context.ts";
import { useFormChange } from "../src/react/forms.ts";
import { useHistory } from "../src/react/history.ts";
import { useSearch } from "../src/react/search.ts";
import { useSelection } from "../src/react/selection.ts";
import { useCreateViewer, useViewer } from "../src/react/viewer.ts";
import { computeLayout } from "../src/view/layout.ts";
import { controllerOf, type Viewer, ViewerController } from "../src/view/viewer.ts";
import { LETTER } from "./fake-pdfjs.ts";

describe("ViewerStore pageCount", () => {
  it("starts at 0 and publishes on cold only when the document's page count changes", () => {
    const viewer = new ViewerController();
    assert.equal(viewer.store.get().pageCount, 0);
    assert.equal(viewer.store.cold.get().pageCount, 0);

    let hotPublishes = 0;
    let coldPublishes = 0;
    viewer.store.hot.subscribe(() => hotPublishes++);
    viewer.store.cold.subscribe(() => coldPublishes++);

    const threePages = [LETTER, LETTER, LETTER];
    const layout1 = computeLayout(threePages, 1, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 0,
    });
    viewer.store.set({ layout: layout1 });
    assert.equal(viewer.store.get().pageCount, 3);
    assert.equal(viewer.store.cold.get().pageCount, 3);
    assert.equal(hotPublishes, 1);
    assert.equal(coldPublishes, 1);

    // Zooming produces a new Layout with the same page count: cold stays quiet.
    const layout2 = computeLayout(threePages, 1.5, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 0,
    });
    viewer.store.set({ layout: layout2, scale: 1.5 });
    assert.equal(viewer.store.get().pageCount, 3);
    assert.equal(hotPublishes, 2);
    assert.equal(coldPublishes, 1);

    // Closing resets layout to null and pageCount to 0.
    viewer.store.set({ layout: null, first: 0, last: -1 });
    assert.equal(viewer.store.get().pageCount, 0);
    assert.equal(viewer.store.cold.get().pageCount, 0);
    assert.equal(hotPublishes, 3);
    assert.equal(coldPublishes, 2);
  });
});

describe("shallowEqual and selector caching", () => {
  it("compares primitives, tuples, plain objects, and non-plain instances accurately", () => {
    assert.equal(shallowEqual(1, 1), true);
    assert.equal(shallowEqual(Number.NaN, Number.NaN), true);
    assert.equal(shallowEqual(+0, -0), false);
    assert.equal(shallowEqual({ page: 2, scale: 1.5 }, { page: 2, scale: 1.5 }), true);
    assert.equal(shallowEqual({ page: 2, scale: 1.5 }, { page: 3, scale: 1.5 }), false);
    assert.equal(shallowEqual({ a: 1 }, { a: 1, b: undefined }), false);
    assert.equal(shallowEqual([1, "fit-width"], [1, "fit-width"]), true);
    assert.equal(shallowEqual([1, "fit-width"], [1, "custom"]), false);
    assert.equal(shallowEqual(new Uint8Array([1]), new Uint8Array([1])), false);
    assert.equal(shallowEqual(new Map(), new Map()), false);
  });

  it("keeps the previous object reference across inline selectors while fields stay equal", () => {
    const raw1 = { currentPage: 2, scale: 1.25, first: 0 };
    const c1 = selectCached(null, raw1, (s) => ({ page: s.currentPage, scale: s.scale }));
    // New raw state from scrolling within the same page, plus a fresh inline selector.
    const raw2 = { currentPage: 2, scale: 1.25, first: 1 };
    const c2 = selectCached(c1, raw2, (s) => ({ page: s.currentPage, scale: s.scale }));
    assert.equal(c2.value, c1.value);

    // Changing a closure variable in the inline selector produces a new snapshot even on the same raw state.
    let offset = 1;
    const c3 = selectCached(c2, raw2, (s) => ({ page: s.currentPage + offset, scale: s.scale }));
    assert.notEqual(c3.value, c2.value);
    assert.deepEqual(c3.value, { page: 3, scale: 1.25 });
    offset = 2;
    const c4 = selectCached(c3, raw2, (s) => ({ page: s.currentPage + offset, scale: s.scale }));
    assert.notEqual(c4.value, c3.value);
    assert.deepEqual(c4.value, { page: 4, scale: 1.25 });
  });
});

describe("getter-tracked snapshots", () => {
  it("ignores untracked updates while keeping newly read conditional fields fresh", () => {
    const initial = { pageCount: 10, currentPage: 0, scale: 1, first: 0, last: 2 };
    const snap = createTrackedSnapshot(initial);

    // Initial render only reads pageCount.
    assert.equal(snap.proxy.pageCount, 10);
    assert.deepEqual([...snap.tracked], ["pageCount"]);

    // Hot updates change currentPage, scale, first, last — none of them tracked.
    const scrolled = { pageCount: 10, currentPage: 4, scale: 1.5, first: 3, last: 6 };
    assert.equal(hasTrackedChange(snap.raw, scrolled, activeTracked(snap)), false);

    // Refreshing raw in place keeps the same proxy identity while exposing fresh untracked values
    // if a conditional branch opens on a later parent render.
    snap.raw = scrolled;
    assert.equal(snap.proxy.currentPage, 4);
    assert.equal(snap.proxy.scale, 1.5);
    assert.deepEqual([...snap.tracked], ["pageCount", "currentPage", "scale"]);

    // Now currentPage is tracked, so moving to page 5 triggers a snapshot change.
    const nextPage = { ...scrolled, currentPage: 5 };
    assert.equal(hasTrackedChange(snap.raw, nextPage, activeTracked(snap)), true);
  });

  it("drops conditional fields once a branch stops reading them while keeping fallback pre-render", () => {
    type LoadSlice = { status: "loading" | "ready"; progress: number };
    const loading: LoadSlice = { status: "loading", progress: 10 };
    const snap1 = createTrackedSnapshot(loading);
    assert.equal(snap1.proxy.status, "loading");
    assert.equal(snap1.proxy.progress, 10);

    // Status becomes ready: subscription creates snap2 before the component renders it.
    const ready: LoadSlice = { status: "ready", progress: 50 };
    assert.equal(hasTrackedChange(snap1.raw, ready, activeTracked(snap1)), true);
    const snap2 = createTrackedSnapshot(ready, activeTracked(snap1));

    // Before render reads snap2.proxy, fallback still guards against missed changes.
    assert.equal(
      hasTrackedChange(snap2.raw, { status: "ready", progress: 60 }, activeTracked(snap2)),
      true,
    );

    // Once the component renders ready and returns early after reading status, progress is no longer tracked.
    assert.equal(snap2.proxy.status, "ready");
    assert.equal(
      hasTrackedChange(snap2.raw, { status: "ready", progress: 90 }, activeTracked(snap2)),
      false,
    );
  });

  it("supports object spread and Object.keys cleanly", () => {
    const snap = createTrackedSnapshot({ currentPage: 1, pageCount: 8, rotation: 90 });
    const copy = { ...snap.proxy };
    assert.deepEqual(copy, { currentPage: 1, pageCount: 8, rotation: 90 });
    assert.deepEqual(Object.keys(snap.proxy), ["currentPage", "pageCount", "rotation"]);
    assert.deepEqual([...snap.tracked], ["currentPage", "pageCount", "rotation"]);
  });
});

function ContextToolbar({ seen }: { seen: Viewer[] }) {
  seen.push(useViewer());
  const { currentPage, pageCount, tool } = useViewState();
  const slice = useViewState((s) => ({ page: s.currentPage, scale: s.scale }));
  const { status } = useDocumentState();
  const docSlice = useDocumentState((s) => ({ status: s.status, pages: s.pageCount }));
  useSearch();
  useHistory();
  useAnnotations();
  useSelection();
  useFormChange(() => {});
  return createElement("div", {
    "data-toolbar": `${currentPage}/${pageCount}/${tool}/${slice.scale}/${status}/${docSlice.pages}`,
  });
}

function StandaloneViewerApp({ created }: { created: Viewer[] }) {
  const external = useCreateViewer();
  created.push(external);
  const { tool } = useViewState(external);
  const scale = useViewState((s) => s.scale, external);
  useSearch(external);
  return createElement("span", null, `${tool}:${scale}`);
}

function BareViewerConsumer() {
  useViewer();
  return null;
}

describe("ViewerContext, useCreateViewer, and optional viewer hooks", () => {
  it("reads ViewerContext across all viewer hooks without explicit viewer arguments", () => {
    const defaultViewer = new ViewerController();
    defaultViewer.setTool("hand");
    assert.equal(defaultViewer.state.tool, "hand");
    const seen: Viewer[] = [];

    const session = new PdfSessionController({ url: "/manual.pdf" });
    assert.equal(session.state.status, "loading");
    assert.equal(sessionControllerOf(session), session);
    assert.throws(() => sessionControllerOf({} as PdfSession), TypeError);

    const html = renderToString(
      createElement(
        SessionContext,
        { value: session },
        createElement(
          ViewerContext,
          { value: defaultViewer },
          createElement(ContextToolbar, { seen }),
        ),
      ),
    );
    assert.equal(seen[0], defaultViewer);
    assert.equal(html, '<div data-toolbar="0/0/hand/1/loading/0"></div>');
  });

  it("creates standalone viewers via useCreateViewer and accepts explicit viewers outside ViewerContext", () => {
    const created: Viewer[] = [];
    assert.equal(
      renderToString(createElement(StandaloneViewerApp, { created })),
      "<span>select:1</span>",
    );
    const first = created[0];
    assert.ok(first instanceof ViewerController);
    assert.equal(controllerOf(first), first);
    assert.throws(() => controllerOf({} as Viewer), TypeError);

    assert.throws(
      () => renderToString(createElement(BareViewerConsumer)),
      /useViewer must be used inside/,
    );
  });
});
