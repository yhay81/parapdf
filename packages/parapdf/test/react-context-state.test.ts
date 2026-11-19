import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, useContext } from "react";
import { renderToString } from "react-dom/server";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { useAnnotations } from "../src/react/annotations.ts";
import {
  activeTracked,
  createTrackedSnapshot,
  hasTrackedChange,
  LazyViewerHolder,
  SessionContext,
  selectCached,
  shallowEqual,
  useDocumentState,
  useSession,
  useViewState,
  ViewerContext,
} from "../src/react/context.ts";
import { useFormChange } from "../src/react/forms.ts";
import { useHistory } from "../src/react/history.ts";
import { usePermits } from "../src/react/permissions.ts";
import { useSearch } from "../src/react/search.ts";
import { useSelection } from "../src/react/selection.ts";
import { PdfView, useCreateViewer, useViewer } from "../src/react/viewer.ts";
import { controllerOf, type Viewer, ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, settle } from "./fake-pdfjs.ts";

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

    // A stable selector skips invocation on unchanged raw state when force=false, and re-runs when force=true (out-of-band dirty key).
    let runs = 0;
    let outOfBand = "new-tab";
    const stableSelector = (s: typeof raw2) => {
      runs++;
      return { page: s.currentPage, links: outOfBand };
    };
    const c5 = selectCached(null, raw2, stableSelector, false);
    assert.equal(runs, 1);
    const c6 = selectCached(c5, raw2, stableSelector, false);
    assert.equal(runs, 1);
    assert.equal(c6, c5);
    outOfBand = "disabled";
    const c7 = selectCached(c6, raw2, stableSelector, true);
    assert.equal(runs, 2);
    assert.deepEqual(c7.value, { page: 2, links: "disabled" });
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

    // A render that reads zero fields drops fallback once committed.
    const snap3 = createTrackedSnapshot(ready, activeTracked(snap1));
    assert.equal(activeTracked(snap3), activeTracked(snap1));
    snap3.committed = true;
    assert.equal(activeTracked(snap3)?.size, 0);
    assert.equal(
      hasTrackedChange(snap3.raw, { status: "loading", progress: 99 }, activeTracked(snap3)),
      false,
    );
  });

  it("supports object spread and Object.keys cleanly without leaking carrier fields", () => {
    const snap = createTrackedSnapshot({ currentPage: 1, pageCount: 8, rotation: 90 });
    const proxyRecord = snap.proxy as Record<string, unknown>;
    assert.equal("raw" in snap.proxy, false);
    assert.equal("tracked" in snap.proxy, false);
    assert.equal("fallback" in snap.proxy, false);
    assert.equal("proxy" in snap.proxy, false);
    assert.equal(proxyRecord.raw, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(snap.proxy, "raw"), undefined);

    const fresh = createTrackedSnapshot({ currentPage: 1, pageCount: 8, rotation: 90 });
    const copy = { ...fresh.proxy };
    assert.deepEqual(copy, { currentPage: 1, pageCount: 8, rotation: 90 });
    assert.deepEqual(Object.keys(fresh.proxy), ["currentPage", "pageCount", "rotation"]);
    assert.deepEqual(Reflect.ownKeys(fresh.proxy), ["currentPage", "pageCount", "rotation"]);
    assert.deepEqual([...fresh.tracked], ["currentPage", "pageCount", "rotation"]);

    const nullProto = Object.assign(Object.create(null) as { raw: string }, { raw: "own-raw" });
    const nullSnap = createTrackedSnapshot(nullProto);
    assert.equal(Object.getPrototypeOf(nullSnap.proxy), null);
    assert.equal(nullSnap.proxy.raw, "own-raw");
    assert.equal("raw" in nullSnap.proxy, true);
  });
});

function ContextToolbar({ seen }: { seen: Viewer[] }) {
  seen.push(useViewer());
  const { currentPage, pageCount, tool } = useViewState();
  const slice = useViewState((s) => ({ page: s.currentPage, scale: s.scale }));
  const { status } = useDocumentState();
  const docSlice = useDocumentState((s) => ({ status: s.status, pages: s.pageCount }));
  const canPrint = usePermits("print");
  const permits = usePermits();
  assert.equal(canPrint, true);
  assert.equal(permits.copy, true);
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
  assert.equal(usePermits("annotate", external), true);
  assert.equal(usePermits(external).fillForms, true);
  useSearch(external);
  return createElement("span", null, `${tool}:${scale}`);
}

function BareViewerConsumer() {
  useViewer();
  return null;
}

function DocOnlyProbe({
  customViewer,
  slots,
}: {
  customViewer: Viewer;
  slots: (ViewerController | LazyViewerHolder | null)[];
}) {
  const session = useSession();
  const docState = useDocumentState();
  const tool = useViewState((s) => s.tool, customViewer);
  slots.push(useContext(ViewerContext));
  return createElement("span", null, `${session.source ? "ok" : "no"}:${docState.status}:${tool}`);
}

function DefaultViewerProbe({
  resolvedViewers,
  slots,
}: {
  resolvedViewers: Viewer[];
  slots: (ViewerController | LazyViewerHolder | null)[];
}) {
  const first = useViewer();
  const second = useViewer();
  assert.equal(first, second);
  resolvedViewers.push(first);
  slots.push(useContext(ViewerContext));
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

    // useSelection accepts SelectionOptions alone (with context), (viewer, options), and rejects bogus Viewer objects.
    const selViewer = new ViewerController();
    assert.equal(
      renderToString(
        createElement(
          ViewerContext,
          { value: selViewer },
          createElement(() => {
            assert.equal(useSelection({ settleDrag: true }), null);
            assert.equal(useSelection({}), null);
            assert.equal(useSelection(selViewer, { settleDrag: true }), null);
            return createElement("span", null, "sel-ok");
          }),
        ),
      ),
      "<span>sel-ok</span>",
    );
    assert.throws(
      () =>
        renderToString(
          createElement(() => {
            useSelection({ bogus: true } as unknown as Viewer);
            return null;
          }),
        ),
      TypeError,
    );
  });

  it("allocates <PdfDocument>'s default ViewerController lazily and holds it across Activity hide/show", async () => {
    const slots: (ViewerController | LazyViewerHolder | null)[] = [];
    const customViewer = new ViewerController();
    customViewer.setTool("hand");
    const docSession = new PdfSessionController({ url: "/lazy-doc.pdf" });
    const docOnlyHolder = new LazyViewerHolder();

    assert.equal(
      renderToString(
        createElement(
          SessionContext,
          { value: docSession },
          createElement(
            ViewerContext,
            { value: docOnlyHolder },
            createElement(DocOnlyProbe, { customViewer, slots }),
          ),
        ),
      ),
      "<span>ok:loading:hand</span>",
    );
    assert.equal(slots[0], docOnlyHolder);
    assert.equal(docOnlyHolder.peek, null, "document-only trees allocate zero ViewerControllers");

    const resolvedViewers: Viewer[] = [];
    const activeHolder = new LazyViewerHolder();
    renderToString(
      createElement(
        SessionContext,
        { value: docSession },
        createElement(
          ViewerContext,
          { value: activeHolder },
          createElement(DefaultViewerProbe, { resolvedViewers, slots }),
        ),
      ),
    );
    assert.equal(slots[1], activeHolder);
    assert.ok(resolvedViewers[0] instanceof ViewerController);
    assert.equal(activeHolder.peek, resolvedViewers[0]);

    // Verify LazyViewerHolder connect/disconnect lifetime across initial mount, dynamic get(), and Activity hide/show.
    const { loader } = fakePdfjs(async () => fakeDocument().proxy);
    const session = new PdfSessionController({ url: "/holder-life.pdf" }, { pdfjs: loader });
    const releaseSession = session.connect();
    try {
      const holder = new LazyViewerHolder();
      let disconnectHolder = holder.connect();
      assert.equal(holder.peek, null);

      const viewer = holder.get();
      assert.equal(holder.peek, viewer);
      viewer.open(session);
      await settle();
      assert.ok(viewer.session, "viewer shows session while holder is connected");

      // Hiding (<Activity>) releases the viewer's hold on the session while keeping the viewer instance.
      disconnectHolder();
      assert.equal(viewer.session, null);
      assert.equal(holder.peek, viewer);

      // Showing again reconnects the same viewer to the session.
      disconnectHolder = holder.connect();
      await settle();
      assert.ok(viewer.session, "viewer reconnects when holder connects again");
      disconnectHolder();
    } finally {
      releaseSession();
    }

    // <PdfView> also uses LazyViewerHolder when no external viewer is passed, and unwraps external viewers directly.
    const viewSlots: (ViewerController | LazyViewerHolder | null)[] = [];
    renderToString(
      createElement(
        SessionContext,
        { value: docSession },
        createElement(
          PdfView,
          null,
          createElement(DocOnlyProbe, { customViewer, slots: viewSlots }),
        ),
      ),
    );
    assert.ok(viewSlots[0] instanceof LazyViewerHolder);
    assert.equal(
      viewSlots[0].peek,
      null,
      "<PdfView> without viewer consumers allocates zero ViewerControllers",
    );

    const externalSlots: (ViewerController | LazyViewerHolder | null)[] = [];
    renderToString(
      createElement(
        SessionContext,
        { value: docSession },
        createElement(
          PdfView,
          { viewer: customViewer },
          createElement(DocOnlyProbe, { customViewer, slots: externalSlots }),
        ),
      ),
    );
    assert.equal(externalSlots[0], customViewer);
  });
});
