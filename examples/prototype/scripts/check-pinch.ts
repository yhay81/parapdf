/**
 * Functional checks for pinch zoom: two touches zoom the document around the
 * point between them and pan with it instead of zooming the whole page, two
 * touches that keep their distance only scroll however fast they move, the
 * pages their preview brings into view mount and draw before the fingers
 * lift, the visible pages show their drawing in every frame after a pinch
 * commits, one finger still scrolls natively, Safari's gesture events zoom
 * the document and are prevented, and ctrl+wheel still zooms around the
 * pointer.
 *
 * In Chromium the touches come from the DevTools protocol, which feeds them
 * through the browser's own input handling, touch-action and page zoom
 * included. Playwright cannot put two fingers down in WebKit or Firefox, so
 * there the checks dispatch the events the runtime listens to: touch pointer
 * events, and in WebKit Safari's gesture events. Those check the runtime's
 * handling, not the browser's. They move the fingers as browsers deliver a
 * gesture: one finger's move and then the other's in each animation frame.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:pinch
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CDPSession, Page } from "playwright";
import { preview } from "vite";
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
/** How far, in CSS pixels, a point may land from where the gesture should keep it. */
const TOLERANCE = 3;
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    captureFailure(name);
  }
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

interface CommitFrames {
  /** Frames from the commit until the pages settled. */
  frames: number;
  /** Frames in which a visible page showed one color where its settled drawing shows more. */
  blank: number;
  /** Frames in which a visible page that showed a detail canvas before the commit showed none. */
  base: number;
}

/**
 * Starts recording, in every frame after its animation frame callbacks, what
 * each visible page shows: its canvases composited as the page shows them,
 * hidden ones left out, at a quarter of the page's CSS size. `stop()`
 * returns what the frames from the zoom's commit on showed. The canvases are
 * read because the scheduler's own account of a page's pixels said nothing
 * of what they showed: while a detail canvas was drawn in place, pdf.js
 * filled it white, and the page showed white for 80 to 175 ms after each
 * zoom in Safari in the iPadOS simulator while `hasPixels()` held.
 */
function startCommitProbe(): void {
  const viewer = (
    window as unknown as {
      __viewer: {
        store: { get(): { scale: number }; subscribe(listener: () => void): () => void };
      };
    }
  ).__viewer;
  const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d") as CanvasRenderingContext2D;
  const S = 0.25;
  const frames: {
    t: number;
    pages: { page: number; region: number[]; flat: boolean; detail: boolean }[];
  }[] = [];
  let commitAt = Number.POSITIVE_INFINITY;
  const scale = viewer.store.get().scale;
  const unsubscribe = viewer.store.subscribe(() => {
    if (viewer.store.get().scale !== scale) commitAt = Math.min(commitAt, performance.now());
  });
  /** Draws what `section` shows into the probe; returns which of its canvases show. */
  const composite = (section: HTMLElement): boolean[] => {
    const rect = section.getBoundingClientRect();
    probe.width = Math.max(1, Math.round(rect.width * S));
    probe.height = Math.max(1, Math.round(rect.height * S));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, probe.width, probe.height);
    return [
      ...section.querySelectorAll<HTMLCanvasElement>(":scope > div[aria-hidden] > canvas"),
    ].map((canvas) => {
      // A canvas never drawn keeps the default size, 300 by 150, and shows nothing.
      const shown =
        canvas.width * canvas.height > 0 &&
        !(canvas.width === 300 && canvas.height === 150) &&
        getComputedStyle(canvas).visibility !== "hidden";
      if (shown) {
        const box = canvas.getBoundingClientRect();
        ctx.drawImage(
          canvas,
          (box.left - rect.left) * S,
          (box.top - rect.top) * S,
          box.width * S,
          box.height * S,
        );
      }
      return shown;
    });
  };
  /**
   * Whether `region`, shares of the page, shows one color in the probe: white
   * while pdf.js fills a canvas before drawing on it, or black where a resized
   * canvas with its opaque context shows before its first frame.
   */
  const flatIn = ([x0 = 0, y0 = 0, x1 = 1, y1 = 1]: number[]): boolean => {
    const x = Math.floor(x0 * probe.width);
    const y = Math.floor(y0 * probe.height);
    const { data } = ctx.getImageData(
      x,
      y,
      Math.max(1, Math.floor(x1 * probe.width) - x),
      Math.max(1, Math.floor(y1 * probe.height) - y),
    );
    for (let i = 4; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        if (Math.abs((data[i + channel] ?? 0) - (data[channel] ?? 0)) > 4) return false;
      }
    }
    return true;
  };
  let running = true;
  const record = () => {
    const box = scroller.getBoundingClientRect();
    const left = box.left + scroller.clientLeft;
    const top = box.top + scroller.clientTop;
    const pages = [];
    for (const section of scroller.querySelectorAll<HTMLElement>("section[data-page]")) {
      const rect = section.getBoundingClientRect();
      const [vl, vt, vr, vb] = [
        Math.max(left, rect.left),
        Math.max(top, rect.top),
        Math.min(left + scroller.clientWidth, rect.right),
        Math.min(top + scroller.clientHeight, rect.bottom),
      ] as [number, number, number, number];
      // Pages that show at least 16 CSS pixels each way, four probe pixels.
      if (vr - vl < 16 || vb - vt < 16 || getComputedStyle(section).visibility === "hidden") {
        continue;
      }
      const shown = composite(section);
      const region = [
        (vl - rect.left) / rect.width,
        (vt - rect.top) / rect.height,
        (vr - rect.left) / rect.width,
        (vb - rect.top) / rect.height,
      ];
      pages.push({
        page: Number(section.dataset.page),
        region,
        flat: flatIn(region),
        detail: shown.slice(1).some(Boolean),
      });
    }
    frames.push({ t: performance.now(), pages });
  };
  // ResizeObserver callbacks run after a frame's animation frame callbacks
  // and layout, before paint: the canvases then hold what the frame shows.
  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:fixed;width:1px;height:1px;visibility:hidden";
  document.body.append(sentinel);
  const observer = new ResizeObserver(() => {
    if (running) record();
  });
  observer.observe(sentinel);
  const tick = () => {
    if (!running) return;
    sentinel.style.width = sentinel.style.width === "2px" ? "1px" : "2px";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  (window as unknown as { __commitProbe: { stop(): CommitFrames } }).__commitProbe = {
    stop() {
      running = false;
      observer.disconnect();
      sentinel.remove();
      unsubscribe();
      const after = frames.filter((frame) => frame.t >= commitAt);
      const before = frames.filter((frame) => frame.t < commitAt).at(-1);
      const detailed = new Set(
        before?.pages.filter((shot) => shot.detail).map((shot) => shot.page) ?? [],
      );
      // Where the page shows one color, its settled drawing of the same part
      // must too, as a margin does.
      const settledFlat = new Map<string, boolean>();
      const blank = (shot: { page: number; region: number[]; flat: boolean }) => {
        if (!shot.flat) return false;
        const key = `${shot.page} ${shot.region.join()}`;
        if (!settledFlat.has(key)) {
          const section = scroller.querySelector<HTMLElement>(`section[data-page="${shot.page}"]`);
          if (section) composite(section);
          settledFlat.set(key, section ? flatIn(shot.region) : false);
        }
        return !settledFlat.get(key);
      };
      return {
        frames: after.length,
        blank: after.filter((frame) => frame.pages.some(blank)).length,
        base: after.filter((frame) =>
          frame.pages.some((shot) => detailed.has(shot.page) && !shot.detail),
        ).length,
      };
    },
  };
}

/**
 * Runs `gesture` under the commit probe until its commit settled and no
 * render completed for 400 ms: zoomed out, the pages count as sharp at once,
 * while their new details are still to be drawn and to take the old ones'
 * place.
 */
async function commitFrames(page: Page, gesture: () => Promise<unknown>): Promise<CommitFrames> {
  await page.evaluate(startCommitProbe);
  await gesture();
  await committed(page);
  await page.waitForFunction(
    () => {
      const stats = (window as unknown as { __viewer: { stats: object | null } }).__viewer.stats;
      const holder = window as unknown as { __rendered?: { key: string; since: number } };
      const key = JSON.stringify(stats);
      if (holder.__rendered?.key !== key) {
        holder.__rendered = { key, since: performance.now() };
        return false;
      }
      return performance.now() - holder.__rendered.since > 400;
    },
    null,
    { timeout: 10_000, polling: 50 },
  );
  return page.evaluate(() =>
    (window as unknown as { __commitProbe: { stop(): CommitFrames } }).__commitProbe.stop(),
  );
}

/**
 * Fits the pages to the viewport's width and scrolls to page `index`, then
 * waits for the pages to settle.
 */
async function fitPage(page: Page, index: number): Promise<void> {
  await page.evaluate((index) => {
    const viewer = (
      window as unknown as {
        __viewer: { setScale(scale: "fit-width"): void; goToPage(index: number): void };
      }
    ).__viewer;
    viewer.setScale("fit-width");
    viewer.goToPage(index);
  }, index);
  await scrollStopped(page);
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
 * The same two touches as touch pointer events dispatched in the page, one
 * step per animation frame, with Safari's gesture events beside them when
 * `gestures` is set. `cancelAfter` cancels the pointers after that many
 * moves, as Safari does when it takes the touches over, and lets the gesture
 * events go on to a `scale` of 2.4.
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
  page.evaluate(async ({ from, to, half, toHalf, steps, gestures, cancelAfter }) => {
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
      await new Promise(requestAnimationFrame);
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

/**
 * Two touches dispatched as touch pointer events, one move per animation
 * frame like a real drag, from `from` ± `half` to `to` ± `toHalf`
 * horizontally, or vertically when `stacked`. The fingers stay down until
 * every page in the viewport, as the preview shows it, is mounted and has
 * pixels, or `timeout` milliseconds after the last move. Returns the widest
 * band at the viewport's top or bottom edge that no mounted page reached
 * during the moves, and how long after the last move the pages took, null on
 * timeout. It also follows the page nearest the fingers' starting midpoint
 * through the frames: `strayed` is how far, at most, it showed from where the
 * midpoint's movement alone carries it, and `zoomed` its width as a share of
 * its width before, the share farthest from 1. A drag that does not pinch
 * keeps them at 0 and 1.
 */
const dragTwoFingers = (
  page: Page,
  options: {
    from: Point;
    to: Point;
    half: number;
    toHalf: number;
    steps: number;
    timeout: number;
    stacked?: boolean;
  },
): Promise<{ band: number; drawnAfter: number | null; strayed: number; zoomed: number }> =>
  page.evaluate(async ({ from, to, half, toHalf, steps, timeout, stacked }) => {
    const viewer = (
      window as unknown as {
        __viewer: {
          hasPixels(index: number): boolean;
          store: { get(): { layout: { tops: Float64Array } | null } };
        };
      }
    ).__viewer;
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const coverage = () => {
      const top = scroller.getBoundingClientRect().top + scroller.clientTop;
      const bottom = top + scroller.clientHeight;
      const pages = [...scroller.querySelectorAll<HTMLElement>("section[data-page]")]
        .map((section) => ({
          index: Number(section.dataset.page) - 1,
          rect: section.getBoundingClientRect(),
        }))
        .sort((a, b) => a.index - b.index);
      const first = pages[0];
      const last = pages.at(-1);
      if (!first || !last) return { band: scroller.clientHeight, drawn: false };
      // The document's own margins above page 1 and below the last page are no band.
      const band = Math.max(
        0,
        first.index === 0 ? 0 : first.rect.top - top,
        last.index === (viewer.store.get().layout?.tops.length ?? 0) - 1
          ? 0
          : bottom - last.rect.bottom,
      );
      const drawn = pages
        .filter(({ rect }) => rect.bottom > top && rect.top < bottom)
        .every(({ index }) => viewer.hasPixels(index));
      return { band, drawn };
    };
    const target = document.elementFromPoint(from.x, from.y) ?? document.body;
    const pointer = (type: string, id: number, x: number, y: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 31,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    /** Finger `id` `spread` before or after the midpoint at `x`, `y`, across or, stacked, down. */
    const finger = (
      type: string,
      id: number,
      side: number,
      x: number,
      y: number,
      spread: number,
    ) =>
      stacked ? pointer(type, id, x, y + side * spread) : pointer(type, id, x + side * spread, y);
    const fingers = (t: number) => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      spread: half + (toHalf - half) * t,
    });
    const followed = [...scroller.querySelectorAll<HTMLElement>("section[data-page]")]
      .map((section) => {
        const rect = section.getBoundingClientRect();
        return {
          page: section.dataset.page,
          rect,
          away: Math.abs(rect.top + rect.height / 2 - from.y),
        };
      })
      .sort((a, b) => a.away - b.away)[0];
    const followedRect = () =>
      scroller.querySelector(`section[data-page="${followed?.page}"]`)?.getBoundingClientRect();
    finger("pointerdown", 31, -1, from.x, from.y, half);
    finger("pointerdown", 32, 1, from.x, from.y, half);
    let band = 0;
    let strayed = 0;
    let zoomed = 1;
    for (let step = 1; step <= steps; step++) {
      const { x, y, spread } = fingers(step / steps);
      finger("pointermove", 31, -1, x, y, spread);
      finger("pointermove", 32, 1, x, y, spread);
      await frame();
      band = Math.max(band, coverage().band);
      const rect = followedRect();
      if (!followed || !rect) {
        strayed = Number.POSITIVE_INFINITY;
        continue;
      }
      const off = Math.hypot(
        rect.left - followed.rect.left - (x - from.x),
        rect.top - followed.rect.top - (y - from.y),
      );
      strayed = Math.max(strayed, off);
      const share = rect.width / followed.rect.width;
      if (Math.abs(share - 1) > Math.abs(zoomed - 1)) zoomed = share;
    }
    const lastMove = performance.now();
    let drawnAfter: number | null = null;
    while (performance.now() - lastMove < timeout) {
      const { band: gap, drawn } = coverage();
      if (gap === 0 && drawn) {
        drawnAfter = Math.round(performance.now() - lastMove);
        break;
      }
      await frame();
    }
    finger("pointerup", 31, -1, to.x, to.y, toHalf);
    finger("pointerup", 32, 1, to.x, to.y, toHalf);
    return {
      band: Math.round(band),
      drawnAfter,
      strayed: Math.round(strayed * 10) / 10,
      zoomed: Math.round(zoomed * 1000) / 1000,
    };
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
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
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
        window as unknown as { __session?: { state: { get(): { status: string } } } }
      ).__session?.state.get().status === "ready",
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
  const edges = await page.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    const top = rect.top + scroller.clientTop;
    return {
      x: Math.round(rect.left + scroller.clientLeft + scroller.clientWidth / 2),
      top: Math.round(top + scroller.clientHeight / 50),
      middle: Math.round(top + scroller.clientHeight / 2),
      bottom: Math.round(top + (scroller.clientHeight * 49) / 50),
    };
  });
  // A flick of two fingers 300 CSS pixels apart: 900 pixels up in six moves.
  const flick = {
    from: { x: edges.x, y: edges.middle + 450 },
    to: { x: edges.x, y: edges.middle - 450 },
  };
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

    // However fast they move: the flick that the dispatched pointers below
    // repeat in every browser, here through Chromium's own input handling.
    before = after;
    await cdpTwoFingers(cdp, flick.from, flick.to, 150, 150, 6);
    await committed(page);
    after = await viewState(page);
    check(
      "a fast two-finger drag through the browser's input scrolls without zooming",
      after.scale === before.scale && Math.abs(after.scrollTop - before.scrollTop - 900) <= 2,
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

  // A fast two-finger drag: the fingers keep their 300 CSS pixels apart and
  // move 150 a frame, one finger's move and then the other's as browsers
  // deliver them. The runtime read the distance between the touches at each
  // move, the moved finger against where the other was a frame before:
  // hypot(300, 150), 35 pixels more than at the start, which started a zoom
  // relative to that transient distance. The drag committed a zoom of
  // 300 / 335 = 0.894 instead of only scrolling.
  await fitPage(page, 2);
  before = await viewState(page);
  const flicked = await dragTwoFingers(page, {
    ...flick,
    half: 150,
    toHalf: 150,
    steps: 6,
    timeout: 0,
  });
  await committed(page);
  after = await viewState(page);
  check(
    "a fast two-finger drag scrolls by its distance without zooming",
    after.scale === before.scale && Math.abs(after.scrollTop - before.scrollTop - 900) <= 2,
    JSON.stringify({
      dragged: 900,
      scrolled: after.scrollTop - before.scrollTop,
      ratio: after.scale / before.scale,
    }),
  );
  check(
    "the fast drag's preview follows the fingers in every frame without zooming",
    flicked.strayed <= 1 && Math.abs(flicked.zoomed - 1) < 1e-3,
    JSON.stringify({ strayed: flicked.strayed, zoomed: flicked.zoomed }),
  );

  // With one finger above the other, the first finger's move changed the
  // distance read against the other's place a frame before by all of its
  // movement, so a drag zoomed from 16 CSS pixels a frame on: at 30 a frame
  // and 150 apart, it committed 150 / 180 = 0.833.
  await fitPage(page, 2);
  before = await viewState(page);
  await dragTwoFingers(page, {
    from: { x: edges.x, y: edges.middle + 300 },
    to: { x: edges.x, y: edges.middle - 300 },
    half: 75,
    toHalf: 75,
    steps: 20,
    timeout: 0,
    stacked: true,
  });
  await committed(page);
  after = await viewState(page);
  check(
    "a two-finger drag with one finger above the other scrolls without zooming",
    after.scale === before.scale && Math.abs(after.scrollTop - before.scrollTop - 600) <= 2,
    JSON.stringify({
      dragged: 600,
      scrolled: after.scrollTop - before.scrollTop,
      ratio: after.scale / before.scale,
    }),
  );

  // A pinch in at the document's start used to preview page 1 where the
  // commit cannot keep it: lower than the top of the scroll range allows,
  // and off the center the commit puts a page narrower than the viewport at.
  // The page then jumped when the fingers lifted, 334 CSS pixels on an iPad.
  // The preview must show it where the commit puts it.
  await fitPage(page, 0);
  before = await viewState(page);
  const previewed = await page.evaluate(async ({ x, y }) => {
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
      await new Promise(requestAnimationFrame);
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

  // A long two-finger drag at the lowest zoom pans the preview past the
  // mounted pages: two pages of overscan reach at most three page heights
  // and two gaps, 834 CSS pixels here, past the viewport's bottom edge, and
  // the drag moves the content by 96% of the viewport's height. The pages it
  // brought into view used to mount only once the fingers lifted, leaving a
  // blank band that grew to 218 CSS pixels in Safari in the iPadOS simulator.
  await page.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(0.25),
  );
  await settle(page);
  const up = { from: { x: edges.x, y: edges.bottom }, to: { x: edges.x, y: edges.top } };
  before = await viewState(page);
  const panned = await dragTwoFingers(page, {
    ...up,
    half: 75,
    toHalf: 75,
    steps: 30,
    timeout: 5_000,
  });
  await committed(page);
  after = await viewState(page);
  check(
    "a long two-finger drag at the lowest zoom mounts and draws the pages it shows before the fingers lift",
    panned.band === 0 && panned.drawnAfter !== null,
    JSON.stringify({ band: panned.band, drawnAfter: panned.drawnAfter }),
  );
  check(
    "the long drag's preview follows the fingers in every frame",
    panned.strayed <= 1 && Math.abs(panned.zoomed - 1) < 1e-3,
    JSON.stringify({ strayed: panned.strayed, zoomed: panned.zoomed }),
  );
  check(
    "the long drag then scrolls by its distance",
    after.scale === before.scale &&
      Math.abs(after.scrollTop - before.scrollTop - (edges.bottom - edges.top)) <= 2,
    JSON.stringify({
      dragged: edges.bottom - edges.top,
      scrolled: after.scrollTop - before.scrollTop,
    }),
  );

  // A pinch in that drags as well shows more of the document still: its
  // preview also shrinks the content around the point between the fingers.
  await page.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(0.5),
  );
  await settle(page);
  before = await viewState(page);
  const pinched = await dragTwoFingers(page, {
    ...up,
    half: 150,
    toHalf: 75,
    steps: 30,
    timeout: 5_000,
  });
  await committed(page);
  after = await viewState(page);
  check(
    "a pinch in that also drags mounts and draws the pages it shows before the fingers lift",
    after.scale < before.scale * 0.6 && pinched.band === 0 && pinched.drawnAfter !== null,
    JSON.stringify({
      ratio: after.scale / before.scale,
      band: pinched.band,
      drawnAfter: pinched.drawnAfter,
    }),
  );

  // In every frame after a pinch commits, the visible pages show their
  // drawing: each its old detail, scaled, until the new one, drawn into the
  // other detail canvas, takes its place. Drawn in place, the detail showed
  // white while pdf.js drew it, for 80 to 175 ms in Safari in the iPadOS
  // simulator; hidden until complete, it left the page to its base, at a
  // quarter of the device's resolution, for as long.
  await fitPage(page, 2);
  const zoomedIn = await commitFrames(page, () =>
    dispatchTwoFingers(page, { from: point, to: point, half: 50, toHalf: 100, steps: 10 }),
  );
  check(
    "after a pinch out commits, no visible page shows blank or only its base in any frame",
    zoomedIn.frames > 0 && zoomedIn.blank === 0 && zoomedIn.base === 0,
    JSON.stringify(zoomedIn),
  );
  await fitPage(page, 0);
  const zoomedOut = await commitFrames(page, () =>
    dispatchTwoFingers(page, { from: point, to: point, half: 150, toHalf: 40, steps: 10 }),
  );
  check(
    "after a pinch in commits, no visible page shows blank or only its base in any frame",
    zoomedOut.frames > 0 && zoomedOut.blank === 0 && zoomedOut.base === 0,
    JSON.stringify(zoomedOut),
  );

  await page.context().close();
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
