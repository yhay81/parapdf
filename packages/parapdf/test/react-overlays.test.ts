import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { createSelectionAnchor, type PdfSelection } from "../src/features/selection.ts";
import type { Rotation } from "../src/pdfjs/draw.ts";
import { SessionContext, ViewerContext } from "../src/react/context.ts";
import { overlayStoreOf, PdfPageOverlay, PdfPageOverlays } from "../src/react/overlays.ts";
import { preloadDocument, preloadDocumentWith } from "../src/react/preload.ts";
import { computePopoverPosition, sameSelection } from "../src/react/selection.ts";
import { computeLayout, turnBox, unturnPoint } from "../src/view/layout.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { FakeDocument } from "./fake-dom.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

function fakeScrollerAndContent(width = 800, height = 600, left = 20, top = 40) {
  const scroller = {
    clientWidth: width,
    clientHeight: height,
    clientLeft: 0,
    clientTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    style: { setProperty() {}, removeProperty() {} } as unknown as CSSStyleDeclaration,
    classList: { add() {}, remove() {}, toggle() {} },
    ownerDocument: { activeElement: null },
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
    scrollTo({ left: l, top: t }: { left?: number; top?: number }) {
      if (l !== undefined) (scroller as { scrollLeft: number }).scrollLeft = l;
      if (t !== undefined) (scroller as { scrollTop: number }).scrollTop = t;
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  } as unknown as HTMLElement;

  const sections = new Map<number, HTMLElement>();
  const content = {
    style: { setProperty() {}, removeProperty() {} } as unknown as CSSStyleDeclaration,
    classList: { add() {}, remove() {}, toggle() {} },
    ownerDocument: { activeElement: null },
    querySelector(selector: string) {
      const match = /^section\[data-page="(\d+)"\]$/.exec(selector);
      return match ? (sections.get(Number(match[1]) - 1) ?? null) : null;
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLElement;

  return { scroller, content, sections };
}

function withBrowserGlobals<T>(run: () => Promise<T> | T): Promise<T> {
  const names = [
    "window",
    "document",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
  ];
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const fakeDoc = new FakeDocument();
  Object.assign(globalThis, {
    window: {
      devicePixelRatio: 1,
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    },
    document: {
      createElement: (tag: string) => {
        const el = fakeDoc.createElement(tag) as unknown as HTMLElement & {
          dataset: Record<string, string>;
        };
        el.dataset = {};
        return el;
      },
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      names.forEach((name, index) => {
        const descriptor = saved[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    });
}

describe("unturnPoint and viewer.pointAt", () => {
  it("inverts turnBox across 0, 90, 180, and 270 degrees and userUnit-scaled page sizes", () => {
    const sizes = [LETTER, { width: 1224, height: 1584 }];
    const rotations: Rotation[] = [0, 90, 180, 270];
    for (const size of sizes) {
      for (const rotation of rotations) {
        const original = { x: 144, y: 216, width: 0, height: 0 };
        const turned = turnBox(original, size, rotation);
        const turnedW = rotation % 180 === 0 ? size.width : size.height;
        const turnedH = rotation % 180 === 0 ? size.height : size.width;
        const restored = unturnPoint(turned.x / turnedW, turned.y / turnedH, size, rotation);
        assert.ok(Math.abs(restored.x - original.x) < 1e-9);
        assert.ok(Math.abs(restored.y - original.y) < 1e-9);
      }
    }
  });

  it("maps client points to unturned PDF coordinates via live host boxes and layout fallback", () =>
    withBrowserGlobals(() => {
      const viewer = new ViewerController();
      assert.equal(viewer.pointAt({ clientX: 100, clientY: 100 }), null);

      const { scroller, content } = fakeScrollerAndContent(900, 900, 20, 40);
      const detachViewport = viewer.attachViewport(scroller, content);

      // Headless layout fallback (no mounted page host boxes yet):
      for (const rotation of [0, 90, 180, 270] as Rotation[]) {
        const layout = computeLayout([LETTER, LETTER], 1, {
          gap: 12,
          rotation,
          spread: "none",
          scrollMode: "vertical",
          direction: "ltr",
          viewportWidth: 900,
          page: 0,
        });
        viewer.store.set({ layout, scale: 1, rotation, first: 0, last: 1 });

        // Outside viewport box and inside top gap return null.
        assert.equal(viewer.pointAt({ clientX: 10, clientY: 100 }), null);
        assert.equal(viewer.pointAt({ clientX: 400, clientY: 45 }), null);
        assert.equal(viewer.pointAt({ clientX: Number.NaN, clientY: 100 }), null);

        // Place target point (72, 108) on page 0 and map its screen position back via pointAt.
        const turned = turnBox({ x: 72, y: 108, width: 0, height: 0 }, LETTER, rotation);
        const pageWidth = layout.widths[0] ?? 0;
        const pageScreenLeft = 20 + Math.max(12, (900 - pageWidth) / 2);
        const pageScreenTop = 40 + 12;
        const hit = viewer.pointAt({
          clientX: pageScreenLeft + turned.x,
          clientY: pageScreenTop + turned.y,
        });
        assert.ok(hit);
        assert.equal(hit.pageIndex, 0);
        assert.ok(Math.abs(hit.x - 72) < 1e-6);
        assert.ok(Math.abs(hit.y - 108) < 1e-6);
      }

      // Live mounted host box (e.g., scaled 1.1x during a CSS zoom preview) takes precedence over layout widths:
      const layout0 = computeLayout([LETTER, LETTER], 1, {
        gap: 12,
        rotation: 90,
        spread: "none",
        scrollMode: "vertical",
        direction: "ltr",
        viewportWidth: 900,
        page: 0,
      });
      viewer.store.set({ layout: layout0, scale: 1, rotation: 90, first: 0, last: 0 });
      const host = document.createElement("section");
      // Turned LETTER (792 x 612) rendered at 1.1x preview scale at client (30, 50):
      host.getBoundingClientRect = () =>
        ({
          left: 30,
          top: 50,
          right: 30 + 792 * 1.1,
          bottom: 50 + 612 * 1.1,
          width: 792 * 1.1,
          height: 612 * 1.1,
        }) as DOMRect;
      const detachPage = viewer.attachPage(0, host);

      const turnedTarget = turnBox({ x: 100, y: 200, width: 0, height: 0 }, LETTER, 90);
      const previewHit = viewer.pointAt({
        clientX: 30 + turnedTarget.x * 1.1,
        clientY: 50 + turnedTarget.y * 1.1,
      });
      assert.ok(previewHit);
      assert.equal(previewHit.pageIndex, 0);
      assert.ok(Math.abs(previewHit.x - 100) < 1e-6);
      assert.ok(Math.abs(previewHit.y - 200) < 1e-6);
      // Between/outside mounted page boxes returns null rather than falling back to stale unzoomed layout.
      assert.equal(viewer.pointAt({ clientX: 25, clientY: 70 }), null);

      detachPage();

      // In "page" mode, hidden overscan rows are ignored.
      const pageModeLayout = computeLayout([LETTER, LETTER], 1, {
        gap: 12,
        rotation: 0,
        spread: "none",
        scrollMode: "page",
        direction: "ltr",
        viewportWidth: 800,
        page: 0,
      });
      viewer.store.set({ layout: pageModeLayout, scrollMode: "page", first: 0, last: 1 });
      const hiddenHost = document.createElement("section");
      hiddenHost.getBoundingClientRect = () =>
        ({ left: 50, top: 60, right: 662, bottom: 852, width: 612, height: 792 }) as DOMRect;
      const detachHidden = viewer.attachPage(1, hiddenHost);
      // Page 1 is hidden in "page" mode when page 0 is shown, so it never steals hits.
      const pageModeHit = viewer.pointAt({ clientX: 200, clientY: 200 });
      assert.equal(pageModeHit?.pageIndex, 0);

      detachHidden();
      detachViewport();
    }));

  it("exposes pointer claim state accurately via viewer.pointerClaimed", () => {
    const viewer = new ViewerController();
    assert.equal(viewer.pointerClaimed, false);
    viewer.claimPointer(true);
    assert.equal(viewer.pointerClaimed, true);
    viewer.claimPointer(false);
    assert.equal(viewer.pointerClaimed, false);
  });
});

describe("OverlayStore, PdfPageOverlay, PdfPageOverlays, and PdfPageRect", () => {
  it("keeps two overlay renderers when one moves into the other's viewer", () => {
    const first = overlayStoreOf(new ViewerController());
    const second = overlayStoreOf(new ViewerController());
    const firstId = first.nextRendererId();
    const secondId = second.nextRendererId();
    const renderFirst = () => "first";
    const renderSecond = () => "second";
    first.setRenderer(firstId, renderFirst);
    second.setRenderer(secondId, renderSecond);
    first.removeRenderer(firstId);
    second.setRenderer(firstId, renderFirst);
    assert.deepEqual(
      second.getRenderers().map((entry) => entry.render(0)),
      ["second", "first"],
    );
    second.removeRenderer(firstId);
    assert.equal(second.getRenderers()[0]?.render(0), "second");
  });

  it("allocates .parapdf-overlay-layer lazily and coordinates multiple portal claims across window shifts", () =>
    withBrowserGlobals(() => {
      const viewer = new ViewerController();
      const store = overlayStoreOf(viewer);
      const host0 = document.createElement("section");

      // Attaching a page host with no overlays allocates no .parapdf-overlay-layer child.
      const detachHost0 = store.attachHost(0, host0, 0, 612, 792, false);
      assert.equal((host0 as unknown as { children: unknown[] }).children.length, 0);
      assert.equal(store.portalLayer(0), null);

      // Claiming two <PdfPageOverlay page={0}> portals creates and shares one layer.
      let portalNotifications = 0;
      const unsubPortal = store.subscribePortal(0, () => portalNotifications++);
      const releaseA = store.claimPortal(0);
      const layer0 = store.portalLayer(0);
      assert.ok(layer0);
      assert.equal((host0 as unknown as { children: unknown[] }).children.length, 1);
      assert.equal(layer0.style.width, "612px");
      assert.equal(layer0.style.height, "792px");
      assert.equal(layer0.dataset.mainRotation, "0");

      const releaseB = store.claimPortal(0);
      assert.equal(store.portalLayer(0), layer0);
      assert.ok(portalNotifications >= 2);

      // Rotating 90deg swaps the overlay layer's unturned CSS width and height.
      store.syncHostGeometry(0, 90, 792, 612, false);
      assert.equal(layer0.dataset.mainRotation, "90");
      assert.equal(layer0.style.width, "612px");
      assert.equal(layer0.style.height, "792px");

      // Releasing the first portal keeps the shared layer until the second releases.
      releaseA();
      assert.equal(store.portalLayer(0), layer0);
      assert.equal((host0 as unknown as { children: unknown[] }).children.length, 1);

      releaseB();
      assert.equal(store.portalLayer(0), null);
      assert.equal((host0 as unknown as { children: unknown[] }).children.length, 0);

      // Claiming for an offscreen page (page 3) waits cleanly until page 3 mounts, then detaches on unmount.
      let page3Events = 0;
      const unsubPage3 = store.subscribePortal(3, () => page3Events++);
      const releasePage3 = store.claimPortal(3);
      assert.equal(store.portalLayer(3), null);

      const host3 = document.createElement("section");
      const detachHost3 = store.attachHost(3, host3, 0, 612, 792, false);
      assert.ok(store.portalLayer(3));
      assert.equal(page3Events, 1);

      detachHost3();
      assert.equal(store.portalLayer(3), null);
      assert.equal(page3Events, 2);

      releasePage3();
      unsubPage3();
      unsubPortal();
      detachHost0();
    }));

  it("keeps getRenderers reference stable when render function identity does not change", () => {
    const viewer = new ViewerController();
    const store = overlayStoreOf(viewer);
    let updates = 0;
    const unsub = store.subscribeRenderers(() => updates++);
    const renderFn = (i: number) => (i === 0 ? "hit" : null);

    store.setRenderer("r1", renderFn);
    const firstSnapshot = store.getRenderers();
    assert.equal(firstSnapshot.length, 1);
    assert.equal(updates, 1);

    // Re-registering the same render callback is a no-op, preserving memo(PdfPage) bailouts.
    store.setRenderer("r1", renderFn);
    assert.equal(store.getRenderers(), firstSnapshot);
    assert.equal(updates, 1);

    store.removeRenderer("r1");
    assert.equal(store.getRenderers().length, 0);
    assert.equal(updates, 2);
    unsub();
  });

  it("tracks per-page portalPages and allPages activity without redundant notifications", () => {
    const viewer = new ViewerController();
    const store = overlayStoreOf(viewer);
    const snapshots: { allPages: boolean; portals: number[] }[] = [];
    const unsub = store.subscribeActive(() => {
      const activity = store.getActivity();
      snapshots.push({ allPages: activity.allPages, portals: [...activity.portalPages] });
    });

    assert.equal(store.isActive(), false);
    assert.equal(store.getActivity().allPages, false);
    assert.equal(store.getActivity().portalPages.size, 0);
    assert.equal(store.hasHost(0), false);

    // First portal claim on page 0 activates only page 0; a second claim on page 0 does not re-notify.
    const release0A = store.claimPortal(0);
    const release0B = store.claimPortal(0);
    assert.equal(store.isActive(), true);
    assert.deepEqual(snapshots, [{ allPages: false, portals: [0] }]);

    // Claiming page 1 adds page 1 to portalPages.
    const release1 = store.claimPortal(1);
    assert.deepEqual(snapshots, [
      { allPages: false, portals: [0] },
      { allPages: false, portals: [0, 1] },
    ]);

    // Adding a dynamic renderer sets allPages: true; replacing its callback keeps the same activity snapshot.
    store.setRenderer("r1", () => "badge-a");
    const activeAll = store.getActivity();
    store.setRenderer("r1", () => "badge-b");
    assert.equal(store.getActivity(), activeAll);
    assert.deepEqual(snapshots, [
      { allPages: false, portals: [0] },
      { allPages: false, portals: [0, 1] },
      { allPages: true, portals: [0, 1] },
    ]);

    // Releasing one of two claims on page 0 leaves page 0 claimed without notifying; releasing the second drops page 0.
    release0A();
    assert.equal(snapshots.length, 3);
    release0B();
    release1();
    assert.deepEqual(snapshots.at(-1), { allPages: true, portals: [] });

    // Removing the last renderer restores the inactive singleton.
    store.removeRenderer("r1");
    assert.equal(store.isActive(), false);
    assert.deepEqual(snapshots.at(-1), { allPages: false, portals: [] });

    unsub();
  });

  it("renders PdfPageOverlay and PdfPageOverlays cleanly on SSR without touching DOM", () => {
    const viewer = new ViewerController();
    const ssrHtml = renderToString(
      createElement(
        SessionContext,
        { value: new PdfSessionController({ url: "/manual.pdf" }) },
        createElement(
          ViewerContext,
          { value: viewer },
          createElement(PdfPageOverlay, { page: 0 }, createElement("span", null, "p0")),
          createElement(PdfPageOverlays, {
            // biome-ignore lint/correctness/noChildrenProp: function-as-child render prop under createElement without JSX.
            children: () => createElement("span", null, "x"),
          }),
        ),
      ),
    );
    assert.equal(ssrHtml, "");
  });
});

describe("SelectionAnchor, sameSelection, and computePopoverPosition", () => {
  it("tracks scroll, scale, and rotation live in selection.anchor.getBoundingClientRect()", () =>
    withBrowserGlobals(() => {
      const viewer = new ViewerController();
      const { scroller, content, sections } = fakeScrollerAndContent(800, 600, 20, 40);
      const detach = viewer.attachViewport(scroller, content);

      const layout = computeLayout([LETTER, LETTER], 1, {
        gap: 12,
        rotation: 0,
        spread: "none",
        scrollMode: "vertical",
        direction: "ltr",
        viewportWidth: 800,
        page: 0,
      });
      viewer.store.set({ layout, scale: 1, rotation: 0 });

      const anchor = createSelectionAnchor(viewer, [
        { pageIndex: 0, rects: [{ x: 72, y: 100, width: 200, height: 20 }] },
      ]);

      // Fallback path via scroller + layout geometry:
      const box1 = anchor.getBoundingClientRect();
      const pageLeft0 = 20 + Math.max(12, (800 - 612) / 2);
      assert.equal(box1.left, pageLeft0 + 72);
      assert.equal(box1.top, 40 + 12 + 100);
      assert.equal(box1.width, 200);
      assert.equal(box1.height, 20);

      // Scrolling scroller down by 60px shifts anchor.top up by 60px without recreating the selection!
      scroller.scrollTop = 60;
      const boxScrolled = anchor.getBoundingClientRect();
      assert.equal(boxScrolled.top, box1.top - 60);

      // Live mounted section box (e.g., rotated 90deg) maps accurately:
      const layout90 = computeLayout([LETTER], 1, {
        gap: 12,
        rotation: 90,
        spread: "none",
        scrollMode: "vertical",
        direction: "ltr",
        viewportWidth: 800,
        page: 0,
      });
      viewer.store.set({ layout: layout90, scale: 1, rotation: 90 });
      sections.set(0, {
        style: { visibility: "" },
        getBoundingClientRect: () =>
          ({ left: 30, top: 50, width: 792, height: 612, right: 822, bottom: 662 }) as DOMRect,
      } as unknown as HTMLElement);
      const box90 = anchor.getBoundingClientRect();
      const expected90 = turnBox({ x: 72, y: 100, width: 200, height: 20 }, LETTER, 90);
      assert.ok(Math.abs(box90.left - (30 + expected90.x)) < 1e-6);
      assert.ok(Math.abs(box90.top - (50 + expected90.y)) < 1e-6);
      assert.ok(Math.abs(box90.width - expected90.width) < 1e-6);
      assert.ok(Math.abs(box90.height - expected90.height) < 1e-6);

      detach();
    }));

  it("compares selections structurally without JSON serialization", () => {
    const dummyAnchor = { getBoundingClientRect: () => ({ width: 0, height: 0 }) as DOMRect };
    const base: PdfSelection = {
      text: "ParaPDF",
      pages: [{ pageIndex: 0, rects: [{ x: 10, y: 20, width: 50, height: 12 }] }],
      start: { pageIndex: 0, item: 1, offset: 0 },
      end: { pageIndex: 0, item: 1, offset: 7 },
      anchor: dummyAnchor,
    };
    assert.equal(sameSelection(base, { ...base, anchor: { ...dummyAnchor } }), true);
    assert.equal(
      sameSelection(base, {
        ...base,
        pages: [{ pageIndex: 0, rects: [{ x: 10.0002, y: 20, width: 50, height: 12 }] }],
      }),
      true,
    );
    assert.equal(sameSelection(base, { ...base, text: "Other" }), false);
    assert.equal(sameSelection(base, null), false);
  });

  it("positions, clamps, flips, and hides selection popovers accurately", () => {
    const viewportBox = { left: 0, top: 50, right: 800, bottom: 650, width: 800, height: 600 };

    // Standard "top" placement centered horizontally above selection:
    const centered = computePopoverPosition({
      anchorBox: { left: 300, top: 200, right: 500, bottom: 220, width: 200, height: 20 },
      viewportBox,
      windowWidth: 1024,
      windowHeight: 768,
      popoverWidth: 120,
      popoverHeight: 36,
      placement: "top",
      offset: 8,
    });
    assert.deepEqual(centered, { x: 340, y: 156, side: "top" });

    // Near top edge of viewport: flips automatically to "bottom":
    const flipped = computePopoverPosition({
      anchorBox: { left: 300, top: 60, right: 500, bottom: 80, width: 200, height: 20 },
      viewportBox,
      windowWidth: 1024,
      windowHeight: 768,
      popoverWidth: 120,
      popoverHeight: 36,
      placement: "top",
      offset: 8,
    });
    assert.deepEqual(flipped, { x: 340, y: 88, side: "bottom" });

    // Selection scrolled completely above viewport: returns null to hide popover:
    const offscreen = computePopoverPosition({
      anchorBox: { left: 300, top: 10, right: 500, bottom: 40, width: 200, height: 30 },
      viewportBox,
      windowWidth: 1024,
      windowHeight: 768,
      popoverWidth: 120,
      popoverHeight: 36,
      placement: "top",
      offset: 8,
    });
    assert.equal(offscreen, null);
  });
});

function ServerPreloader() {
  preloadDocument("/guide.pdf#page=3");
  return createElement("div", null, "ready");
}

describe("preloadDocument", () => {
  it("emits link rel=preload during server prerender without opening a browser session", async () => {
    const { prelude } = await prerender(createElement(ServerPreloader));
    const html = await new Response(prelude).text();
    assert.match(
      html,
      /<link rel="preload" href="\/guide\.pdf" as="fetch" crossorigin="(anonymous|)"\/>/,
    );
  });

  it("warms the shared registry session ahead of <PdfDocument> mount with a single getDocument call", () =>
    withBrowserGlobals(async () => {
      let opened = 0;
      let warmedPdfjs = 0;
      const { loader } = fakePdfjs(async () => {
        opened++;
        return fakeDocument({ pages: [LETTER, LETTER, LETTER, LETTER] }).proxy;
      });

      // Route-hover preload with a URL fragment strips the fragment and opens once in the registry.
      preloadDocumentWith("/preloaded.pdf#page=2", loader, () => {
        warmedPdfjs++;
      });
      assert.equal(warmedPdfjs, 1);
      await settle();
      assert.equal(opened, 1);

      // Mounting a PdfSession for the same URL joins the already-ready SharedSession immediately!
      const session = new PdfSessionController({ url: "/preloaded.pdf#page=4" }, { pdfjs: loader });
      session.start();
      assert.equal(session.state.status, "ready");
      assert.equal(session.state.pageCount, 4);
      const disconnect = session.connect();
      assert.equal(opened, 1);

      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 1050));
    }));
});
