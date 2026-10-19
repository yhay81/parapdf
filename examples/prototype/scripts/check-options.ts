/**
 * Functional checks for the options an embedding application sets: pages of
 * mixed sizes centered in the viewport, "fit-width" following the viewport's
 * width and the view's rotation, per-canvas and total canvas pixel limits, one
 * render for the first paint of a small page, and inert external links.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:options
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Probe {
  zoomMode: string;
  scale: number;
  gap: number;
  clientWidth: number;
  scrollWidth: number;
  /** Mounted pages: where the page sits in the content and where pageLeft() puts it. */
  pages: { page: number; left: number; expected: number; width: number; right: number }[];
}

/** Placement of every mounted page, read from the DOM and from the published layout. */
const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: {
          store: {
            get(): {
              zoomMode: string;
              scale: number;
              layout: { gap: number; widths: Float64Array } | null;
            };
          };
        };
      }
    ).__viewer;
    const state = viewer.store.get();
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const origin = scroller.getBoundingClientRect();
    const gap = state.layout?.gap ?? 0;
    const pages = [...scroller.querySelectorAll<HTMLElement>("section[data-page]")].map(
      (section) => {
        const index = Number(section.dataset.page) - 1;
        const rect = section.getBoundingClientRect();
        const width = state.layout?.widths[index] ?? 0;
        return {
          page: index + 1,
          left: rect.left - origin.left + scroller.scrollLeft,
          expected: Math.max(gap, (scroller.clientWidth - width) / 2),
          width: rect.width,
          right: rect.right - origin.left,
        };
      },
    );
    return {
      zoomMode: state.zoomMode,
      scale: state.scale,
      gap,
      clientWidth: scroller.clientWidth,
      scrollWidth: scroller.scrollWidth,
      pages,
    };
  });

/** Canvas pixels of pages in and outside the viewport, the largest of each layer, and stats. */
const canvasPixels = (page: Page) =>
  page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: {
          sharpness(): number;
          stats: { trimmed?: number } | null;
          store: { get(): { layout: { tops: Float64Array; heights: Float64Array } | null } };
        };
      }
    ).__viewer;
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const layout = viewer.store.get().layout;
    const top = scroller.scrollTop;
    const bottom = top + scroller.clientHeight;
    let visible = 0;
    let outside = 0;
    let largestBase = 0;
    let largestDetail = 0;
    for (const section of scroller.querySelectorAll<HTMLElement>("section[data-page]")) {
      const index = Number(section.dataset.page) - 1;
      const pageTop = layout?.tops[index] ?? 0;
      const pageBottom = pageTop + (layout?.heights[index] ?? 0);
      const [base, detail] = section.querySelectorAll("canvas");
      const basePixels = (base?.width ?? 0) * (base?.height ?? 0);
      const detailPixels = (detail?.width ?? 0) * (detail?.height ?? 0);
      largestBase = Math.max(largestBase, basePixels);
      largestDetail = Math.max(largestDetail, detailPixels);
      if (pageBottom > top && pageTop < bottom) visible += basePixels + detailPixels;
      else outside += basePixels + detailPixels;
    }
    return {
      total: visible + outside,
      visible,
      outside,
      largestBase,
      largestDetail,
      sharpness: viewer.sharpness(),
      trimmed: viewer.stats?.trimmed ?? 0,
    };
  });

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

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4188, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4188/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const errors: string[] = [];
const newPage = async (query: string, width = 1000): Promise<Page> => {
  const context = await launched.browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}?engine=${engine}&${query}`);
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __viewer?: { store: { get(): { status: string } } } }
      ).__viewer?.store.get().status === "ready",
    null,
    { timeout: 30_000 },
  );
  await settle(page);
  return page;
};

try {
  // Pages of mixed sizes: each centered in the viewport, wider ones at the gap.
  const mixed = await newPage("file=synthetic-mixed-sizes.pdf");
  // The background pass learns the landscape page's size and widens the content.
  await mixed.waitForFunction(
    () => {
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      return scroller.scrollWidth > scroller.clientWidth;
    },
    null,
    { timeout: 15_000 },
  );
  let state = await probe(mixed);
  check("the viewer opens in fit-width mode", state.zoomMode === "fit-width", state.zoomMode);
  const first = state.pages.find((entry) => entry.page === 1);
  check(
    "fit-width fits the first page to the viewport's width",
    first !== undefined && Math.abs(first.width - (state.clientWidth - 2 * state.gap)) <= 2,
    JSON.stringify({ width: first?.width, clientWidth: state.clientWidth }),
  );
  check(
    "a page narrower than the widest stays inside the viewport",
    first !== undefined && first.right <= state.clientWidth + 1,
    JSON.stringify(first),
  );
  check(
    "mounted pages sit where pageLeft() places them",
    state.pages.length > 1 &&
      state.pages.every((entry) => Math.abs(entry.left - entry.expected) <= 1),
    JSON.stringify(state.pages.map(({ page, left, expected }) => ({ page, left, expected }))),
  );
  await mixed.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(2),
  );
  await settle(mixed);
  state = await probe(mixed);
  const landscape = state.pages.find((entry) => entry.page === 3);
  check(
    "a page wider than the viewport starts at the gap",
    landscape !== undefined && Math.abs(landscape.left - state.gap) <= 1,
    JSON.stringify(landscape),
  );
  await mixed.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(6),
  );
  await settle(mixed);
  state = await probe(mixed);
  const small = state.pages.find((entry) => entry.page === 7);
  check(
    "a page narrower than the viewport is centered in it",
    small !== undefined &&
      small.left > state.gap + 10 &&
      Math.abs(small.left - (state.clientWidth - small.width) / 2) <= 1,
    JSON.stringify({ ...small, clientWidth: state.clientWidth }),
  );
  await mixed.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(2),
  );
  await settle(mixed);

  // Region detail on a wide page lines up with what the viewport shows.
  await mixed.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(6),
  );
  await settle(mixed);
  await mixed.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    scroller.scrollLeft = scroller.scrollWidth / 2;
  });
  await settle(mixed);
  const covered = await mixed.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const view = scroller.getBoundingClientRect();
    const viewer = (
      window as unknown as { __viewer: { store: { get(): { currentPage: number } } } }
    ).__viewer;
    const section = scroller.querySelector(
      `section[data-page="${viewer.store.get().currentPage + 1}"]`,
    ) as HTMLElement;
    const pageBox = section.getBoundingClientRect();
    const [, detail] = section.querySelectorAll("canvas");
    const box = detail?.getBoundingClientRect();
    // The part of the page the viewport shows must lie inside the detail canvas.
    const left = Math.max(view.left, pageBox.left);
    const right = Math.min(view.left + scroller.clientWidth, pageBox.right);
    const top = Math.max(view.top, pageBox.top);
    const bottom = Math.min(view.top + scroller.clientHeight, pageBox.bottom);
    return {
      inside:
        box !== undefined &&
        box.width > 0 &&
        box.left <= left + 1 &&
        box.right >= right - 1 &&
        box.top <= top + 1 &&
        box.bottom >= bottom - 1,
      detail: box ? [box.left, box.top, box.right, box.bottom].map(Math.round) : null,
      visible: [left, top, right, bottom].map(Math.round),
    };
  });
  check(
    "region detail covers the visible part of a zoomed page",
    covered.inside,
    JSON.stringify(covered),
  );
  await mixed.context().close();

  // fit-width follows the viewport's width and the view's rotation until the user zooms.
  const fit = await newPage("file=bill-hr815.pdf", 1200);
  const before = await probe(fit);
  await fit.setViewportSize({ width: 800, height: 900 });
  await fit.waitForTimeout(300);
  await settle(fit);
  let after = await probe(fit);
  const fitted = (probe: Probe) => {
    const entry = probe.pages.find((item) => item.page === 1) ?? probe.pages[0];
    return entry !== undefined && Math.abs(entry.width - (probe.clientWidth - 2 * probe.gap)) <= 2;
  };
  check(
    "fit-width refits when the viewport narrows",
    after.zoomMode === "fit-width" && after.scale < before.scale && fitted(after),
    JSON.stringify({ before: before.scale, after: after.scale, clientWidth: after.clientWidth }),
  );
  await fit.getByRole("button", { name: "Zoom in", exact: true }).click();
  await settle(fit);
  const zoomed = await probe(fit);
  await fit.setViewportSize({ width: 1100, height: 900 });
  await fit.waitForTimeout(300);
  await settle(fit);
  after = await probe(fit);
  check(
    "zooming leaves fit-width, and resizing then keeps the scale",
    zoomed.zoomMode === "custom" &&
      after.zoomMode === "custom" &&
      Math.abs(after.scale - zoomed.scale) < 1e-6,
    JSON.stringify({ zoomed: zoomed.scale, after: after.scale, mode: after.zoomMode }),
  );
  await fit.getByRole("button", { name: "Fit width", exact: true }).click();
  await settle(fit);
  after = await probe(fit);
  check(
    "Fit width returns to the mode and fits again",
    after.zoomMode === "fit-width" && fitted(after),
    JSON.stringify({ scale: after.scale, mode: after.zoomMode }),
  );
  await fit.getByRole("button", { name: "Rotate clockwise", exact: true }).click();
  await settle(fit);
  after = await probe(fit);
  check(
    "fit-width fits the turned page's width",
    fitted(after),
    JSON.stringify({ scale: after.scale, pages: after.pages.slice(0, 1) }),
  );
  await fit.context().close();

  // Canvas pixel limits: per canvas, and for all of a viewer's canvases together.
  const budget = 12_000_000;
  const limited = await newPage(`file=bill-hr815.pdf&maxCanvasPixels=${budget}`);
  await limited.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(50),
  );
  await settle(limited);
  await limited.waitForTimeout(1500);
  let canvases = await canvasPixels(limited);
  check(
    "pages outside the viewport stay within maxCanvasPixels",
    canvases.total <= budget || canvases.outside === 0,
    JSON.stringify(canvases),
  );
  await limited.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(3),
  );
  await settle(limited);
  await limited.waitForTimeout(1500);
  canvases = await canvasPixels(limited);
  check(
    "zooming past the budget clears pages outside the viewport, visible pages stay sharp",
    canvases.visible > budget && canvases.outside === 0 && canvases.trimmed > 0,
    JSON.stringify(canvases),
  );
  await limited.context().close();

  const detailLimit = 4_000_000;
  const capped = await newPage(`file=synthetic-vector-200k.pdf&maxDetailPixels=${detailLimit}`);
  canvases = await canvasPixels(capped);
  check(
    "maxDetailPixels caps the detail canvas, which then covers the visible area sharply",
    canvases.largestDetail > 0 &&
      canvases.largestDetail <= detailLimit &&
      canvases.sharpness >= 0.99,
    JSON.stringify(canvases),
  );
  await capped.context().close();

  const baseLimit = 200_000;
  const thin = await newPage(`file=bill-hr815.pdf&maxBasePixels=${baseLimit}`);
  canvases = await canvasPixels(thin);
  check(
    "maxBasePixels caps the base canvases",
    canvases.largestBase > 0 && canvases.largestBase <= baseLimit,
    JSON.stringify(canvases),
  );
  await thin.context().close();

  // A small visible page draws its detail once, without a base, and its text follows.
  const vector = await newPage("file=synthetic-vector-200k.pdf");
  await vector.waitForSelector('section[data-page="1"] .parapdf-text-layer', {
    state: "attached",
    timeout: 15_000,
  });
  const renders = await vector.evaluate(
    () =>
      (window as unknown as { __viewer: { stats: { base: number; detail: number } | null } })
        .__viewer.stats,
  );
  check(
    "the first paint of a small page is one detail render",
    renders !== null && renders.base === 0 && renders.detail === 1,
    JSON.stringify(renders),
  );
  await vector.context().close();

  // Disabled external links stay inert; internal links keep working.
  const inert = await newPage("file=usrguide.pdf&externalLinks=disabled");
  const tableOfContents = inert.locator(
    'section[data-page="1"] .parapdf-annotation-layer a[href^="#"]',
  );
  await tableOfContents.first().waitFor({ state: "attached", timeout: 30_000 });
  const internal = await tableOfContents.count();
  await inert.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(25),
  );
  const external = inert.locator('section[data-page="26"] .parapdf-annotation-layer a');
  await external.first().waitFor({ state: "attached", timeout: 15_000 });
  const attributes = await external.evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute("href"),
      target: element.getAttribute("target"),
      // An anchor's tabIndex reads 0 even without href; ask focus() instead.
      focusable: (() => {
        (element as HTMLElement).focus();
        return document.activeElement === element;
      })(),
    })),
  );
  // Internal links on the page keep their "#" targets; the external ones lose theirs.
  const inertLinks = attributes.filter((link) => link.href === null);
  check(
    "disabled external links have no href, target, or focus",
    inertLinks.length > 0 &&
      inertLinks.every((link) => link.target === null && !link.focusable) &&
      attributes.every((link) => link.href === null || link.href.startsWith("#")),
    JSON.stringify({ inert: inertLinks.length, all: attributes }),
  );
  await inert.evaluate(() =>
    (window as unknown as { __viewer: { goToPage(index: number): void } }).__viewer.goToPage(0),
  );
  await settle(inert);
  await tableOfContents.nth(3).click();
  await inert.waitForTimeout(600);
  const jumped = await inert.evaluate(
    () =>
      (
        window as unknown as { __viewer: { store: { get(): { currentPage: number } } } }
      ).__viewer.store.get().currentPage,
  );
  check(
    "internal links still jump when external links are disabled",
    internal >= 20 && jumped > 0,
    JSON.stringify({ internal, jumped }),
  );
  await inert.context().close();

  // getDocument parameters pass through the engine to pdf.js.
  const passed = await newPage(
    `file=usrguide.pdf&documentOptions=${encodeURIComponent(JSON.stringify({ disableAutoFetch: true }))}`,
  );
  const loadingParams = await passed.evaluate(
    () =>
      (window as unknown as { __pdfDocument?: { loadingParams: { disableAutoFetch: boolean } } })
        .__pdfDocument?.loadingParams,
  );
  check(
    "documentOptions reach pdf.js's getDocument",
    loadingParams?.disableAutoFetch === true,
    JSON.stringify(loadingParams),
  );
  await passed.context().close();

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
