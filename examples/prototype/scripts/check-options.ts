/**
 * Functional checks for the options an embedding application sets: pages of
 * mixed sizes centered in the viewport, "fit-width" following the viewport's
 * width and the view's rotation, per-canvas and total canvas pixel limits, one
 * render for the first paint of a small page, inert external links, and
 * `<PdfViewer>`'s props: live options and controlled view state.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:options
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";
import type { LoadedPdfjs } from "../../../packages/parapdf/src/pdfjs/loader.ts";
import type { Viewer } from "../../../packages/parapdf/src/view/viewer.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    captureFailure(name);
  }
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
          blankFraction(): number;
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
      // The base, then the two detail canvases: the one shown and the one a
      // new detail is drawn into.
      const [base, ...details] = section.querySelectorAll<HTMLCanvasElement>(
        ":scope > div[aria-hidden] > canvas",
      );
      const basePixels = (base?.width ?? 0) * (base?.height ?? 0);
      let detailPixels = 0;
      for (const detail of details) {
        const pixels = detail.width * detail.height;
        detailPixels += pixels;
        largestDetail = Math.max(largestDetail, pixels);
      }
      largestBase = Math.max(largestBase, basePixels);
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
      blank: viewer.blankFraction(),
      viewportPixels: scroller.clientWidth * scroller.clientHeight * window.devicePixelRatio ** 2,
      trimmed: viewer.stats?.trimmed ?? 0,
    };
  });

/**
 * Waits until the visible pages are sharp and nothing changed for 300 ms, or,
 * with `quiet`, until nothing is blank and no render finished for a second: a
 * tight budget keeps pages below full resolution on purpose.
 */
const settle = (page: Page, { quiet = false } = {}) =>
  page.waitForFunction(
    (quiet) => {
      const viewer = (
        window as unknown as {
          __viewer?: {
            sharpness(): number;
            blankFraction(): number;
            stats: Record<string, number> | null;
          };
        }
      ).__viewer;
      const holder = window as unknown as { __settledSince?: number | null; __settledKey?: string };
      if (!viewer) return false;
      const now = performance.now();
      if (quiet) {
        const stats = viewer.stats ?? {};
        const key = `${stats.base}/${stats.detail}/${stats.cancelled}`;
        if (viewer.blankFraction() > 0 || key !== holder.__settledKey) {
          holder.__settledKey = key;
          holder.__settledSince = null;
          return false;
        }
        holder.__settledSince ??= now;
        return now - holder.__settledSince > 1000;
      }
      if (viewer.sharpness() < 0.99) {
        holder.__settledSince = null;
        return false;
      }
      holder.__settledSince ??= now;
      return now - holder.__settledSince > 300;
    },
    quiet,
    { timeout: 30_000, polling: 50 },
  );

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
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
        window as unknown as { __session?: { state: { get(): { status: string } } } }
      ).__session?.state.get().status === "ready",
    null,
    { timeout: 30_000 },
  );
  await settle(page);
  return page;
};

try {
  // Pages of mixed sizes: each centered in the viewport, wider ones at the gap.
  const mixed = await newPage("file=synthetic-mixed-sizes.pdf");
  // Hold the size pass until the reader has moved far down an overestimated
  // document. The real browser must clamp the scroll when its size shrinks.
  const refined = await mixed.evaluate(async () => {
    const { __viewer, __showWith, __attachViewport } = window as unknown as {
      __viewer: Viewer;
      __attachViewport: (viewer: Viewer, scroller: HTMLElement, content: HTMLElement) => () => void;
      __showWith: (
        viewer: Viewer,
        source: { url: string },
        pdfjs: () => Promise<unknown>,
      ) => () => void;
    };
    const Runtime = __viewer.constructor as new (options: object) => Viewer;
    const results = [];
    for (const scrollMode of ["vertical", "horizontal"] as const) {
      let finishSizes = () => {};
      const sizesReady = new Promise<void>((resolve) => {
        finishSizes = resolve;
      });
      // pdf.js standing in, with a document whose pages after the first
      // are larger in the first page's size than they are.
      const page = (width: number, height: number) => ({
        rotate: 0,
        getViewport: ({ scale = 1 }: { scale?: number }) => ({
          width: width * scale,
          height: height * scale,
        }),
      });
      const doc = {
        numPages: 20,
        async getPage(pageNumber: number) {
          if (pageNumber === 1) return page(4000, 4000);
          await sizesReady;
          return page(1000, 1000);
        },
        getPermissions: async () => null,
        getOutline: async () => null,
        getPageLabels: async () => null,
        getMetadata: async () => ({ info: {}, metadata: null }),
        getAttachments: async () => null,
        getOptionalContentConfig: async () => ({ getOrder: () => null, *[Symbol.iterator]() {} }),
        getOpenAction: async () => null,
        getPageLayout: async () => "",
        getPageMode: async () => "",
      };
      const pdfjs = {
        pdfjs: {
          getDocument: () => ({
            promise: Promise.resolve(doc),
            onProgress: null,
            onPassword: null,
            destroy: async () => {},
          }),
          PermissionFlag: {},
        },
        worker: {},
        documentParameters: {},
        imageResourcesPath: "",
        iconUrls: null,
        workerLocation: "",
      } as unknown as LoadedPdfjs;
      const viewer = new Runtime({ initialScale: 1, initialScrollMode: scrollMode });
      const scroller = document.createElement("div");
      scroller.style.cssText =
        "position:fixed;inset:0;width:600px;height:600px;overflow:auto;contain:strict";
      const content = document.createElement("div");
      scroller.append(content);
      document.body.append(scroller);
      const detach = __attachViewport(viewer, scroller, content);
      let finishOpen = () => {};
      const ready = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      const unsubscribe = viewer.store.subscribe(() => {
        if (viewer.store.get().layout) finishOpen();
      });
      const close = __showWith(
        viewer,
        { url: `/delayed-sizes-${scrollMode}.pdf` },
        async () => pdfjs,
      );
      await ready;
      unsubscribe();
      try {
        const old = viewer.store.get().layout;
        if (!old) throw new Error("No initial layout");
        const axis = scrollMode === "vertical" ? "scrollTop" : "scrollLeft";
        const positions = scrollMode === "vertical" ? "tops" : "offsets";
        const inset = scrollMode === "horizontal" ? old.gap : 0;
        // A quarter of the way through page 10, beyond the shorter
        // document's eventual end: resizing must clamp this old position.
        scroller[axis] = (old[positions][9] ?? 0) + inset + 1000;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const before = viewer.store.get().currentPage;
        finishSizes();
        const deadline = performance.now() + 5000;
        while (viewer.store.get().layout === old && performance.now() < deadline) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        const state = viewer.store.get();
        const expected = (state.layout?.[positions][9] ?? 0) + inset + 250;
        results.push({
          mode: scrollMode,
          before,
          after: state.currentPage,
          position: scroller[axis],
          expected,
        });
      } finally {
        close();
        detach();
        scroller.remove();
      }
    }
    return results;
  });
  for (const result of refined) {
    check(
      `the size pass keeps the reading position when ${result.mode} content shrinks`,
      result.before === 9 && result.after === 9 && Math.abs(result.position - result.expected) <= 1,
      JSON.stringify(result),
    );
  }
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
    // The detail canvas shown: drawn, and not hidden while a new detail is drawn into it.
    const detail = [
      ...section.querySelectorAll<HTMLCanvasElement>(":scope > div[aria-hidden] > canvas"),
    ]
      .slice(1)
      .find((canvas) => canvas.width > 0 && canvas.style.visibility !== "hidden");
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
    "zooming in keeps all canvases within maxCanvasPixels, visible pages first and sharp",
    canvases.total <= budget * 1.01 && canvases.outside === 0 && canvases.sharpness >= 0.99,
    JSON.stringify(canvases),
  );
  await limited.context().close();

  // A budget smaller than the visible area lowers the visible detail's resolution, never blanks it.
  // Sharp at fit width; at 4 CSS pixels per point the visible area needs more than is left.
  const tight = 4_000_000;
  const squeezed = await newPage(`file=synthetic-vector-200k.pdf&maxCanvasPixels=${tight}`);
  await squeezed.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(4),
  );
  await settle(squeezed, { quiet: true });
  canvases = await canvasPixels(squeezed);
  check(
    "a budget below the visible area lowers the detail's resolution, and the page stays drawn",
    canvases.total <= tight * 1.05 &&
      canvases.largestDetail > 0 &&
      canvases.sharpness > 0.3 &&
      canvases.sharpness < 0.99 &&
      canvases.blank === 0,
    JSON.stringify(canvases),
  );
  await squeezed.context().close();

  // maxDetailViewports sizes the detail by the viewport: smaller viewport, smaller detail.
  const viewports = 1.5;
  const relative = await newPage(`file=synthetic-vector-200k.pdf&maxDetailViewports=${viewports}`);
  await relative.evaluate(() =>
    (window as unknown as { __viewer: { setScale(scale: number): void } }).__viewer.setScale(2),
  );
  await settle(relative);
  const wide = await canvasPixels(relative);
  const detailsBefore = await relative.evaluate(
    () => (window as unknown as { __viewer: { stats: { detail: number } } }).__viewer.stats.detail,
  );
  await relative.setViewportSize({ width: 640, height: 600 });
  // The wide detail still covers the narrow viewport sharply, so the viewer
  // is sharp at once while it draws the smaller detail into the spare canvas.
  // Playwright's WebKit on Linux, slower, was still drawing it 600 ms later:
  // both canvases counted. Wait for a detail to complete and no canvas to be
  // drawn, hidden with pixels until its drawing completes.
  await relative.waitForFunction(
    (before) => {
      const viewer = (window as unknown as { __viewer: { stats: { detail: number } } }).__viewer;
      const drawing = [...document.querySelectorAll<HTMLCanvasElement>("section canvas")].some(
        (canvas) => canvas.width > 0 && canvas.style.visibility === "hidden",
      );
      return viewer.stats.detail > before && !drawing;
    },
    detailsBefore,
    { timeout: 30_000, polling: 50 },
  );
  await settle(relative);
  const narrow = await canvasPixels(relative);
  check(
    "maxDetailViewports keeps the detail within its multiple of the viewport, at full resolution",
    wide.largestDetail <= viewports * wide.viewportPixels * 1.02 &&
      narrow.largestDetail <= viewports * narrow.viewportPixels * 1.02 &&
      narrow.largestDetail < wide.largestDetail &&
      wide.sharpness >= 0.99 &&
      narrow.sharpness >= 0.99,
    JSON.stringify({ wide, narrow }),
  );
  await relative.context().close();

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

  // getDocument parameters from configurePdfjs() reach pdf.js.
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

  // PdfViewer's props are live, and its view state controlled or not (M6).
  const live = await newPage("file=bill-hr815.pdf&count=1");
  type Demo = {
    __viewer: Viewer;
    __setViewerProps(props: Record<string, unknown>): void;
    __lifecycle: { stats: { opens: number } };
    __reported?: { pages: number[]; rotations: number[] };
  };
  const frames = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const viewState = (page: Page) =>
    page.evaluate(() => {
      const { __viewer: viewer } = window as unknown as Demo;
      const state = viewer.store.get();
      return {
        rotation: state.rotation,
        scale: state.scale,
        zoomMode: state.zoomMode,
        currentPage: state.currentPage,
        gap: state.layout?.gap ?? null,
        textLayers: document.querySelectorAll(".parapdf-text-layer").length,
      };
    });
  await live.evaluate(() => (window as unknown as Demo).__viewer.goToPage(4));
  await settle(live);
  const opened = await viewState(live);
  await live.evaluate(() =>
    (window as unknown as Demo).__setViewerProps({ textLayer: false, gap: 40 }),
  );
  await settle(live);
  const changedOptions = await viewState(live);
  check(
    "changed options apply without reopening the document or losing the page",
    changedOptions.textLayers === 0 &&
      changedOptions.gap === 40 &&
      changedOptions.currentPage === opened.currentPage &&
      (await live.evaluate(() => (window as unknown as Demo).__lifecycle.stats.opens)) === 1,
    JSON.stringify({ opened, changedOptions }),
  );
  await live.evaluate(() => (window as unknown as Demo).__setViewerProps({ textLayer: true }));
  await settle(live);
  check(
    "turning an option back on builds its layers again",
    (await viewState(live)).textLayers > 0,
  );
  await live.evaluate(() => {
    const demo = window as unknown as Demo;
    demo.__reported = { pages: [], rotations: [] };
    demo.__setViewerProps({
      rotation: 90,
      onPageChange: (page: number) => demo.__reported?.pages.push(page),
      onRotationChange: (rotation: number) => demo.__reported?.rotations.push(rotation),
    });
  });
  // settle() holds since the pages last were sharp, so it can return before
  // React commits the prop: Playwright's WebKit on Linux saw rotation 0 here.
  await live
    .waitForFunction(() => (window as unknown as Demo).__viewer.store.get().rotation === 90, null, {
      timeout: 5_000,
    })
    .catch(() => {});
  await settle(live);
  const controlled = await viewState(live);
  await live.evaluate(() => (window as unknown as Demo).__viewer.rotate(90));
  await frames(live);
  await settle(live);
  const notTakenUp = await viewState(live);
  check(
    "a controlled rotation shows, and returns after a change the application does not take up",
    controlled.rotation === 90 && notTakenUp.rotation === 90,
    JSON.stringify({ controlled: controlled.rotation, after: notTakenUp.rotation }),
  );
  await live.evaluate(() => {
    const demo = window as unknown as Demo;
    demo.__setViewerProps({
      onRotationChange: (rotation: number) => {
        demo.__reported?.rotations.push(rotation);
        demo.__setViewerProps({ rotation });
      },
    });
  });
  await frames(live);
  await live.evaluate(() => (window as unknown as Demo).__viewer.rotate(90));
  await frames(live);
  await settle(live);
  const takenUp = await viewState(live);
  await live.evaluate(() => (window as unknown as Demo).__viewer.goToPage(9));
  await settle(live);
  const reported = await live.evaluate(() => (window as unknown as Demo).__reported);
  check(
    "a change the application takes up stays, and the callbacks hear the viewer's changes",
    takenUp.rotation === 180 &&
      reported?.rotations.includes(180) === true &&
      reported.pages.at(-1) === 9,
    JSON.stringify({ rotation: takenUp.rotation, reported }),
  );
  await live.evaluate(() =>
    (window as unknown as Demo).__setViewerProps({ zoom: 1.5, onZoomChange: undefined }),
  );
  await settle(live);
  const controlledZoom = await viewState(live);
  await live.evaluate(() => (window as unknown as Demo).__viewer.zoomBy(1.25));
  await frames(live);
  await settle(live);
  const zoomBack = await viewState(live);
  check(
    "a controlled zoom shows its scale, and returns to it",
    controlledZoom.scale === 1.5 && controlledZoom.zoomMode === "custom" && zoomBack.scale === 1.5,
    JSON.stringify({ controlledZoom, zoomBack }),
  );
  await live.context().close();

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
