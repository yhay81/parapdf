import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { Store, subscribeKeys } from "../src/document/store.ts";
import { computeLayout } from "../src/view/layout.ts";
import { sameViewState, toShownView, type ViewState } from "../src/view/view-state.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

describe("Store and subscribeKeys", () => {
  it("publishes exact changedKeys across single set, multi-step update/publish, and re-entrant listeners", () => {
    const store = new Store({ currentPage: 0, rotation: 0, search: () => {} });
    const batches: string[][] = [];
    const unsub = store.subscribe((changedKeys) => {
      batches.push([...(changedKeys ?? [])].map(String));
    });

    // Unchanged value emits nothing.
    store.set({ currentPage: 0 });
    assert.equal(batches.length, 0);

    // Hot update emits only currentPage, never rotation or search.
    store.set({ currentPage: 3, rotation: 0 });
    assert.deepEqual(batches, [["currentPage"]]);

    // Multiple update() calls before publish() accumulate all changed keys.
    assert.equal(store.update({ currentPage: 4 }), true);
    assert.equal(store.update({ rotation: 90 }), true);
    store.publish();
    assert.deepEqual(batches, [["currentPage"], ["currentPage", "rotation"]]);

    unsub();

    // Re-entrant store.set() inside a listener keeps outer and inner changedKeys isolated.
    const seen: { listener: number; keys: string[] }[] = [];
    const u1 = store.subscribe((changedKeys) => {
      seen.push({ listener: 1, keys: [...(changedKeys ?? [])].map(String) });
      if (store.get().currentPage === 7 && store.get().rotation !== 180) {
        store.set({ rotation: 180 });
      }
    });
    const u2 = store.subscribe((changedKeys) => {
      seen.push({ listener: 2, keys: [...(changedKeys ?? [])].map(String) });
    });
    store.set({ currentPage: 7 });
    assert.deepEqual(seen, [
      { listener: 1, keys: ["currentPage"] },
      { listener: 1, keys: ["rotation"] },
      { listener: 2, keys: ["rotation"] },
      { listener: 2, keys: ["currentPage"] },
    ]);
    u1();
    u2();
  });

  it("subscribeKeys ignores unrelated keys while firing on matching or unkeyed publishes", () => {
    const store = new Store({
      status: "loading",
      passwordReason: null as "need" | "incorrect" | null,
      progress: null as { loaded: number; total: number | null } | null,
    });
    let calls = 0;
    const unsub = subscribeKeys(store, ["status", "passwordReason"], () => {
      calls++;
    });

    store.set({ progress: { loaded: 1024, total: 8192 } });
    store.set({ progress: { loaded: 4096, total: 8192 } });
    assert.equal(calls, 0);

    store.set({ status: "password", passwordReason: "need" });
    assert.equal(calls, 1);

    // Unkeyed publish() always wakes subscribeKeys.
    store.publish();
    assert.equal(calls, 2);

    unsub();
  });

  it("coalesces multi-step Store.batch and ViewerStore.batch updates, keeping optional fields and pruning reverted keys", () => {
    const store = new Store({ page: 0, scale: 1, tool: "select" as "select" | "hand" });
    const baseSnapshot = store.get();
    const batches: string[][] = [];
    const unsub = store.subscribe((changedKeys) => {
      batches.push([...(changedKeys ?? [])].map(String));
    });

    // Reverting every touched key inside a batch emits zero notifications and restores the original snapshot reference.
    store.batch(() => {
      store.set({ page: 3, scale: 2 });
      store.batch(() => {
        store.set({ page: 0, scale: 1 });
      });
    });
    assert.equal(batches.length, 0);
    assert.equal(store.get(), baseSnapshot);

    // Multi-step mutations across nested batches publish once with only net changed keys.
    store.batch(() => {
      store.set({ page: 1, tool: "hand" });
      store.batch(() => {
        store.set({ page: 4, scale: 1.5 });
        store.set({ tool: "select" });
      });
    });
    assert.deepEqual(batches, [["page", "scale"]]);
    assert.deepEqual(store.get(), { page: 4, scale: 1.5, tool: "select" });
    unsub();

    // Optional fields introduced in a batch stay present and prune cleanly when reverted.
    const optional = new Store<{ status: string; error?: string | undefined }>({ status: "idle" });
    const optionalBatches: string[][] = [];
    optional.subscribe((keys) => optionalBatches.push([...(keys ?? [])].map(String)));
    optional.batch(() => optional.set({ error: "Failed to open" }));
    assert.deepEqual(optional.get(), { status: "idle", error: "Failed to open" });
    assert.deepEqual(optionalBatches, [["error"]]);
    const beforeOptional = optional.get();
    optional.batch(() => {
      optional.set({ error: undefined });
      optional.set({ error: "Failed to open" });
    });
    assert.equal(optional.get(), beforeOptional);
    assert.equal(optionalBatches.length, 1);

    const empty = new Store<{ error?: string | undefined }>({});
    const initialEmpty = empty.get();
    let emptyNotifications = 0;
    empty.subscribe(() => emptyNotifications++);
    empty.batch(() => {
      empty.set({ error: "Temporary" });
      empty.set({ error: undefined });
    });
    assert.equal(empty.get(), initialEmpty);
    assert.equal(emptyNotifications, 0);

    // ViewerStore tracks net "sizes" and "externalLinks" changes across batch boundaries.
    const viewer = new ViewerController();
    const viewerBatches: string[][] = [];
    const unsubViewer = viewer.store.subscribe((changedKeys) => {
      viewerBatches.push([...(changedKeys ?? [])].map(String));
    });
    const sizes = [LETTER, LETTER];
    const layout = computeLayout(sizes, 1.5, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 0,
    });
    viewer.store.batch(() => {
      viewer.store.set({ layout, scale: 1 });
      viewer.store.setExternalLinks("disabled");
      viewer.store.setExternalLinks("new-tab");
    });
    assert.equal(viewerBatches.length, 1);
    assert.ok(viewerBatches[0]?.includes("sizes"));
    assert.equal(viewerBatches[0]?.includes("externalLinks"), false);

    // Reverting layout back to null and back to the same sizes in a batch does not re-emit "sizes".
    viewerBatches.length = 0;
    viewer.store.batch(() => {
      viewer.store.set({ layout: null });
      viewer.store.set({ layout, scale: 2 });
    });
    assert.equal(viewerBatches.length, 1);
    assert.deepEqual(viewerBatches[0], ["scale"]);
    unsubViewer();
  });
});

describe("ViewerStore", () => {
  it("notifies only key-matching subscribers, keeps view state separate from document state, and tracks externalLinks", () => {
    const viewer = new ViewerController();
    const { store } = viewer;
    assert.equal("status" in store.get(), false);
    assert.equal(viewer.externalLinks, "new-tab");

    let windowHits = 0;
    let currentHits = 0;
    let toolHits = 0;
    let rotationHits = 0;
    let sizesHits = 0;
    let externalLinksHits = 0;
    let all = 0;

    store.subscribeKeys(["layout", "first", "last"], () => windowHits++);
    store.subscribeKeys(["currentPage"], () => currentHits++);
    const unsubscribeTool = store.subscribeKeys(["tool"], () => toolHits++);
    store.subscribeKeys(["rotation"], () => rotationHits++);
    store.subscribeKeys(["sizes"], () => sizesHits++);
    store.subscribeKeys(["externalLinks"], () => externalLinksHits++);
    store.subscribe(() => all++);

    store.set({ currentPage: 5 });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [0, 1, 0, 0, 0, 0, 1],
    );

    store.set({ first: 2, last: 6 });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 0, 0, 0, 0, 2],
    );

    store.set({ tool: "hand" });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 0, 3],
    );

    // No-op patch allocates and notifies nothing.
    store.set({ currentPage: 5, tool: "hand" });
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 0, 3],
    );

    viewer.configure({ externalLinks: "disabled" });
    assert.equal(viewer.externalLinks, "disabled");
    assert.equal(store.externalLinks, "disabled");
    assert.deepEqual(
      [windowHits, currentHits, toolHits, rotationHits, sizesHits, externalLinksHits, all],
      [1, 1, 1, 0, 0, 1, 4],
    );

    // Re-configuring the same externalLinks emits nothing.
    viewer.configure({ externalLinks: "disabled" });
    assert.equal(externalLinksHits, 1);

    unsubscribeTool();
    store.set({ tool: "select" });
    assert.equal(toolHits, 1);
  });

  it("installs ViewerState, pageCount, and derived sizes atomically and publishes pageCount and sizes only when they change", () => {
    const { store } = new ViewerController();
    assert.equal(store.get().pageCount, 0);
    assert.equal(store.sizes, undefined);

    let layoutPublishes = 0;
    let pageCountPublishes = 0;
    let sizesPublishes = 0;
    store.subscribeKeys(["layout", "scale"], () => layoutPublishes++);
    store.subscribeKeys(["pageCount"], () => pageCountPublishes++);
    store.subscribeKeys(["sizes"], () => sizesPublishes++);

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

    // Verify atomic visibility of state, pageCount, and sizes during notification.
    const unsubAtomic = store.subscribeKeys(["sizes"], () => {
      assert.equal(store.get().scale, 1);
      assert.equal(store.get().pageCount, 3);
      assert.equal(store.sizes, uniformSizes);
    });
    store.set({ layout: layoutAt1, scale: 1, first: 0, last: 1 });
    unsubAtomic();

    assert.equal(layoutPublishes, 1);
    assert.equal(pageCountPublishes, 1);
    assert.equal(sizesPublishes, 1);

    // Scroll window shifts, zoom commits sharing uniformSizes, and cold updates keep pageCount and sizes quiet.
    store.set({ first: 1, last: 2, currentPage: 1 });
    const layoutAt2 = computeLayout(uniformSizes, 2, {
      gap: 12,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
      direction: "ltr",
      viewportWidth: 800,
      page: 1,
    });
    store.set({ layout: layoutAt2, scale: 2 });
    store.set({ rotation: 90, tool: "hand" });
    assert.equal(layoutPublishes, 2);
    assert.equal(pageCountPublishes, 1);
    assert.equal(sizesPublishes, 1);

    // Discovering non-uniform page sizes updates sizes without re-emitting pageCount.
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
    store.set({ layout: mixedLayout });
    assert.equal(store.sizes, mixedSizes);
    assert.equal(pageCountPublishes, 1);
    assert.equal(sizesPublishes, 2);

    // Closing resets layout to null, pageCount to 0, and sizes to undefined.
    store.set({ layout: null, first: 0, last: -1 });
    assert.equal(store.get().pageCount, 0);
    assert.equal(store.sizes, undefined);
    assert.equal(pageCountPublishes, 2);
    assert.equal(sizesPublishes, 3);
  });
});

describe("toShownView, sameViewState, and viewer.viewState()", () => {
  it("keeps valid fields in toShownView, rejects malformed URL input, and compares snapshots in sameViewState", () => {
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
    assert.deepEqual(toShownView({ scale: "auto" }), { scale: "auto" });
    assert.deepEqual(toShownView({ scale: "fit" as never }), {});

    const invalid = toShownView({
      page: "x",
      x: Number.NaN,
      scale: -1,
      rotation: Number.NaN,
      spread: "sideways",
      scrollMode: 3,
    } as never);
    assert.deepEqual(invalid, {});
    assert.deepEqual(toShownView({ page: 1, x: Number.POSITIVE_INFINITY }).target, {
      pageIndex: 1,
      x: null,
      y: null,
    });

    const base: ViewState = {
      page: 2,
      x: 10,
      y: 20,
      scale: 1.5,
      rotation: 90,
      spread: "odd",
      scrollMode: "vertical",
    };
    assert.equal(sameViewState(null, base), false);
    assert.equal(sameViewState({ ...base }, base), true);
    assert.equal(sameViewState({ ...base, y: 21 }, base), false);
  });

  it("reads null before layout and round-trips view state on an attached viewer", async () => {
    const names = ["window", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
    const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.assign(globalThis, {
      window: {
        devicePixelRatio: 1,
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    try {
      const doc = fakeDocument({ pages: [LETTER, LETTER, LETTER] });
      const viewer = new ViewerController();
      assert.equal(viewer.viewState(), null);

      const scroller = {
        clientWidth: 800,
        clientHeight: 600,
        scrollLeft: 0,
        scrollTop: 0,
        style: {} as Record<string, string>,
        classList: { toggle() {}, add() {}, remove() {} },
        ownerDocument: { activeElement: null },
        scrollTo({ left, top }: { left?: number; top?: number }) {
          if (left !== undefined) (this as { scrollLeft?: number }).scrollLeft = left;
          if (top !== undefined) (this as { scrollTop?: number }).scrollTop = top;
        },
        addEventListener() {},
        removeEventListener() {},
        focus() {},
      } as unknown as HTMLElement;
      const content = {
        style: {} as Record<string, string>,
        classList: { toggle() {}, add() {}, remove() {} },
        ownerDocument: { activeElement: null },
        addEventListener() {},
        removeEventListener() {},
      } as unknown as HTMLElement;
      const detach = viewer.attachViewport(scroller, content);
      const session = new PdfSessionController(
        { url: "/book.pdf" },
        { pdfjs: fakePdfjs(async () => doc.proxy).loader },
      );
      const release = session.connect();
      viewer.open(session);
      await settle();

      viewer.setViewState({
        page: 2,
        x: 0,
        y: 120,
        scale: 1.5,
        rotation: 90,
        spread: "odd",
        scrollMode: "vertical",
      });
      const snapshot = viewer.viewState();
      assert.ok(snapshot);
      assert.equal(snapshot.page, 2);
      assert.equal(snapshot.scale, 1.5);
      assert.equal(snapshot.rotation, 90);
      assert.equal(snapshot.spread, "odd");
      assert.equal(snapshot.scrollMode, "vertical");

      // Horizontal mode round-trips goToPage(1) to page === 1 across the inter-page gap.
      viewer.setScrollMode("horizontal");
      viewer.setSpread("none");
      viewer.setRotation(0);
      viewer.goToPage(1);
      const horizontalSnapshot = viewer.viewState();
      assert.ok(horizontalSnapshot);
      assert.equal(horizontalSnapshot.page, 1);
      assert.equal(horizontalSnapshot.scrollMode, "horizontal");

      release();
      detach();
    } finally {
      names.forEach((name, index) => {
        const descriptor = before[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });
});
