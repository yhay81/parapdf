/**
 * Functional checks for pinch zoom: two touches zoom the document around the
 * point between them and pan with it instead of zooming the whole page, a
 * long two-finger drag mounts and draws the pages it shows before the fingers
 * lift, one finger still scrolls natively, Safari's gesture events zoom the
 * document and are prevented, and ctrl+wheel still zooms around the pointer.
 *
 * In Chromium the touches come from the DevTools protocol, which feeds them
 * through the browser's own input handling, touch-action and page zoom
 * included. Playwright cannot put two fingers down in WebKit or Firefox, so
 * there the checks dispatch the events the runtime listens to: touch pointer
 * events, and in WebKit Safari's gesture events. Those check the runtime's
 * handling, not the browser's.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:pinch
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CDPSession, Page } from "playwright";
import { preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
/** How far, in CSS pixels, a point may land from where the gesture should keep it. */
const TOLERANCE = 3;
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Point {
  x: number;
  y: number;
}

/** A point on a page as shares of the page's width and height. */
interface Spot {
  page: number;
  fx: number;
  fy: number;
}

interface ViewState {
  scale: number;
  zoomMode: string;
  scrollLeft: number;
  scrollTop: number;
  /** The browser's own page zoom. */
  pageZoom: number;
  /** The content's preview transform; empty once a gesture committed. */
  transform: string;
  touchAction: string;
}

const viewState = (page: Page): Promise<ViewState> =>
  page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: { store: { get(): { scale: number; zoomMode: string } } };
      }
    ).__viewer;
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const content = scroller.querySelector(":scope > div") as HTMLElement;
    const state = viewer.store.get();
    return {
      scale: state.scale,
      zoomMode: state.zoomMode,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      pageZoom: window.visualViewport?.scale ?? 1,
      transform: content.style.transform,
      touchAction: getComputedStyle(scroller).touchAction,
    };
  });

/** The page point under a client point. */
const spotAt = (page: Page, point: Point): Promise<Spot | null> =>
  page.evaluate(({ x, y }) => {
    const section = document.elementFromPoint(x, y)?.closest<HTMLElement>("section[data-page]");
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    return {
      page: Number(section.dataset.page),
      fx: (x - rect.left) / rect.width,
      fy: (y - rect.top) / rect.height,
    };
  }, point);

/** Where a page point shows now, in client coordinates. */
const pointOf = (page: Page, spot: Spot): Promise<Point | null> =>
  page.evaluate(({ page, fx, fy }) => {
    const section = document.querySelector(`section[data-page="${page}"]`);
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
  }, spot);

/** How far a page point landed from where it should be, per axis. */
async function drift(page: Page, spot: Spot | null, expected: Point): Promise<Point | null> {
  const now = spot ? await pointOf(page, spot) : null;
  return now ? { x: now.x - expected.x, y: now.y - expected.y } : null;
}

const within = (offset: number | undefined) =>
  offset !== undefined && Math.abs(offset) <= TOLERANCE;

/** Waits until the visible pages are sharp and nothing changed for 300 ms. */
const settle = (page: Page) =>
  page.waitForFunction(
    () => {
      const viewer = (window as unknown as { __viewer?: { sharpness(): number } }).__viewer;
      const holder = window as unknown as { __settledSince?: number | null };
      if (!viewer || viewer.sharpness() < 0.99) {
        holder.__settledSince = null;
        return false;
      }
      holder.__settledSince ??= performance.now();
      return performance.now() - holder.__settledSince > 300;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );

/** Waits until the viewport's scroll position held for 300 ms, a fling included. */
const scrollStopped = (page: Page) =>
  page.waitForFunction(
    () => {
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      const holder = window as unknown as { __scrollHeld?: { top: number; since: number } };
      const held = holder.__scrollHeld;
      if (!held || held.top !== scroller.scrollTop) {
        holder.__scrollHeld = { top: scroller.scrollTop, since: performance.now() };
        return false;
      }
      return performance.now() - held.since > 300;
    },
    null,
    { timeout: 10_000, polling: 50 },
  );

/** Waits until a gesture's preview committed, then for the pages to settle. */
async function committed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      return (scroller.querySelector(":scope > div") as HTMLElement).style.transform === "";
    },
    null,
    { timeout: 5_000 },
  );
  await settle(page);
}

/** A point in the viewport: a third from its left and two fifths from its top. */
const pinchPoint = (page: Page): Promise<Point> =>
  page.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    return {
      x: Math.round(rect.left + scroller.clientWidth / 3),
      y: Math.round(rect.top + (scroller.clientHeight * 2) / 5),
    };
  });

/**
 * Whether the mounted pages cover the viewport as a preview shows them, and
 * every page in view has pixels, within `timeout` milliseconds.
 */
const coveredWhileShown = (page: Page, timeout: number): Promise<boolean> =>
  page
    .waitForFunction(
      () => {
        const viewer = (
          window as unknown as {
            __viewer: {
              hasPixels(index: number): boolean;
              store: { get(): { pageCount: number } };
            };
          }
        ).__viewer;
        const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
        const view = scroller.getBoundingClientRect();
        const bottom = view.top + scroller.clientHeight;
        const pages = [...scroller.querySelectorAll<HTMLElement>("section[data-page]")]
          .map((section) => ({
            index: Number(section.dataset.page) - 1,
            rect: section.getBoundingClientRect(),
          }))
          .sort((a, b) => a.index - b.index);
        const first = pages[0];
        const last = pages.at(-1);
        if (!first || !last) return false;
        const reachesTop = first.index === 0 || first.rect.top <= view.top;
        const reachesBottom =
          last.index === viewer.store.get().pageCount - 1 || last.rect.bottom >= bottom;
        const drawn = pages
          .filter(({ rect }) => rect.bottom > view.top && rect.top < bottom)
          .every(({ index }) => viewer.hasPixels(index));
        return reachesTop && reachesBottom && drawn;
      },
      null,
      { timeout, polling: 50 },
    )
    .then(
      () => true,
      () => false,
    );

/**
 * Two touches from `from` ± `half` to `to` ± `toHalf` horizontally, in
 * `steps` moves, through the DevTools protocol.
 */
async function cdpTwoFingers(
  cdp: CDPSession,
  from: Point,
  to: Point,
  half: number,
  toHalf: number,
  steps: number,
): Promise<void> {
  const points = (center: Point, spread: number) => [
    { x: center.x - spread, y: center.y, id: 0 },
    { x: center.x + spread, y: center.y, id: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(from, half),
  });
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const center = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(center, half + (toHalf - half) * t),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * The same two touches as touch pointer events dispatched in the page, with
 * Safari's gesture events beside them when `gestures` is set. `cancelAfter`
 * cancels the pointers after that many moves, as Safari does when it takes
 * the touches over, and lets the gesture events go on to a `scale` of 2.4.
 */
const dispatchTwoFingers = (
  page: Page,
  options: {
    from: Point;
    to: Point;
    half: number;
    toHalf: number;
    steps: number;
    gestures?: boolean;
    cancelAfter?: number;
  },
): Promise<boolean[]> =>
  page.evaluate(({ from, to, half, toHalf, steps, gestures, cancelAfter }) => {
    const target = document.elementFromPoint(from.x, from.y) ?? document.body;
    const prevented: boolean[] = [];
    const pointer = (type: string, id: number, x: number, y: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 11,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    const gesture = (type: string, scale: number) => {
      if (!gestures) return;
      const event = new UIEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "scale", { value: scale });
      target.dispatchEvent(event);
      prevented.push(event.defaultPrevented);
    };
    const fingers = (t: number) => {
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const spread = half + (toHalf - half) * t;
      return { x, y, spread, scale: spread / half };
    };
    pointer("pointerdown", 11, from.x - half, from.y);
    pointer("pointerdown", 12, from.x + half, from.y);
    gesture("gesturestart", 1);
    const moves = Math.min(steps, cancelAfter ?? steps);
    for (let step = 1; step <= moves; step++) {
      const { x, y, spread, scale } = fingers(step / steps);
      pointer("pointermove", 11, x - spread, y);
      pointer("pointermove", 12, x + spread, y);
      gesture("gesturechange", scale);
    }
    if (cancelAfter !== undefined) {
      const { x, y, spread } = fingers(moves / steps);
      pointer("pointercancel", 11, x - spread, y);
      pointer("pointercancel", 12, x + spread, y);
      gesture("gesturechange", 2);
      gesture("gesturechange", 2.4);
      gesture("gestureend", 2.4);
      return prevented;
    }
    pointer("pointerup", 11, to.x - toHalf, to.y);
    pointer("pointerup", 12, to.x + toHalf, to.y);
    gesture("gestureend", toHalf / half);
    return prevented;
  }, options);

/** Safari's gesture events of a trackpad pinch at `point`, with no touches. */
const dispatchTrackpadPinch = (page: Page, point: Point, scales: number[]): Promise<boolean[]> =>
  page.evaluate(
    ({ point, scales }) => {
      const target = document.elementFromPoint(point.x, point.y) ?? document.body;
      const types = scales.map((_, index) =>
        index === 0 ? "gesturestart" : index === scales.length - 1 ? "gestureend" : "gesturechange",
      );
      return types.map((type, index) => {
        const event = new UIEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          scale: { value: scales[index] },
          clientX: { value: point.x },
          clientY: { value: point.y },
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      });
    },
    { point, scales },
  );

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4180, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4180/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const errors: string[] = [];
/** A tablet-sized viewer on bill-hr815.pdf, scrolled to its third page. */
const newPage = async (): Promise<Page> => {
  const context = await launched.browser.newContext({
    viewport: { width: 820, height: 1000 },
    deviceScaleFactor: 2,
    hasTouch: true,
    // Chromium then zooms the page on a pinch, as on Android; Firefox has no mobile mode.
    isMobile: launched.name === "chromium",
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}?engine=${engine}&file=bill-hr815.pdf`);
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __viewer?: { store: { get(): { status: string } } } }
      ).__viewer?.store.get().status === "ready",
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(2),
  );
  await settle(page);
  return page;
};

try {
  const page = await newPage();
  const point = await pinchPoint(page);
  let before = await viewState(page);
  check(
    "the viewport leaves pinches to the runtime",
    before.touchAction === "pan-x pan-y",
    before.touchAction,
  );

  // ctrl+wheel, the trackpad pinch of Chromium and Firefox, zooms around the pointer.
  let spot = await spotAt(page, point);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  await committed(page);
  let after = await viewState(page);
  let offset = await drift(page, spot, point);
  check(
    "ctrl+wheel zooms in around the pointer",
    after.scale > before.scale * 1.2 && within(offset?.x) && within(offset?.y),
    JSON.stringify({ ratio: after.scale / before.scale, offset }),
  );
  await page.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: "fit-width"): void } }).__viewer.setScale(
      "fit-width",
    ),
  );
  await settle(page);

  if (launched.name === "chromium") {
    const cdp = await page.context().newCDPSession(page);

    // A pinch out zooms the document, not the page, around the point between the fingers.
    before = await viewState(page);
    spot = await spotAt(page, point);
    await cdp.send("Input.synthesizePinchGesture", {
      x: point.x,
      y: point.y,
      scaleFactor: 2,
      gestureSourceType: "touch",
    });
    await committed(page);
    after = await viewState(page);
    offset = await drift(page, spot, point);
    check(
      "a touch pinch out zooms the document instead of the page",
      after.pageZoom === 1 && after.scale > before.scale * 1.5 && after.zoomMode === "custom",
      JSON.stringify({ ratio: after.scale / before.scale, pageZoom: after.pageZoom }),
    );
    check(
      "the point between the fingers stays under them",
      within(offset?.x) && within(offset?.y),
      JSON.stringify(offset),
    );

    // A pinch in zooms out; the page may then be centered, so only its height share holds.
    before = after;
    spot = await spotAt(page, point);
    await cdp.send("Input.synthesizePinchGesture", {
      x: point.x,
      y: point.y,
      scaleFactor: 0.5,
      gestureSourceType: "touch",
    });
    await committed(page);
    after = await viewState(page);
    offset = await drift(page, spot, point);
    check(
      "a touch pinch in zooms out around the fingers",
      after.pageZoom === 1 && after.scale < before.scale * 0.8 && within(offset?.y),
      JSON.stringify({ ratio: after.scale / before.scale, pageZoom: after.pageZoom, offset }),
    );

    // Fingers that move apart and along at once zoom and pan: the point
    // that was between them ends up between them again.
    before = await viewState(page);
    spot = await spotAt(page, point);
    const moved = { x: point.x + 40, y: point.y + 60 };
    await cdpTwoFingers(cdp, point, moved, 50, 100, 15);
    await committed(page);
    after = await viewState(page);
    offset = await drift(page, spot, moved);
    check(
      "a pinch that also moves keeps the point between the fingers",
      after.pageZoom === 1 &&
        after.scale > before.scale * 1.4 &&
        within(offset?.x) &&
        within(offset?.y),
      JSON.stringify({ ratio: after.scale / before.scale, offset }),
    );

    // Two fingers that keep their distance only scroll, at the same zoom.
    before = after;
    await cdpTwoFingers(cdp, point, { x: point.x, y: point.y - 150 }, 60, 60, 10);
    await committed(page);
    after = await viewState(page);
    check(
      "a two-finger drag scrolls without zooming",
      after.scale === before.scale && Math.abs(after.scrollTop - before.scrollTop - 150) <= 2,
      JSON.stringify({
        scrolled: after.scrollTop - before.scrollTop,
        ratio: after.scale / before.scale,
      }),
    );

    // One finger still scrolls natively. The touches go through the DevTools
    // protocol one by one, like the two-finger ones: in Chromium on Linux,
    // Input.synthesizeScrollGesture scrolled nothing at all. The finger
    // stops before it lifts, so no fling scrolls on into the next check.
    before = after;
    const finger = (y: number) => [{ x: point.x, y, id: 0 }];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: finger(point.y),
    });
    for (let step = 1; step <= 15; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: finger(point.y - 20 * step),
      });
    }
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: finger(point.y - 300),
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await scrollStopped(page);
    after = await viewState(page);
    check(
      "one finger still scrolls natively",
      after.pageZoom === 1 &&
        after.scale === before.scale &&
        after.scrollTop - before.scrollTop > 200 &&
        after.transform === "",
      JSON.stringify({ scrolled: after.scrollTop - before.scrollTop }),
    );
  } else {
    // Touch pointer events that move apart and along at once zoom and pan.
    before = await viewState(page);
    spot = await spotAt(page, point);
    const moved = { x: point.x + 40, y: point.y + 60 };
    await dispatchTwoFingers(page, { from: point, to: moved, half: 50, toHalf: 100, steps: 15 });
    await committed(page);
    after = await viewState(page);
    offset = await drift(page, spot, moved);
    check(
      "touch pointers that move apart and along zoom and keep the point between them",
      after.scale > before.scale * 1.4 &&
        after.zoomMode === "custom" &&
        within(offset?.x) &&
        within(offset?.y),
      JSON.stringify({ ratio: after.scale / before.scale, offset }),
    );
  }

  if (launched.name === "webkit") {
    // A trackpad pinch in Safari: gesture events alone, around the pointer.
    await page.evaluate(() =>
      (window as unknown as { __viewer: { setScale(scale: "fit-width"): void } }).__viewer.setScale(
        "fit-width",
      ),
    );
    await settle(page);
    before = await viewState(page);
    spot = await spotAt(page, point);
    const prevented = await dispatchTrackpadPinch(page, point, [1, 1.3, 1.7, 2, 2]);
    await committed(page);
    after = await viewState(page);
    offset = await drift(page, spot, point);
    check(
      "Safari's gesture events are prevented, so Safari does not zoom the page",
      prevented.length === 5 && prevented.every(Boolean),
      JSON.stringify(prevented),
    );
    check(
      "Safari's gesture events zoom the document by their scale around the pointer",
      Math.abs(after.scale / before.scale - 2) < 1e-3 && within(offset?.x) && within(offset?.y),
      JSON.stringify({ ratio: after.scale / before.scale, offset }),
    );

    // iPadOS reports a touch pinch through both kinds of events. If Safari
    // cancels the pointers, the gesture events carry the zoom on from where
    // the touches left it: 1.5 at a gesture scale of 1.8, so 2.4 makes 2.
    await page.evaluate(() =>
      (window as unknown as { __viewer: { setScale(scale: "fit-width"): void } }).__viewer.setScale(
        "fit-width",
      ),
    );
    await settle(page);
    before = await viewState(page);
    const handedOver = await dispatchTwoFingers(page, {
      from: point,
      to: point,
      half: 50,
      toHalf: 100,
      steps: 10,
      gestures: true,
      cancelAfter: 8,
    });
    await committed(page);
    after = await viewState(page);
    check(
      "gesture events finish a touch pinch whose pointers Safari cancelled",
      handedOver.every(Boolean) && Math.abs(after.scale / before.scale - 2) < 1e-3,
      JSON.stringify({ ratio: after.scale / before.scale, prevented: handedOver }),
    );
  }

  // A pinch in at the document's start used to preview page 1 where the
  // commit cannot keep it: lower than the top of the scroll range allows,
  // and off the center the commit puts a page narrower than the viewport at.
  // The page then jumped when the fingers lifted, 334 CSS pixels on an iPad.
  // The preview must show it where the commit puts it.
  await page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: { setScale(scale: "fit-width"): void; goToPage(index: number): void };
      }
    ).__viewer;
    viewer.setScale("fit-width");
    viewer.goToPage(0);
  });
  await scrollStopped(page);
  await settle(page);
  before = await viewState(page);
  const previewed = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document.body;
    const pointer = (type: string, id: number, at: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 21,
          clientX: at,
          clientY: y,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    pointer("pointerdown", 21, x - 150);
    pointer("pointerdown", 22, x + 150);
    for (let step = 1; step <= 10; step++) {
      const spread = 150 - 11 * step;
      pointer("pointermove", 21, x - spread);
      pointer("pointermove", 22, x + spread);
    }
    const shown = document.querySelector('section[data-page="1"]')?.getBoundingClientRect();
    pointer("pointerup", 21, x - 40);
    pointer("pointerup", 22, x + 40);
    return shown ? { left: shown.left, top: shown.top } : null;
  }, point);
  await committed(page);
  after = await viewState(page);
  const landed = await page.evaluate(() => {
    const shown = document.querySelector('section[data-page="1"]')?.getBoundingClientRect();
    return shown ? { left: shown.left, top: shown.top } : null;
  });
  check(
    "a pinch in at the document's start previews page 1 where the commit puts it",
    after.scale < before.scale * 0.5 &&
      previewed !== null &&
      landed !== null &&
      within(landed.left - previewed.left) &&
      within(landed.top - previewed.top),
    JSON.stringify({ ratio: after.scale / before.scale, previewed, landed }),
  );

  // A two-finger drag over almost the viewport's height at the lowest zoom
  // shows pages beyond the mounted window: its two pages of overscan reach at
  // most three page heights and two gaps (834 pixels here) past the
  // viewport's bottom edge. They used to mount only when the fingers lifted,
  // leaving a blank band; they must mount and draw before.
  await page.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(0.25),
  );
  await settle(page);
  before = await viewState(page);
  const drag = await page.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    const x = Math.round(rect.left + scroller.clientWidth / 2);
    const from = Math.round(rect.top + (scroller.clientHeight * 49) / 50);
    const to = Math.round(rect.top + scroller.clientHeight / 50);
    const target = document.elementFromPoint(x, from) ?? document.body;
    (window as unknown as { __dragTarget: Element }).__dragTarget = target;
    const pointer = (type: string, id: number, at: number, y: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 31,
          clientX: at,
          clientY: y,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    pointer("pointerdown", 31, x - 75, from);
    pointer("pointerdown", 32, x + 75, from);
    for (let step = 1; step <= 30; step++) {
      const y = from + ((to - from) * step) / 30;
      pointer("pointermove", 31, x - 75, y);
      pointer("pointermove", 32, x + 75, y);
    }
    return { x, from, to };
  });
  const covered = await coveredWhileShown(page, 5_000);
  await page.evaluate(({ x, to }) => {
    const target = (window as unknown as { __dragTarget: Element }).__dragTarget;
    for (const [id, at] of [
      [31, x - 75],
      [32, x + 75],
    ] as const) {
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 31,
          clientX: at,
          clientY: to,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  }, drag);
  await committed(page);
  after = await viewState(page);
  const dragged = drag.from - drag.to;
  check(
    "a long two-finger drag mounts and draws the pages it brings into view",
    covered && Math.abs(after.scrollTop - before.scrollTop - dragged) <= 2,
    JSON.stringify({ covered, dragged, scrolled: after.scrollTop - before.scrollTop }),
  );

  await page.context().close();
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
