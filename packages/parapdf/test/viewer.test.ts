import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import type { Rotation } from "../src/pdfjs/draw.ts";
import type { ViewerOptions } from "../src/view/options.ts";
import { toShownView, type ViewState } from "../src/view/view-state.ts";
import { ViewerController, type Zoom } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, LETTER, settle, show } from "./fake-pdfjs.ts";

const A4 = { width: 595, height: 842 };

describe("closing and extending a viewer's document", () => {
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

  it("stops the viewer's work immediately, drops what it held, and closes the unheld session after the grace delay", async () => {
    const { loader } = fakePdfjs();
    const viewer = new ViewerController();
    const { session: pdfSession, close: closeDocument } = show(
      viewer,
      { url: "/files/a.pdf" },
      loader,
    );
    await settle();
    const session = viewer.session;
    const work = viewer.workSignal;
    assert.ok(session && viewer.permissions && viewer.renderer && viewer.layers && work);
    assert.ok(viewer.store.get().layout);
    assert.equal(viewer.pdfSession, pdfSession);

    closeDocument();
    assert.equal(work.aborted, true);
    assert.deepEqual(
      [
        viewer.session,
        viewer.permissions,
        viewer.renderer,
        viewer.layers,
        viewer.workSignal,
        viewer.pdfSession,
        viewer.store.get().layout,
      ],
      [null, null, null, null, null, null, null],
    );
    // The session stays a second for a viewer that comes back, then closes.
    assert.equal(session.signal.aborted, false);
    mock.timers.tick(1000);
    await settle();
    assert.equal(session.signal.aborted, true);
  });

  it("lays the pages out again once their sizes are known, unless the document closed", async () => {
    const pages = [LETTER, A4, LETTER];
    const open = fakePdfjs(async () => fakeDocument({ pages }).proxy);
    const viewer = new ViewerController();
    close.push(show(viewer, { url: "/a.pdf" }, open.loader).close);
    await settle();
    // Every page has the first one's size until the background pass knows better.
    assert.deepEqual(viewer.store.get().layout?.sizes, [LETTER, LETTER, LETTER]);
    mock.timers.tick(0);
    await settle();
    assert.deepEqual(viewer.store.get().layout?.sizes, pages);

    const closed = fakePdfjs(async () => fakeDocument({ pages }).proxy);
    const other = new ViewerController();
    const { close: closeOther } = show(other, { url: "/a.pdf" }, closed.loader);
    await settle();
    closeOther();
    let published = 0;
    other.store.subscribe(() => published++);
    mock.timers.tick(0);
    await settle();
    assert.equal(published, 0, "a closed viewer publishes nothing when the pass ends");
  });

  it("leaves the work and shared session of another viewer of the same document running", async () => {
    let read = () => {};
    const textsReady = new Promise<void>((resolve) => (read = resolve));
    const document = fakeDocument({
      pages: [LETTER, LETTER],
      texts: [[{ str: "hello" }], [{ str: "hello" }]],
      textsReady,
    });
    const { loader, calls } = fakePdfjs(async () => document.proxy);
    const first = new ViewerController();
    const second = new ViewerController();
    const { close: closeFirst } = show(first, { url: "/a.pdf" }, loader);
    const { close: closeSecond } = show(second, { url: "/a.pdf" }, loader);
    close.push(closeSecond);
    await settle();
    const session = second.session;
    const firstWork = first.workSignal;
    const secondWork = second.workSignal;
    assert.ok(session && firstWork && secondWork);
    assert.equal(first.session, session, "one session for both");
    const reading = session.text(0);
    closeFirst();
    assert.equal(firstWork.aborted, true);
    assert.equal(secondWork.aborted, false);
    read();
    assert.deepEqual((await reading).items, ["hello"]);
    mock.timers.tick(1000);
    await settle();
    assert.equal(session.signal.aborted, false, "the session stays open for the other viewer");
    assert.equal(calls.opens, 1);
  });

  it("closes the open document when it opens another", async () => {
    const { loader, calls } = fakePdfjs();
    const viewer = new ViewerController();
    const a = show(viewer, { url: "/a.pdf" }, loader);
    await settle();
    const first = viewer.session;
    close.push(show(viewer, { url: "/b.pdf" }, loader).close);
    // Its provider lets the first go too.
    a.close();
    await settle();
    const second = viewer.session;
    assert.ok(first && second && first !== second);
    mock.timers.tick(1000);
    await settle();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(calls.destroys, 1);
  });

  it("notifies viewer extensions once per load whether registered before, during, or after open", async () => {
    const counting = () => {
      const heard = { prepare: 0, ready: 0, closed: 0, aborted: 0 };
      return {
        heard,
        extension: {
          prepare: () => void heard.prepare++,
          ready: (_session: unknown, signal: AbortSignal) => {
            heard.ready++;
            signal.addEventListener("abort", () => heard.aborted++);
          },
          closed: () => {
            // The document's work stops after the features let go of it.
            assert.equal(heard.aborted, 0);
            heard.closed++;
          },
        },
      };
    };

    const viewer = new ViewerController();
    const early = counting();
    viewer.extend(early.extension);
    const { close: closeDocument } = show(viewer, { url: "/a.pdf" }, fakePdfjs().loader);
    const loading = counting();
    viewer.extend(loading.extension);
    await settle();
    const late = counting();
    const remove = viewer.extend(late.extension);
    for (const { heard } of [early, loading, late]) {
      assert.deepEqual(heard, { prepare: 1, ready: 1, closed: 0, aborted: 0 });
    }
    remove();
    closeDocument();
    assert.deepEqual(early.heard, { prepare: 1, ready: 1, closed: 1, aborted: 1 });
    assert.equal(late.heard.closed, 0, "a removed extension hears nothing more");
  });
});

describe("a viewer's viewport", () => {
  const globals = ["window", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
  const before = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const release: (() => void)[] = [];
  let resized: (() => void)[] = [];
  let frames: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    resized = [];
    frames = [];
    Object.assign(globalThis, {
      window: {
        devicePixelRatio: 1,
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: () => {},
      ResizeObserver: class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    });
  });

  afterEach(async () => {
    for (const done of release.splice(0)) done();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
    globals.forEach((name, index) => {
      const descriptor = before[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  });

  /** A scroller, 1000 by 800 CSS pixels, whose content is its viewer's layout. */
  class Scroller extends EventTarget {
    viewer: ViewerController | null = null;
    clientWidth = 1000;
    clientHeight = 800;
    clientLeft = 0;
    clientTop = 0;
    readonly ownerDocument = { activeElement: null };
    readonly classes = new Set<string>();
    readonly classList = {
      toggle: (name: string, on: boolean) =>
        on ? this.classes.add(name) : this.classes.delete(name),
      remove: (name: string) => this.classes.delete(name),
    };
    readonly style = {};
    #left = 0;
    #top = 0;
    get scrollWidth(): number {
      return Math.max(this.clientWidth, this.viewer?.store.get().layout?.totalWidth ?? 0);
    }
    get scrollHeight(): number {
      return Math.max(this.clientHeight, this.viewer?.store.get().layout?.totalHeight ?? 0);
    }
    get scrollLeft(): number {
      return this.#left;
    }
    set scrollLeft(left: number) {
      this.#left = Math.min(Math.max(0, left), this.scrollWidth - this.clientWidth);
    }
    get scrollTop(): number {
      return this.#top;
    }
    set scrollTop(top: number) {
      this.#top = Math.min(Math.max(0, top), this.scrollHeight - this.clientHeight);
    }
    scrollTo(left: number, top: number): void {
      this.scrollLeft = left;
      this.scrollTop = top;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }
  }

  /** Attach `scroller` to `viewer`'s viewport until the test ends. */
  function attach(viewer: ViewerController, scroller: Scroller): () => void {
    scroller.viewer = viewer;
    const content = { style: {}, classList: { remove: () => {} } };
    const detach = viewer.attachViewport(
      scroller as unknown as HTMLElement,
      content as unknown as HTMLElement,
    );
    release.push(detach);
    return detach;
  }

  /** A viewer of five Letter pages in a viewport. */
  async function viewing(options: ViewerOptions = {}) {
    const viewer = new ViewerController();
    viewer.configure(options);
    const scroller = new Scroller();
    attach(viewer, scroller);
    const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
    release.push(
      show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader).close,
    );
    await settle();
    return { viewer, scroller };
  }

  /** Resize the viewport, as the browser reports it, and draw the next frame. */
  function resize(scroller: Scroller, width: number, height: number): void {
    scroller.clientWidth = width;
    scroller.clientHeight = height;
    for (const observed of resized) observed();
    for (const frame of frames.splice(0)) frame();
  }

  /** The width of a Letter page fitted to a viewport `width` wide, with the gaps. */
  const fitWidth = (width: number) => (width - 24) / 612;

  it("opens another document at its own starting position with its own tool", async () => {
    for (const scrollMode of ["vertical", "horizontal"] as const) {
      for (const direction of ["ltr", "rtl"] as const) {
        const { viewer, scroller } = await viewing({
          initialScale: 2,
          initialScrollMode: scrollMode,
          direction,
        });
        const position = () => [
          scroller.scrollLeft,
          scroller.scrollTop,
          viewer.store.get().currentPage,
        ];
        const opening = position();
        viewer.goToPage(3);
        scroller.scrollLeft += 100;
        scroller.scrollTop += 100;
        viewer.setTool("hand");
        assert.notDeepEqual(position(), opening);
        assert.ok(scroller.classes.has("parapdf-hand"));

        const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
        const loader = fakePdfjs(async () => document.proxy).loader;
        release.push(show(viewer, { url: `/next-${direction}-${scrollMode}.pdf` }, loader).close);
        await settle();
        assert.deepEqual(position(), opening, `${direction} ${scrollMode}`);
        assert.equal(viewer.store.get().tool, "select");
        assert.equal(scroller.classes.has("parapdf-hand"), false);
      }
    }
  });

  it("goes to the page in range an index names: clamped, truncated, or not at all for NaN", async () => {
    const { viewer, scroller } = await viewing();
    const tops = viewer.store.get().layout?.tops ?? [];
    const at = () => [viewer.store.get().currentPage, scroller.scrollTop];
    viewer.goToPage(3);
    assert.deepEqual(at(), [3, (tops[3] ?? 0) - 12]);
    viewer.goToPage(Number.NaN);
    assert.deepEqual(at(), [3, (tops[3] ?? 0) - 12]);
    viewer.goToPage(1.5);
    assert.deepEqual(at(), [1, (tops[1] ?? 0) - 12]);
    viewer.goToPage(99);
    assert.deepEqual(at(), [4, (tops[4] ?? 0) - 12]);
    viewer.goToPage(Number.NEGATIVE_INFINITY);
    assert.deepEqual(at(), [0, 0]);
  });

  it("shows the row of the page an index names in page mode, and keeps it for NaN", async () => {
    const { viewer } = await viewing({ initialScrollMode: "page" });
    viewer.goToPage(2);
    viewer.goToPage(Number.NaN);
    assert.deepEqual(viewer.store.get().layout?.shown, { first: 2, last: 2 });
    viewer.goToPage(1.5);
    const layout = viewer.store.get().layout;
    assert.deepEqual(layout?.shown, { first: 1, last: 1 });
    assert.equal(layout?.totalHeight, (layout?.heights[1] ?? 0) + 24);
    assert.equal(viewer.store.get().currentPage, 1);
  });

  it("keeps fitting within scale limits that change, and clamps an initial or custom zoom to them", async () => {
    const { viewer: initialClamped } = await viewing({ initialScale: 20 });
    assert.deepEqual(
      [initialClamped.store.get().scale, initialClamped.store.get().zoomMode],
      [10, "custom"],
    );

    const { viewer, scroller } = await viewing();
    const zoom = () => [viewer.store.get().scale, viewer.store.get().zoomMode];
    assert.deepEqual(zoom(), [fitWidth(1000), "fit-width"]);
    viewer.configure({ maxScale: 1 });
    assert.deepEqual(zoom(), [1, "fit-width"]);
    viewer.configure({});
    assert.deepEqual(zoom(), [fitWidth(1000), "fit-width"]);
    viewer.configure({ minScale: 2 });
    assert.deepEqual(zoom(), [2, "fit-width"]);
    resize(scroller, 1400, 800);
    assert.deepEqual(zoom(), [fitWidth(1400), "fit-width"]);
    viewer.configure({ minScale: 1 });
    assert.deepEqual(zoom(), [fitWidth(1400), "fit-width"]);
    viewer.setScale(5);
    viewer.configure({ minScale: 2, maxScale: 3 });
    assert.deepEqual(zoom(), [3, "custom"]);
  });

  it("does nothing for a NaN scale, zoom factor, rotation, or target page, or a rotation not finite", async () => {
    const { viewer } = await viewing();
    viewer.goToPage(2);
    viewer.setScale(2);
    viewer.setScale(Number.NaN);
    viewer.zoomBy(Number.NaN);
    viewer.setRotation(Number.NaN as Rotation);
    viewer.setRotation(Number.POSITIVE_INFINITY as Rotation);
    viewer.rotate(Number.NaN);
    viewer.show({
      target: { pageIndex: Number.NaN, x: null, y: null },
      rotation: Number.NaN as Rotation,
    });
    const { currentPage, scale, zoomMode, rotation, layout } = viewer.store.get();
    assert.deepEqual(
      [currentPage, scale, zoomMode, rotation, layout?.scale],
      [2, 2, "custom", 0, 2],
    );
  });

  it("reveals a rect on the page a fractional index truncates to, and nothing for NaN", async () => {
    const { viewer, scroller } = await viewing();
    const rect = { x: 0, y: 400, width: 100, height: 20 };
    const at = () => [viewer.store.get().currentPage, scroller.scrollTop];
    viewer.revealRect(2, rect);
    const revealed = at();
    viewer.goToPage(0);
    viewer.revealRect(2.7, rect);
    assert.deepEqual(at(), revealed);
    viewer.revealRect(Number.NaN, rect);
    assert.deepEqual(at(), revealed);
  });

  it("keeps a custom zoom within limits that change as the document is built again", async () => {
    const { viewer } = await viewing();
    viewer.setScale(5);
    viewer.configure({ textLayer: false, maxScale: 2 });
    await settle();
    assert.deepEqual([viewer.store.get().scale, viewer.store.get().zoomMode], [2, "custom"]);
  });

  it("keeps a custom zoom within limits that changed while its viewport was away", async () => {
    const { viewer, scroller } = await viewing();
    viewer.setScale(5);
    release.shift()?.();
    viewer.configure({ maxScale: 2 });
    attach(viewer, scroller);
    await settle();
    assert.deepEqual([viewer.store.get().scale, viewer.store.get().zoomMode], [2, "custom"]);
  });

  it("keeps the fitted zoom of a document built again while its viewport is hidden", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    resize(scroller, 0, 0);
    viewer.configure({ textLayer: false });
    await settle();
    resize(scroller, 1000, 800);
    assert.equal(viewer.store.get().scale, fitWidth(1000));
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
  });

  it("opens the new document at the start when it replaces one while detached", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(3);
    release.shift()?.();
    const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
    release.push(
      show(viewer, { url: "/replacement.pdf" }, fakePdfjs(async () => document.proxy).loader).close,
    );
    attach(viewer, scroller);
    await settle();
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [0, 0]);
  });

  it("keeps the fitted zoom of a viewport that attaches again while hidden", async () => {
    const { viewer, scroller } = await viewing();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    // The viewport's first detach, which viewing() released first.
    release.shift()?.();
    resized.splice(0);
    scroller.clientWidth = 0;
    scroller.clientHeight = 0;
    attach(viewer, scroller);
    await settle();
    resize(scroller, 1000, 800);
    assert.equal(viewer.store.get().scale, fitWidth(1000));
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
  });

  /**
   * A provider's session, its viewer, and the viewer's owner as React
   * mounts them in layout effects: `<SessionLeaseMount>`, then
   * `<ViewerViewport>`, then `<ViewerControlSync>`. The returned `hide`
   * destroys them in that order, as React does when it hides or unmounts
   * the tree.
   */
  function mount(
    viewer: ViewerController,
    scroller: Scroller,
    session: PdfSessionController,
  ): () => void {
    const releaseSession = session.connect();
    const releaseViewer = viewer.hold();
    const detach = attach(viewer, scroller);
    viewer.open(session);
    const hide = () => {
      releaseSession();
      releaseViewer();
      detach();
    };
    release.push(hide);
    return hide;
  }

  /** pdf.js whose documents have five Letter pages. */
  const fivePages = () =>
    fakePdfjs(async () => fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) }).proxy);

  it("shows a session again where and how it showed it, once React shows what it hid", async () => {
    // Within the second the document stays open for, and after it closed.
    for (const away of [999, 1000]) {
      const { loader, calls } = fivePages();
      const session = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
      const viewer = new ViewerController();
      const scroller = new Scroller();
      const hide = mount(viewer, scroller, session);
      await settle();
      viewer.setScale(2);
      viewer.setRotation(90);
      viewer.setTool("hand");
      viewer.goToPage(3);
      const shown = viewer.session;
      const view = () => {
        const { currentPage, scale, zoomMode, rotation, tool } = viewer.store.get();
        return [currentPage, scale, zoomMode, rotation, tool, scroller.scrollTop];
      };
      const before = view();
      assert.deepEqual(before.slice(0, 5), [3, 2, "custom", 90, "hand"]);
      assert.ok(shown && scroller.scrollTop > 0);

      hide();
      assert.deepEqual(
        [viewer.session, viewer.renderer, viewer.pdfSession, viewer.store.get().layout],
        [null, null, null, null],
      );
      mock.timers.tick(away);
      await settle();
      assert.equal(shown.signal.aborted, away === 1000);

      mount(viewer, scroller, session);
      await settle();
      assert.equal(viewer.session === shown, away < 1000, "the document that stayed open");
      assert.equal(viewer.pdfSession, session);
      assert.deepEqual(view(), before, `away for ${away} ms`);
      assert.equal(calls.opens, away < 1000 ? 1 : 2);
    }
  });

  it("forgets the previous document when its URL returns different content or a new revision", async () => {
    for (const fingerprints of [
      ["different", null],
      ["original", "updated"],
    ]) {
      let identity: (string | null)[] = ["original", null];
      const { loader } = fakePdfjs(
        async () =>
          fakeDocument({
            pages: [LETTER, LETTER],
            proxy: { fingerprints: identity },
          }).proxy,
      );
      const session = new PdfSessionController({ url: "/latest.pdf" }, { pdfjs: loader });
      const viewer = new ViewerController();
      const scroller = new Scroller();
      const forgotten: boolean[] = [];
      viewer.extend({ closed: (kept) => void forgotten.push(kept) });
      const hide = mount(viewer, scroller, session);
      await settle();
      viewer.setScale(2);
      viewer.goToPage(1);
      hide();
      mock.timers.tick(1000);
      await settle();
      identity = fingerprints;
      mount(viewer, scroller, session);
      await settle();
      assert.deepEqual(forgotten, [true, false], "clear edits and search before restoring");
      assert.equal(viewer.store.get().currentPage, 0);
      assert.equal(viewer.store.get().zoomMode, "fit-width");
    }
  });

  it("shows a document once, however often React runs the effects that mount it", async () => {
    const { loader, calls } = fivePages();
    const session = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    const viewer = new ViewerController();
    viewer.configure({ initialScale: 2 });
    const heard: string[] = [];
    viewer.extend({
      ready: () => void heard.push("ready"),
      closed: (kept) => void heard.push(`closed ${kept}`),
    });
    const scroller = new Scroller();
    // StrictMode mounts, unmounts, and mounts again, before the document loads.
    mount(viewer, scroller, session)();
    mount(viewer, scroller, session);
    await settle();
    assert.ok(viewer.store.get().layout);
    assert.equal(viewer.store.get().scale, 2);
    assert.deepEqual(heard, ["closed true", "ready"]);
    assert.equal(calls.opens, 1);
  });

  it("lets go of a document its owner lets go, whatever the provider holds, and shows it again", async () => {
    const { loader, calls } = fivePages();
    const viewer = new ViewerController();
    const scroller = new Scroller();
    attach(viewer, scroller);
    // The provider stays mounted; React hides the component that owns the viewer.
    release.push(show(viewer, { url: "/a.pdf" }, loader).close);
    const letGo = viewer.hold();
    await settle();
    viewer.goToPage(2);
    const top = scroller.scrollTop;
    const shown = viewer.session;
    assert.ok(shown);
    letGo();
    assert.deepEqual([viewer.session, viewer.store.get().layout], [null, null]);
    assert.equal(scroller.scrollTop, 0, "the viewport shows nothing of it");
    letGo();
    release.push(viewer.hold());
    await settle();
    assert.equal(viewer.session, shown);
    assert.deepEqual([viewer.store.get().currentPage, scroller.scrollTop], [2, top]);
    assert.equal(calls.opens, 1);
  });

  it("forgets the view of a session it let go once another session opens", async () => {
    const { loader } = fivePages();
    const viewer = new ViewerController();
    const heard: boolean[] = [];
    viewer.extend({ closed: (kept) => void heard.push(kept) });
    const scroller = new Scroller();
    const first = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    const hide = mount(viewer, scroller, first);
    await settle();
    viewer.setScale(2);
    viewer.goToPage(3);
    hide();
    assert.deepEqual(heard, [true]);
    mount(viewer, scroller, new PdfSessionController({ url: "/b.pdf" }, { pdfjs: loader }));
    assert.deepEqual(heard, [true, false], "features drop what they kept for the first");
    await settle();
    const { currentPage, scale, zoomMode } = viewer.store.get();
    assert.deepEqual([currentPage, scale, zoomMode], [0, fitWidth(1000), "fit-width"]);
    assert.equal(scroller.scrollTop, 0);
  });

  it("reports settled and compound ViewState changes without echoing open or scrolling per frame", async (context) => {
    let now = 1000;
    context.mock.method(performance, "now", () => now);
    const initial: ViewState = {
      page: 1,
      x: 0,
      y: 80,
      scale: 1.5,
      rotation: 0,
      spread: "none",
      scrollMode: "vertical",
    };
    const viewer = new ViewerController();
    viewer.configure({
      opening: () => ({ view: toShownView(initial) }),
    });
    const scroller = new Scroller();
    const detach = attach(viewer, scroller);
    const heard: ViewState[] = [];
    const unsubscribe = viewer.onViewStateChange((view) => heard.push(view));
    const document = fakeDocument({ pages: Array.from({ length: 5 }, () => LETTER) });
    release.push(
      show(viewer, { url: "/persisted.pdf" }, fakePdfjs(async () => document.proxy).loader).close,
    );
    await settle();

    // Opening with initialViewState places the view without echoing onViewStateChange.
    assert.equal(viewer.viewState()?.page, 1);
    assert.equal(viewer.viewState()?.y, 80);
    assert.equal(heard.length, 0);

    // Compound view updates fire synchronously once with the final ViewState, and deduplicate equals.
    viewer.setViewState({
      page: 2,
      x: 0,
      y: 120,
      scale: 2,
      rotation: 90,
      spread: "odd",
      scrollMode: "vertical",
    });
    assert.equal(heard.length, 1);
    assert.equal(heard[0]?.page, 2);
    assert.equal(heard[0]?.scale, 2);
    assert.equal(heard[0]?.rotation, 90);
    assert.equal(heard[0]?.spread, "odd");

    const first = heard[0];
    assert.ok(first);
    viewer.setViewState(first);
    assert.equal(heard.length, 1);

    viewer.batchView(() => {
      viewer.setRotation(0);
      viewer.setSpread("none");
      viewer.setScale(1.5);
    });
    assert.equal(heard.length, 2);
    assert.equal(heard[1]?.rotation, 0);
    assert.equal(heard[1]?.spread, "none");
    assert.equal(heard[1]?.scale, 1.5);

    // Intra-page scrolling stays quiet per frame while scrolling, then emits once after SETTLE_DELAY.
    const beforeScrollY = viewer.viewState()?.y ?? 0;
    for (const delta of [30, 30, 30]) {
      now += 16;
      scroller.scrollTop += delta;
      scroller.dispatchEvent(new Event("scroll"));
      for (const frame of frames.splice(0)) frame();
    }
    assert.equal(heard.length, 2, "active scroll frames never fire onViewStateChange");

    now += 200;
    mock.timers.tick(200);
    for (const frame of frames.splice(0)) frame();
    assert.equal(heard.length, 3);
    assert.ok((heard[2]?.y ?? 0) > beforeScrollY);

    // flushViewState() and viewport detach flush unsettled scrolls immediately, except when collapsed (0x0).
    now += 16;
    scroller.scrollTop += 45;
    scroller.dispatchEvent(new Event("scroll"));
    assert.equal(heard.length, 3);
    viewer.flushViewState();
    assert.equal(heard.length, 4);

    now += 16;
    scroller.scrollTop += 45;
    scroller.dispatchEvent(new Event("scroll"));
    scroller.clientWidth = 0;
    scroller.clientHeight = 0;
    viewer.flushViewState();
    assert.equal(heard.length, 4, "a collapsed display:none scroller does not overwrite ViewState");

    scroller.clientWidth = 1000;
    scroller.clientHeight = 800;
    detach();
    assert.equal(heard.length, 5, "detaching the viewport flushes the unsettled scroll");
    unsubscribe();
  });

  it("lays out a warm session synchronously before open() returns, including synchronous openings", async () => {
    const { loader } = fivePages();
    const warmup = new PdfSessionController({ url: "/warm.pdf" }, { pdfjs: loader });
    const releaseWarmup = warmup.connect();
    const doc = await warmup.document();
    await Promise.all([doc.pageSizes(), doc.permissions(), doc.direction(), doc.initialView()]);

    // 1. Warm open with a synchronous destination opening resolves in zero microtasks.
    const session = new PdfSessionController({ url: "/warm.pdf" }, { pdfjs: loader });
    session.start();
    const viewer = new ViewerController();
    viewer.configure({
      opening: () => ({
        view: { target: { pageIndex: 3, x: null, y: null, view: { fit: "zoom", zoom: 1.5 } } },
      }),
    });
    const scroller = new Scroller();
    mount(viewer, scroller, session);

    const state = viewer.store.get();
    assert.ok(state.layout, "layout is ready synchronously before any microtask");
    assert.ok(viewer.renderer, "renderer is created synchronously");
    assert.equal(state.currentPage, 3);
    // 150% printed size = 1.5 * (96 / 72) = 2 CSS pixels per PDF point.
    assert.equal(state.scale, 2);
    assert.ok(state.last >= state.first);

    // 2. Warm open with a ShownView places the view synchronously without microtasks.
    const restored = new PdfSessionController({ url: "/warm.pdf" }, { pdfjs: loader });
    restored.start();
    const secondViewer = new ViewerController();
    secondViewer.configure({
      opening: () => ({
        view: toShownView({
          page: 2,
          x: 0,
          y: 96,
          scale: 2,
          rotation: 0,
          spread: "none",
          scrollMode: "vertical",
        }),
      }),
    });
    const secondScroller = new Scroller();
    mount(secondViewer, secondScroller, restored);
    assert.ok(secondViewer.store.get().layout);
    assert.equal(secondViewer.store.get().currentPage, 2);
    assert.equal(secondViewer.store.get().scale, 2);
    assert.equal(secondViewer.store.get().rotation, 0);
    assert.equal(secondViewer.viewState()?.y, 96);

    releaseWarmup();
  });

  it("binds controlled view props without echoing callbacks, reconciles rejected values, and flushes on stop", async (context) => {
    let now = 1000;
    context.mock.method(performance, "now", () => now);
    const { loader } = fivePages();
    const session = new PdfSessionController({ url: "/controlled.pdf" }, { pdfjs: loader });
    const viewer = new ViewerController();
    const scroller = new Scroller();
    let diverges = 0;
    const zoomed: Zoom[] = [];
    const pages: number[] = [];
    const viewStates: ViewState[] = [];
    const binding = viewer.bindControls(() => {
      diverges++;
    });
    release.push(() => binding.disconnect());

    const releaseSession = session.connect();
    const releaseViewer = viewer.hold();
    attach(viewer, scroller);
    const callbacks = {
      zoom: (value: Zoom) => void zoomed.push(value),
      page: (value: number) => void pages.push(value),
      viewState: (value: ViewState) => void viewStates.push(value),
    };
    binding.sync(
      { maxScale: 3, initialScale: 5, initialRotation: 90 },
      { zoom: 5, rotation: 90 },
      callbacks,
    );
    viewer.open(session);
    await settle();

    // Clamping zoom=5 against maxScale=3 on initial open reports 3 once and notifies divergence once.
    assert.equal(viewer.store.get().scale, 3);
    assert.equal(viewer.store.get().rotation, 90);
    assert.deepEqual(zoomed, [3]);
    assert.equal(diverges, 1, "clamped controlled zoom on initial layout notifies divergence");

    // Re-syncing the same clamped prop inside sync() does not echo or re-trigger onDiverge in a loop.
    binding.sync(
      { maxScale: 3, initialScale: 5, initialRotation: 90 },
      { zoom: 5, rotation: 90 },
      callbacks,
    );
    assert.deepEqual(zoomed, [3]);
    assert.equal(diverges, 1, "clamping inside sync() never loops onDiverge");

    // Imperative viewer change while controlled notifies onZoomChange and onDiverge so React can reconcile,
    // without emitting a transient unaccepted ViewState before sync() settles it.
    assert.equal(viewStates.length, 0);
    viewer.setScale(2);
    assert.deepEqual(zoomed, [3, 2]);
    assert.equal(diverges, 2);
    assert.equal(viewStates.length, 0, "diverged controlled zoom holds back unaccepted ViewState");

    // Rejecting zoom=2 (re-syncing zoom=3) restores scale=3 with zero spurious onViewStateChange calls.
    binding.sync(
      { maxScale: 3, initialScale: 3, initialRotation: 90 },
      { zoom: 3, rotation: 90 },
      callbacks,
    );
    assert.equal(viewer.store.get().scale, 3);
    assert.equal(scroller.scrollLeft, 0);
    assert.equal(scroller.scrollTop, 0);
    assert.equal(viewStates.length, 0, "rejected controlled zoom never emits ViewState");

    // Accepting zoom=2 in sync() emits onViewStateChange once with the settled controlled state.
    viewer.setScale(2);
    assert.deepEqual(zoomed, [3, 2, 2]);
    assert.equal(diverges, 3);
    assert.equal(viewStates.length, 0);
    binding.sync(
      { maxScale: 3, initialScale: 2, initialRotation: 90 },
      { zoom: 2, rotation: 90 },
      callbacks,
    );
    assert.equal(viewStates.length, 1, "accepted controlled zoom emits settled ViewState once");
    assert.equal(viewStates[0]?.scale, 2);

    // Compound destination jump changing page + rejected controlled zoom (0.75 * 96/72 = 1 !== 2) emits once after reconciliation.
    await viewer.goToDestination([2, { name: "XYZ" }, 0, 500, 0.75]);
    assert.equal(
      viewStates.length,
      1,
      "compound jump holds ViewState while controlled zoom diverged",
    );
    binding.sync(
      { maxScale: 3, initialScale: 2, initialRotation: 90 },
      { zoom: 2, rotation: 90 },
      callbacks,
    );
    assert.equal(viewStates.length, 2);
    assert.equal(viewStates[1]?.page, 2);
    assert.equal(viewStates[1]?.scale, 2);

    // Updating callbacks alone via setCallbacks() swaps handlers without calling configure().
    const configureCalls = context.mock.method(viewer, "configure");
    const replacedPages: number[] = [];
    binding.setCallbacks({
      ...callbacks,
      page: (value: number) => void replacedPages.push(value),
    });
    assert.equal(configureCalls.mock.calls.length, 0);
    viewer.goToPage(3);
    assert.deepEqual(replacedPages, [3]);

    // Unsettled scroll flushes through bindControls when the session stops before viewport detach.
    const statesBeforeScroll = viewStates.length;
    now += 16;
    scroller.scrollTop += 60;
    scroller.dispatchEvent(new Event("scroll"));
    assert.equal(viewStates.length, statesBeforeScroll);
    releaseSession();
    releaseViewer();
    assert.equal(
      viewStates.length,
      statesBeforeScroll + 1,
      "stopping the session flushes unsettled ViewState",
    );
  });

  it("coalesces warm open, rotation, spread, scrollMode, scale, and setViewState into a single store publish per transaction", async () => {
    const { loader } = fivePages();
    const warmup = new PdfSessionController({ url: "/batched.pdf" }, { pdfjs: loader });
    const releaseWarmup = warmup.connect();
    const doc = await warmup.document();
    await Promise.all([doc.pageSizes(), doc.permissions(), doc.direction(), doc.initialView()]);

    const session = new PdfSessionController({ url: "/batched.pdf" }, { pdfjs: loader });
    session.start();
    const viewer = new ViewerController();
    viewer.configure({
      opening: () => ({
        view: { target: { pageIndex: 3, x: null, y: null, view: { fit: "zoom", zoom: 1.5 } } },
      }),
      initialTool: "hand",
    });
    const scroller = new Scroller();
    attach(viewer, scroller);
    release.push(session.connect(), viewer.hold());

    const publishes: { keys: string[]; page: number; scale: number; hasLayout: boolean }[] = [];
    const unsubscribe = viewer.store.subscribe((changedKeys) => {
      const s = viewer.store.get();
      publishes.push({
        keys: [...(changedKeys ?? [])].map(String),
        page: s.currentPage,
        scale: s.scale,
        hasLayout: s.layout !== null,
      });
    });

    viewer.open(session);
    assert.equal(publishes.length, 1, "warm open emits one store publish");
    assert.equal(publishes[0]?.hasLayout, true);
    assert.equal(publishes[0]?.page, 3);
    assert.equal(publishes[0]?.scale, 2);
    assert.equal(viewer.store.get().tool, "hand");

    publishes.length = 0;
    viewer.setRotation(90);
    assert.equal(publishes.length, 1, "setRotation emits one store publish");
    assert.equal(viewer.store.get().rotation, 90);

    publishes.length = 0;
    viewer.setSpread("odd");
    assert.equal(publishes.length, 1, "setSpread emits one store publish");
    assert.equal(viewer.store.get().spread, "odd");

    publishes.length = 0;
    viewer.setScrollMode("wrapped");
    assert.equal(publishes.length, 1, "setScrollMode emits one store publish");
    assert.equal(viewer.store.get().scrollMode, "wrapped");

    publishes.length = 0;
    viewer.setScale(1.25);
    assert.equal(publishes.length, 1, "setScale emits one store publish");
    assert.equal(viewer.store.get().scale, 1.25);
    assert.equal(viewer.store.get().zoomMode, "custom");

    publishes.length = 0;
    viewer.setViewState({
      page: 1,
      x: 0,
      y: 732,
      scale: 1.75,
      rotation: 180,
      spread: "none",
      scrollMode: "vertical",
    });
    assert.equal(publishes.length, 1, "setViewState emits one store publish");
    assert.equal(viewer.store.get().currentPage, 1);
    assert.equal(viewer.store.get().scale, 1.75);
    assert.equal(viewer.store.get().rotation, 180);
    assert.equal(viewer.store.get().spread, "none");
    assert.equal(viewer.store.get().scrollMode, "vertical");

    unsubscribe();
    releaseWarmup();
  });
});
