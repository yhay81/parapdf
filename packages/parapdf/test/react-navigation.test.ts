import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { connectSession, PdfSession } from "../src/document/pdf-session.ts";
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
import {
  externalLinksStoreOf,
  holdViewer,
  openViewer,
  setViewerOptions,
  Viewer,
} from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

describe("thumbnailCanvasHeight", () => {
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
    const session = new PdfSession({ url: "https://example.test/broken-labels.pdf" }, { pdfjs });
    const viewer = new Viewer();
    const releaseSession = connectSession(session);
    const releaseViewer = holdViewer(viewer);
    openViewer(viewer, session);
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
    const session = new PdfSession({ url: "https://example.test/labels.pdf" }, { pdfjs });
    const viewer = new Viewer();
    const releaseSession = connectSession(session);
    const releaseViewer = holdViewer(viewer);
    openViewer(viewer, session);

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
});

describe("viewer.externalLinks and PdfOutline", () => {
  it("tracks live externalLinks option updates on Viewer", () => {
    const viewer = new Viewer();
    const store = externalLinksStoreOf(viewer);
    let notifications = 0;
    const unsub = store.subscribe(() => notifications++);
    assert.equal(viewer.externalLinks, "new-tab");

    setViewerOptions(viewer, { externalLinks: "disabled" });
    assert.equal(viewer.externalLinks, "disabled");
    assert.equal(store.get().externalLinks, "disabled");
    assert.equal(notifications, 1);

    setViewerOptions(viewer, { externalLinks: "disabled" });
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
        { value: new PdfSession({ url: "https://example.test/outline.pdf" }) },
        createElement(
          ViewerContext,
          { value: new Viewer() },
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
    const viewer = new Viewer();
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
    setViewerOptions(viewer, { externalLinks: "disabled" });
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
        { value: new Viewer() },
        createElement(OutlineTree, { items: [] }),
      ),
    );
    assert.equal(html, "");
  });
});
