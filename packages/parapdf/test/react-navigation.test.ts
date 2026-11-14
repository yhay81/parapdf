import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { ThumbnailRenderer } from "../src/features/thumbnails/renderer.ts";
import type { Rotation } from "../src/pdfjs/draw.ts";
import { SessionContext, ViewerContext } from "../src/react/context.ts";
import { OutlineTree, outlineItemStyle, PdfOutline } from "../src/react/outline.ts";
import {
  computeThumbnailOffsets,
  computeThumbnailRange,
  createPageLabelsStore,
  findThumbnailScroller,
  scrollOffsetForThumbnail,
  thumbnailCanvasHeight,
} from "../src/react/thumbnails.ts";
import { computeLayout } from "../src/view/layout.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

describe("thumbnailCanvasHeight", () => {
  it("publishes viewer.store.sizes only on open, non-uniform size updates, and close, ignoring scroll and zoom commits", () => {
    const viewer = new ViewerController();
    let notifications = 0;
    const unsub = viewer.store.sizes.subscribe(() => notifications++);
    assert.equal(viewer.store.sizes.get().sizes, undefined);

    const uniformSizes = [LETTER, LETTER, LETTER];
    const layoutAt1 = computeLayout(uniformSizes, 1, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 0,
    });
    viewer.store.set({ layout: layoutAt1, scale: 1, first: 0, last: 1 });
    assert.equal(notifications, 1);
    assert.equal(viewer.store.sizes.get().sizes, uniformSizes);

    // Scroll window shifts, currentPage flips, zoom commits sharing `uniformSizes`, and cold tool/rotation updates must not notify sizes subscribers:
    viewer.store.set({ first: 1, last: 2, currentPage: 1 });
    const layoutAt2 = computeLayout(uniformSizes, 2, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 1,
    });
    viewer.store.set({ layout: layoutAt2, scale: 2 });
    viewer.store.set({ rotation: 90, tool: "hand" });
    assert.equal(notifications, 1);

    // Background measurement discovering mixed page sizes publishes once:
    const mixedSizes = [LETTER, { width: 792, height: 612 }, LETTER];
    const mixedLayout = computeLayout(mixedSizes, 2, {
      gap: 12,
      rotation: 90,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 1,
    });
    viewer.store.set({ layout: mixedLayout });
    assert.equal(notifications, 2);
    assert.equal(viewer.store.sizes.get().sizes, mixedSizes);

    // Closing the document clears sizes once:
    viewer.store.set({ layout: null, first: 0, last: -1 });
    assert.equal(notifications, 3);
    assert.equal(viewer.store.sizes.get().sizes, undefined);

    unsub();
  });

  it("falls back to US Letter aspect ratio until the page size is known", () => {
    const height = thumbnailCanvasHeight(undefined, 0, 120);
    assert.ok(Math.abs(height - (120 * 11) / 8.5) < 1e-9);
  });

  it("swaps width and height on quarter turns", () => {
    assert.ok(Math.abs(thumbnailCanvasHeight(LETTER, 0, 120) - (120 * 792) / 612) < 1e-9);
    assert.ok(Math.abs(thumbnailCanvasHeight(LETTER, 90, 120) - (120 * 612) / 792) < 1e-9);
    assert.ok(Math.abs(thumbnailCanvasHeight(LETTER, 180, 120) - (120 * 792) / 612) < 1e-9);
    assert.ok(Math.abs(thumbnailCanvasHeight(LETTER, 270, 120) - (120 * 612) / 792) < 1e-9);
  });
});

describe("computeThumbnailOffsets and computeThumbnailRange", () => {
  it("mounts only the visible window plus overscan on 1,000 pages and preserves exact totalHeight", () => {
    const sizes = Array.from({ length: 1000 }, (_, i) =>
      i % 3 === 0 ? { width: 792, height: 612 } : LETTER,
    );
    const layout = computeThumbnailOffsets(1000, sizes, 0, 120, 32, 4);
    assert.equal(layout.offsets.length, 1001);
    assert.ok(layout.totalHeight > 150_000);

    for (const scrollTop of [0, 5_000, 75_000, layout.totalHeight - 600]) {
      const range = computeThumbnailRange(layout, 1000, scrollTop, 600, 6);
      const mountedCount = range.last - range.first + 1;
      assert.ok(mountedCount > 0 && mountedCount <= 22, `mounted ${mountedCount} at ${scrollTop}`);

      // Verify exact telescoping: topSpacer + mounted content (including internal gaps) + bottomSpacer === totalHeight
      const mountedContentHeight =
        (layout.offsets[range.last + 1] ?? 0) -
        (range.last < 999 ? layout.rowGap : 0) -
        (layout.offsets[range.first] ?? 0);
      assert.ok(
        Math.abs(range.topSpacer + mountedContentHeight + range.bottomSpacer - layout.totalHeight) <
          1e-6,
      );
    }
  });

  it("handles empty documents and custom measured item heights", () => {
    const empty = computeThumbnailOffsets(0, undefined, 0, 120);
    assert.deepEqual(computeThumbnailRange(empty, 0, 0, 600), {
      first: 0,
      last: -1,
      topSpacer: 0,
      bottomSpacer: 0,
    });

    const measured = new Map<number, number>([
      [0, 240],
      [1, 310],
    ]);
    const layout = computeThumbnailOffsets(3, [LETTER, LETTER, LETTER], 0, 120, 30, 6, measured);
    assert.equal(layout.offsets[0], 0);
    assert.equal(layout.offsets[1], 246);
    assert.equal(layout.offsets[2], 246 + 310 + 6);
  });
});

describe("scrollOffsetForThumbnail", () => {
  it("scrolls above or below items into view (block: nearest) and leaves visible items untouched", () => {
    const sizes = Array.from({ length: 100 }, () => ({ width: 100, height: 100 }));
    // Each item: canvas 120px + extra 30px = 150px, rowGap = 10px => 160px stride
    const layout = computeThumbnailOffsets(100, sizes, 0, 120, 30, 10);
    const listStart = 40;

    // Item 0 sits at [40, 190]; when scrollTop = 0 and viewport = 500, it is already visible
    assert.equal(scrollOffsetForThumbnail(layout, 100, 0, listStart, 0, 500), null);

    // Item 50 sits at [40 + 50 * 160, 40 + 50 * 160 + 150] = [8040, 8190]
    // Scrolling down from 0 aligns itemBottom with viewport bottom: 8190 - 500 = 7690
    assert.equal(scrollOffsetForThumbnail(layout, 100, 50, listStart, 0, 500), 7690);

    // Scrolling up from 9000 aligns itemTop with viewport top: 8040
    assert.equal(scrollOffsetForThumbnail(layout, 100, 50, listStart, 9000, 500), 8040);
  });
});

describe("findThumbnailScroller", () => {
  it("returns nav itself when scrollable, or else its scrollable ancestor", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
    const styles = new WeakMap<Element, string>();
    Object.assign(globalThis, {
      getComputedStyle: (el: Element) => ({ overflowY: styles.get(el) ?? "visible" }),
    });
    try {
      const ancestor = { parentElement: null } as unknown as HTMLElement;
      const nav = { parentElement: ancestor } as unknown as HTMLElement;
      styles.set(nav, "auto");
      assert.equal(findThumbnailScroller(nav), nav);

      styles.set(nav, "visible");
      styles.set(ancestor, "scroll");
      assert.equal(findThumbnailScroller(nav), ancestor);

      styles.set(ancestor, "visible");
      assert.equal(findThumbnailScroller(nav), null);
    } finally {
      if (saved) Object.defineProperty(globalThis, "getComputedStyle", saved);
      else Reflect.deleteProperty(globalThis, "getComputedStyle");
    }
  });
});

describe("createPageLabelsStore", () => {
  it("keeps numeric labels when reading the PDF's labels fails", async () => {
    const doc = fakeDocument({
      pages: [LETTER],
      proxy: {
        getPageLabels: async () => {
          throw new Error("Unreadable page labels");
        },
      },
    });
    const { loader: pdfjs } = fakePdfjs(async () => doc.proxy);
    const session = new PdfSessionController(
      { url: "https://example.test/broken-labels.pdf" },
      { pdfjs },
    );
    const viewer = new ViewerController();
    const releaseSession = session.connect();
    const releaseViewer = viewer.hold();
    viewer.open(session);
    const store = createPageLabelsStore(viewer, null);
    const unsubscribe = store.subscribe(() => {});
    try {
      await settle();
      await settle();
      assert.equal(store.get(), null);
    } finally {
      unsubscribe();
      releaseViewer();
      releaseSession();
    }
  });

  it("resolves pageLabels asynchronously without suspending and resets when closed", async () => {
    const doc = fakeDocument({
      pages: [LETTER, LETTER, LETTER],
      proxy: {
        getPageLabels: async () => ["i", "ii", "1"],
      },
    });
    const { loader: pdfjs } = fakePdfjs(async () => doc.proxy);
    const session = new PdfSessionController({ url: "https://example.test/labels.pdf" }, { pdfjs });
    const viewer = new ViewerController();
    const releaseSession = session.connect();
    const releaseViewer = viewer.hold();
    viewer.open(session);

    const store = createPageLabelsStore(viewer, session);
    const seen: (readonly string[] | null)[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.get()));

    assert.equal(store.get(), null);
    await settle();
    await settle();
    assert.deepEqual(store.get(), ["i", "ii", "1"]);
    assert.ok(seen.some((entry) => entry?.[0] === "i"));

    releaseViewer();
    releaseSession();
    assert.equal(store.get(), null);
    unsubscribe();
  });

  it("exposes warm knownPageLabels synchronously on initial get() without a null flash", async () => {
    const doc = fakeDocument({
      pages: [LETTER, LETTER],
      proxy: {
        getPageLabels: async () => ["A-1", "A-2"],
      },
    });
    const { loader: pdfjs } = fakePdfjs(async () => doc.proxy);
    const session = new PdfSessionController(
      { url: "https://example.test/warm-labels.pdf" },
      { pdfjs },
    );
    const releaseSession = session.connect();
    await settle();
    const docSession = await session.document();
    await docSession.pageLabels();
    assert.deepEqual(docSession.knownPageLabels, ["A-1", "A-2"]);

    const viewer = new ViewerController();
    const releaseViewer = viewer.hold();
    viewer.open(session);

    const store = createPageLabelsStore(viewer, session);
    assert.deepEqual(store.get(), ["A-1", "A-2"]);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    assert.deepEqual(store.get(), ["A-1", "A-2"]);
    assert.equal(notifications, 0);

    unsubscribe();
    releaseViewer();
    releaseSession();
  });

  it("ignores download progress patches on pdfSession.stateStore", () => {
    const viewer = new ViewerController();
    let status: "loading" | "ready" = "loading";
    let stateReads = 0;
    const listeners = new Set<(changedKeys?: ReadonlySet<PropertyKey>) => void>();
    const fakeSession = {
      get state() {
        stateReads++;
        return { status };
      },
      openDocument: () => {
        stateReads++;
        return null;
      },
      stateStore: {
        get: () => ({ status }),
        subscribe(listener: (changedKeys?: ReadonlySet<PropertyKey>) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    } as unknown as PdfSessionController;

    const store = createPageLabelsStore(viewer, fakeSession);
    const unsub = store.subscribe(() => {});
    const afterStart = stateReads;
    for (const listener of listeners) listener(new Set(["progress"]));
    assert.equal(stateReads, afterStart);

    status = "ready";
    for (const listener of listeners) listener(new Set(["status"]));
    assert.ok(stateReads > afterStart);
    unsub();
  });
});

describe("ThumbnailRenderer virtualized mode and kept canvases", () => {
  it("skips getComputedStyle and IntersectionObserver, restores kept canvases on scroll-back without re-enqueuing, evicts LRU, and zeroes on reset", async () => {
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const savedComputed = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
    const savedIO = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    Object.assign(globalThis, {
      window: { devicePixelRatio: 1 },
      getComputedStyle: () => {
        throw new Error("virtualized thumbnails must not call getComputedStyle");
      },
      IntersectionObserver: class {
        constructor() {
          throw new Error("virtualized thumbnails must not construct IntersectionObserver");
        }
      },
    });

    try {
      let rotation: Rotation = 0;
      const enqueued: number[] = [];
      const makeCanvas = (label: string) => {
        let drawnFrom: string | null = null;
        const canvas = {
          label,
          width: 0,
          height: 0,
          get drawnFrom() {
            return drawnFrom;
          },
          getContext: () => ({
            drawImage(source: { label: string }) {
              drawnFrom = source.label;
            },
          }),
        };
        return canvas as unknown as HTMLCanvasElement & {
          readonly label: string;
          readonly drawnFrom: string | null;
        };
      };

      // Each 100x100 page drawn at width=100 holds 10,000 pixels; budget=20,000 holds at most 2 kept thumbnails.
      const renderer = new ThumbnailRenderer({
        renderer: () =>
          ({
            copyPage: () => false,
            enqueue: (pageIndex: number, _request: unknown, done: (err: Error | null) => void) => {
              enqueued.push(pageIndex);
              done(null);
              return null;
            },
          }) as never,
        pageSize: () => ({ width: 100, height: 100 }),
        rotation: () => rotation,
        layers: () => null,
        maxKeptPixels: 20_000,
      });

      const c0 = makeCanvas("c0");
      const c1 = makeCanvas("c1");
      const c2 = makeCanvas("c2");
      const stop0 = renderer.attach(0, c0, 100, { virtualized: true });
      const stop1 = renderer.attach(1, c1, 100, { virtualized: true });
      const stop2 = renderer.attach(2, c2, 100, { virtualized: true });
      assert.deepEqual(enqueued, [0, 1, 2]);
      assert.equal(c0.width, 100);

      // Unmounting all 3 keeps c0, c1, c2 initially, then microtask trims oldest (page 0) to stay <= 20,000 pixels.
      stop0();
      stop1();
      stop2();
      await Promise.resolve();
      assert.equal(renderer.keptPixels, 20_000);
      assert.equal(c0.width, 0);
      assert.equal(c1.width, 100);
      assert.equal(c2.width, 100);

      // Scrolling back to page 1 restores synchronously from c1 without calling renderer.enqueue, and frees c1!
      const c1Back = makeCanvas("c1-back");
      const stop1Back = renderer.attach(1, c1Back, 100, { virtualized: true });
      assert.deepEqual(enqueued, [0, 1, 2]);
      assert.equal(c1Back.width, 100);
      assert.equal(c1Back.drawnFrom, "c1");
      assert.equal(c1.width, 0);
      assert.equal(renderer.keptPixels, 10_000);

      // Rotating invalidates page 2's kept canvas on next attach and enqueues a fresh rotated render.
      rotation = 90;
      const c2Rotated = makeCanvas("c2-rot");
      const stop2Rotated = renderer.attach(2, c2Rotated, 100, { virtualized: true });
      assert.deepEqual(enqueued, [0, 1, 2, 2]);
      assert.equal(c2.width, 0);
      assert.equal(renderer.keptPixels, 0);

      // Unmounting c1Back and resetting zeroes both mounted and kept canvases immediately.
      stop1Back();
      assert.equal(renderer.keptPixels, 10_000);
      renderer.reset();
      assert.equal(renderer.keptPixels, 0);
      assert.equal(c1Back.width, 0);
      assert.equal(c2Rotated.width, 0);
      stop2Rotated();
    } finally {
      if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (savedComputed) Object.defineProperty(globalThis, "getComputedStyle", savedComputed);
      else Reflect.deleteProperty(globalThis, "getComputedStyle");
      if (savedIO) Object.defineProperty(globalThis, "IntersectionObserver", savedIO);
      else Reflect.deleteProperty(globalThis, "IntersectionObserver");
    }
  });
});

describe("viewer.externalLinks and PdfOutline", () => {
  it("tracks live externalLinks option updates on Viewer", () => {
    const viewer = new ViewerController();
    const store = viewer.externalLinksStore;
    let notifications = 0;
    const unsub = store.subscribe(() => notifications++);
    assert.equal(viewer.externalLinks, "new-tab");

    viewer.configure({ externalLinks: "disabled" });
    assert.equal(viewer.externalLinks, "disabled");
    assert.equal(store.get().externalLinks, "disabled");
    assert.equal(notifications, 1);

    viewer.configure({ externalLinks: "disabled" });
    assert.equal(notifications, 1);
    unsub();
  });

  it("computes bold and italic inline styles only when set", () => {
    assert.equal(outlineItemStyle({ bold: false, italic: false }), undefined);
    assert.deepEqual(outlineItemStyle({ bold: true, italic: false }), { fontWeight: 600 });
    assert.deepEqual(outlineItemStyle({ bold: true, italic: true }), {
      fontWeight: 600,
      fontStyle: "italic",
    });
  });

  it("renders nested bookmarks, honors externalLinks, supports renderItem, and bails out cleanly on SSR", async () => {
    // 1. Prerendering <PdfOutline> on the server renders its Suspense fallback via browser() bailout
    const errors: unknown[] = [];
    const bailouts: unknown[] = [];
    const { prelude } = await prerender(
      createElement(
        SessionContext,
        { value: new PdfSessionController({ url: "https://example.test/outline.pdf" }) },
        createElement(
          ViewerContext,
          { value: new ViewerController() },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading outline") },
            createElement(PdfOutline),
          ),
        ),
      ),
      {
        onError: (error) => void errors.push(error),
        onBrowserBailout: (error) => void bailouts.push(error),
      },
    );
    const ssrHtml = await new Response(prelude).text();
    assert.ok(ssrHtml.includes("Loading outline"));
    assert.deepEqual(errors, []);
    assert.equal(bailouts.length, 1);

    // 2. OutlineTree with nested internal, disabled, bold/italic, and external entries
    const items = [
      {
        title: "1 Introduction",
        dest: "intro",
        url: null,
        bold: true,
        italic: false,
        items: [
          {
            title: "1.1 Scope",
            dest: null,
            url: null,
            bold: false,
            italic: true,
            items: [],
          },
        ],
      },
      {
        title: "Spec website",
        dest: null,
        url: "https://example.org/spec",
        bold: false,
        italic: false,
        items: [],
      },
    ];
    const viewer = new ViewerController();
    const htmlNewTab = renderToString(
      createElement(
        ViewerContext,
        { value: viewer },
        createElement(OutlineTree, { id: "toc", items }),
      ),
    );
    assert.ok(htmlNewTab.includes('id="toc"'));
    assert.ok(htmlNewTab.includes('aria-label="Document outline"'));
    assert.ok(htmlNewTab.includes("font-weight:600"));
    assert.ok(htmlNewTab.includes("font-style:italic"));
    assert.ok(htmlNewTab.includes('disabled=""'));
    assert.ok(htmlNewTab.includes('href="https://example.org/spec"'));
    assert.ok(htmlNewTab.includes('target="_blank"'));
    assert.ok(htmlNewTab.includes('rel="noopener noreferrer nofollow"'));

    // With externalLinks="disabled", external URLs render inert without href
    viewer.configure({ externalLinks: "disabled" });
    const htmlDisabled = renderToString(
      createElement(ViewerContext, { value: viewer }, createElement(OutlineTree, { items })),
    );
    assert.ok(!htmlDisabled.includes("https://example.org/spec"));
    assert.ok(htmlDisabled.includes('aria-disabled="true"'));

    const defaultCollapsed = renderToString(
      createElement(OutlineTree, { items, viewer, defaultExpanded: false }),
    );
    assert.ok(defaultCollapsed.includes('aria-expanded="false"'));
    assert.ok(defaultCollapsed.includes('aria-label="Expand 1 Introduction"'));
    assert.ok(!defaultCollapsed.includes("1.1 Scope"));

    // defaultExpanded={false} omits collapsed child branches; custom renderItem receives depth & helpers
    const htmlCollapsed = renderToString(
      createElement(
        ViewerContext,
        { value: viewer },
        createElement(OutlineTree, {
          items,
          defaultExpanded: false,
          renderItem: (_item, { depth, hasChildren, link, children }) =>
            createElement(
              "div",
              { "data-depth": depth, "data-branch": String(hasChildren) },
              link,
              children,
            ),
        }),
      ),
    );
    assert.ok(htmlCollapsed.includes('data-depth="0"'));
    assert.ok(htmlCollapsed.includes('data-branch="true"'));
    assert.ok(!htmlCollapsed.includes("1.1 Scope"));

    // activate() jumps through viewer.goToDestination (or onNavigate)
    const navigated: string[] = [];
    renderToString(
      createElement(
        ViewerContext,
        { value: viewer },
        createElement(OutlineTree, {
          items,
          onNavigate: (node) => {
            navigated.push(node.title);
            return true;
          },
          renderItem: (item, { activate, link }) => {
            if (item.dest) void activate();
            return link;
          },
        }),
      ),
    );
    assert.deepEqual(navigated, ["1 Introduction"]);
  });

  it("renders nothing when the document has an empty outline", () => {
    const html = renderToString(
      createElement(
        ViewerContext,
        { value: new ViewerController() },
        createElement(OutlineTree, { items: [] }),
      ),
    );
    assert.equal(html, "");
  });
});
