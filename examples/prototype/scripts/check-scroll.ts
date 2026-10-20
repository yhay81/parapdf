/**
 * Functional checks for scroll modes: where pages sit in "vertical",
 * "horizontal", "wrapped", and "page" mode, alone and in spreads; the current
 * page; zooming around a point; "fit-width" and "fit-page"; scrolling to a
 * search match; switching modes on the current page; filling rows again
 * after a resize; and flipping pages in "page" mode with keys, buttons, and
 * goToPage(), while scrolling stays within a zoomed page. They run on the
 * synthetic document of mixed page sizes.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:scroll
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

type ScrollMode = "vertical" | "horizontal" | "wrapped" | "page";
const MODES: readonly ScrollMode[] = ["vertical", "horizontal", "wrapped", "page"];

/** The viewer runtime the demo exposes, as far as these checks call it. */
interface Viewer {
  store: {
    get(): {
      currentPage: number;
      pageCount: number;
      scale: number;
      scrollMode: ScrollMode;
      spread: string;
      layout: {
        gap: number;
        rowFirst: Int32Array;
        shown: { first: number; last: number } | null;
        totalWidth: number;
        totalHeight: number;
      } | null;
      search: { status: string; matches: unknown[] };
    };
  };
  hasPixels(index: number): boolean;
  goToPage(index: number): void;
  setScale(scale: number | string, anchor?: { x: number; y: number }): void;
  setScrollMode(mode: string): void;
  setSpread(spread: string): void;
  search(query: string): void;
}

/** The demo's window, which exposes the viewer for these checks. */
type Demo = { __viewer?: Viewer };

/** A mounted page's box in viewport coordinates: from the scroller's top-left inner corner. */
interface Box {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  hidden: boolean;
}

interface Geometry {
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  currentPage: number;
  scale: number;
  gap: number;
  shown: { first: number; last: number } | null;
  rowFirst: number[];
  pages: Box[];
}

const geometry = (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
    const origin = scroller.getBoundingClientRect();
    const x0 = origin.left + scroller.clientLeft;
    const y0 = origin.top + scroller.clientTop;
    const state = (window as unknown as Demo).__viewer?.store.get();
    return {
      clientWidth: scroller.clientWidth,
      clientHeight: scroller.clientHeight,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      scrollWidth: scroller.scrollWidth,
      scrollHeight: scroller.scrollHeight,
      currentPage: state?.currentPage ?? -1,
      scale: state?.scale ?? 0,
      gap: state?.layout?.gap ?? 0,
      shown: state?.layout?.shown ?? null,
      rowFirst: [...(state?.layout?.rowFirst ?? [])],
      pages: [...scroller.querySelectorAll<HTMLElement>("section[data-page]")]
        .map((section) => {
          const rect = section.getBoundingClientRect();
          return {
            index: Number(section.dataset.page) - 1,
            left: rect.left - x0,
            top: rect.top - y0,
            width: rect.width,
            height: rect.height,
            hidden: section.style.visibility === "hidden",
          };
        })
        .sort((a, b) => a.index - b.index),
    };
  });

/** Two animation frames: the runtime's update and React's commit. */
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** Waits until the scroll position stops moving, as after a smooth key scroll. */
async function still(page: Page): Promise<void> {
  let last = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const now = await page.evaluate(() => {
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      return `${scroller.scrollLeft},${scroller.scrollTop}`;
    });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(60);
  }
}

/** Waits until the viewer's render counters stop changing. */
const settle = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const stats = (
          (window as unknown as Demo).__viewer as unknown as { stats: object | null } | undefined
        )?.stats;
        if (!stats) return false;
        const key = JSON.stringify(stats);
        const holder = window as { __lastStats?: string; __stableSince?: number };
        if (holder.__lastStats !== key) {
          holder.__lastStats = key;
          holder.__stableSince = performance.now();
          return false;
        }
        return performance.now() - (holder.__stableSince ?? 0) > 400;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .catch(() => {});

async function open(browser: Browser, url: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("calibrate.html", url).href);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(
    () => (window as unknown as Demo).__viewer?.hasPixels(0) === true,
    undefined,
    {
      timeout: 30_000,
    },
  );
  // The background pass learns every page's real size and lays them out again.
  await page.waitForTimeout(300);
  await frames(page);
  return { page, errors };
}

const near = (a: number, b: number, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
const round = (box: Box) =>
  `${box.index}:${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
/** Whether a box overlaps the viewport. */
const inView = (g: Geometry, box: Box) =>
  box.left < g.clientWidth &&
  box.left + box.width > 0 &&
  box.top < g.clientHeight &&
  box.top + box.height > 0;

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4185, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4185/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const demo = (query: string) =>
  `${baseUrl}?engine=${engine}&file=synthetic-mixed-sizes.pdf&${query}`;

try {
  // --- Placement, alone and in spreads ---
  for (const spread of ["none", "odd"] as const) {
    for (const mode of MODES) {
      const label = `${mode}${spread === "none" ? "" : ", odd spreads"}`;
      const { page, errors } = await open(
        launched.browser,
        demo(`scroll=${mode}&spread=${spread}&scale=0.5`),
      );
      const g = await geometry(page);
      const { gap } = g;
      const shown = g.pages.filter((box) => !box.hidden);
      // Rows of the mounted pages, by the layout's own rows.
      const rows = new Map<number, Box[]>();
      for (const box of shown) {
        const first = g.rowFirst[box.index] ?? -1;
        rows.set(first, [...(rows.get(first) ?? []), box]);
      }
      const rowList = [...rows.values()];
      const spans = rowList.map((row) => {
        const left = Math.min(...row.map((box) => box.left));
        const right = Math.max(...row.map((box) => box.left + box.width));
        const top = Math.min(...row.map((box) => box.top));
        const bottom = Math.max(...row.map((box) => box.top + box.height));
        return { left, right, top, bottom };
      });
      // Within a row, each page follows the one before after the gap and is
      // centered in the row's height.
      const sideBySide = rowList.every((row, at) => {
        const span = spans[at];
        return (
          span !== undefined &&
          row.every(
            (box, index) =>
              near(box.top + box.height / 2, (span.top + span.bottom) / 2) &&
              (index === 0 ||
                near(box.left, (row[index - 1]?.left ?? 0) + (row[index - 1]?.width ?? 0) + gap)),
          )
        );
      });
      // Rows narrower than the viewport are centered in its width.
      const centeredX = spans.every(
        (span) =>
          span.right - span.left > g.clientWidth - 2 * gap ||
          near(span.left, g.clientWidth - span.right),
      );
      const detail = shown.map(round).join(" ");
      if (mode === "vertical") {
        check(
          `${label}: rows stack top to bottom, each centered`,
          sideBySide &&
            centeredX &&
            spans.every(
              (span, at) => at === 0 || near(span.top, (spans[at - 1]?.bottom ?? 0) + gap),
            ) &&
            rowList.every(
              (row) => row.length === (spread === "none" ? 1 : 2) || row[0]?.index === 7,
            ),
          detail,
        );
      } else if (mode === "horizontal") {
        const span = spans[0];
        check(
          `${label}: every page in one row, centered in the viewport's height`,
          rowList.length === 1 &&
            sideBySide &&
            span !== undefined &&
            near(span.top + (span.bottom - span.top) / 2, g.clientHeight / 2) &&
            g.scrollHeight === g.clientHeight &&
            near(
              g.scrollWidth,
              await page.evaluate(
                () => (window as unknown as Demo).__viewer?.store.get().layout?.totalWidth ?? 0,
              ),
            ),
          `${detail}; scroll ${g.scrollWidth}x${g.scrollHeight} in ${g.clientWidth}x${g.clientHeight}`,
        );
      } else if (mode === "wrapped") {
        // A row holds as many pages, or whole pairs, as fit; the next one would not.
        const allBoxes = g.pages;
        const fills = rowList.every((row, at) => {
          const span = spans[at];
          const last = row[row.length - 1];
          if (!span || !last) return false;
          const next = allBoxes.find((box) => box.index === last.index + 1);
          const partner =
            spread === "odd" && next && next.index % 2 === 0
              ? allBoxes.find((box) => box.index === next.index + 1)
              : undefined;
          const nextWidth = (next?.width ?? 0) + (partner ? gap + partner.width : 0);
          return (
            span.right - span.left + 2 * gap <= g.clientWidth + 1 &&
            (!next || span.right - span.left + gap + nextWidth + 2 * gap > g.clientWidth)
          );
        });
        const pairsWhole =
          spread === "none" ||
          shown.every(
            (box) =>
              box.index % 2 === 1 ||
              g.rowFirst[box.index] === g.rowFirst[box.index + 1] ||
              box.index === 7,
          );
        check(
          `${label}: rows fill the viewport's width, centered, and stack`,
          rowList.length >= 2 &&
            rowList.some((row) => row.length >= 2) &&
            sideBySide &&
            centeredX &&
            fills &&
            pairsWhole &&
            spans.every(
              (span, at) => at === 0 || span.top >= (spans[at - 1]?.bottom ?? 0) + gap - 1,
            ),
          detail,
        );
      } else {
        const span = spans[0];
        const hidden = g.pages.filter((box) => box.hidden);
        check(
          `${label}: one row shown, centered, its neighbors mounted but hidden`,
          rowList.length === 1 &&
            g.shown !== null &&
            shown.length === (spread === "none" ? 1 : 2) &&
            hidden.length >= 2 &&
            sideBySide &&
            span !== undefined &&
            near(span.left, g.clientWidth - span.right) &&
            near(span.top, g.clientHeight - span.bottom) &&
            g.scrollWidth === g.clientWidth &&
            g.scrollHeight === g.clientHeight,
          `${detail}; ${hidden.length} hidden; scroll ${g.scrollWidth}x${g.scrollHeight}`,
        );
      }
      check(`${label}: no errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.context().close();
    }
  }

  // --- The current page, zooming around a point, mode switches, and fits ---
  for (const mode of MODES) {
    const { page, errors } = await open(launched.browser, demo(`scroll=${mode}&scale=1`));
    // The current page is the one at the viewport's center.
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(3));
    await frames(page);
    let g = await geometry(page);
    const page4 = g.pages.find((box) => box.index === 3);
    check(
      `${mode}: goToPage shows the page from its start and makes it current`,
      page4 !== undefined &&
        !page4.hidden &&
        inView(g, page4) &&
        (mode === "horizontal" ? near(page4.left, g.gap) : near(page4.top, g.gap)) &&
        g.currentPage === 3,
      `current ${g.currentPage}, page 4 ${page4 ? round(page4) : "unmounted"}`,
    );

    // Zoom around the middle of the part of page 4 in view: that point stays put.
    if (page4) {
      const left = Math.max(0, page4.left);
      const top = Math.max(0, page4.top);
      const right = Math.min(g.clientWidth, page4.left + page4.width);
      const bottom = Math.min(g.clientHeight, page4.top + page4.height);
      const anchor = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const share = {
        x: (anchor.x - page4.left) / page4.width,
        y: (anchor.y - page4.top) / page4.height,
      };
      await page.evaluate(
        ([scale, point]) => (window as unknown as Demo).__viewer?.setScale(scale, point),
        [g.scale * 1.25, anchor] as const,
      );
      await frames(page);
      g = await geometry(page);
      const after = g.pages.find((box) => box.index === 3);
      const moved = after
        ? Math.hypot(
            after.left + share.x * after.width - anchor.x,
            after.top + share.y * after.height - anchor.y,
          )
        : Number.POSITIVE_INFINITY;
      check(
        `${mode}: zooming keeps the point under the anchor`,
        moved < 2,
        `moved ${moved.toFixed(1)} px; page 4 ${after ? round(after) : "unmounted"}`,
      );
    }

    // Fit the page at the center to the viewport.
    await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale("fit-width"));
    await frames(page);
    g = await geometry(page);
    const fitted = g.pages.find((box) => box.index === g.currentPage);
    check(
      `${mode}: "fit-width" fits the current page's width`,
      fitted !== undefined && near(fitted.width + 2 * g.gap, g.clientWidth),
      fitted ? `${round(fitted)} in ${g.clientWidth}` : "unmounted",
    );
    await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale("fit-page"));
    await frames(page);
    g = await geometry(page);
    const whole = g.pages.find((box) => box.index === g.currentPage);
    check(
      `${mode}: "fit-page" fits all of the current page, in view`,
      whole !== undefined &&
        whole.width + 2 * g.gap <= g.clientWidth + 1 &&
        whole.height + 2 * g.gap <= g.clientHeight + 1 &&
        (near(whole.width + 2 * g.gap, g.clientWidth) ||
          near(whole.height + 2 * g.gap, g.clientHeight)) &&
        whole.left >= 0 &&
        whole.top >= 0 &&
        whole.left + whole.width <= g.clientWidth &&
        whole.top + whole.height <= g.clientHeight,
      whole ? `${round(whole)} in ${g.clientWidth}x${g.clientHeight}` : "unmounted",
    );

    // Search scrolls a match into view: on page 5, "Mixed sizes marker 5".
    await page.evaluate(() => {
      (window as unknown as Demo).__viewer?.setScale(0.5);
      (window as unknown as Demo).__viewer?.goToPage(0);
      (window as unknown as Demo).__viewer?.search("marker 5");
    });
    await page.waitForFunction(
      () => (window as unknown as Demo).__viewer?.store.get().search.status === "done",
    );
    await settle(page);
    const match = await page.evaluate(() => {
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      const origin = scroller.getBoundingClientRect();
      const span = [
        ...document.querySelectorAll('section[data-page="5"] .parapdf-text-layer span'),
      ].find((element) => element.textContent?.includes("marker 5"));
      const rect = span?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left - origin.left - scroller.clientLeft,
            top: rect.top - origin.top - scroller.clientTop,
          }
        : null;
    });
    g = await geometry(page);
    check(
      `${mode}: search scrolls the match into view${mode === "horizontal" ? ", in the left third" : ""}`,
      match !== null &&
        match.left >= 0 &&
        match.left < g.clientWidth &&
        match.top >= 0 &&
        match.top < g.clientHeight &&
        (mode !== "horizontal" || near(match.left, g.clientWidth / 3, 3)) &&
        (mode === "page" ? g.shown?.first === 4 : true),
      `${JSON.stringify(match)} in ${g.clientWidth}x${g.clientHeight}`,
    );
    await page.evaluate(() => (window as unknown as Demo).__viewer?.search(""));

    // Every other mode keeps the current page in view.
    for (const next of MODES.filter((other) => other !== mode)) {
      await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(5));
      await frames(page);
      const before = (await geometry(page)).currentPage;
      await page.evaluate(
        (other) => (window as unknown as Demo).__viewer?.setScrollMode(other),
        next,
      );
      await frames(page);
      g = await geometry(page);
      const kept = g.pages.find((box) => box.index === before);
      check(
        `${mode} to ${next}: the current page stays current and in view`,
        g.currentPage === before && kept !== undefined && !kept.hidden && inView(g, kept),
        `page ${before + 1} before, ${g.currentPage + 1} after; ${kept ? round(kept) : "unmounted"}`,
      );
      await page.evaluate(
        (back) => (window as unknown as Demo).__viewer?.setScrollMode(back),
        mode,
      );
      await frames(page);
    }
    check(
      `${mode}: no errors while zooming, fitting, and searching`,
      errors.length === 0,
      errors.slice(0, 3).join(" | "),
    );
    await page.context().close();
  }

  // --- Wrapped rows fill a resized viewport again ---
  {
    const { page, errors } = await open(launched.browser, demo("scroll=wrapped&scale=0.5"));
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(5));
    await frames(page);
    const before = await geometry(page);
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(200);
    await frames(page);
    const after = await geometry(page);
    const perRow = (g: Geometry) =>
      Math.max(...g.rowFirst.map((first) => g.rowFirst.filter((other) => other === first).length));
    const current = after.pages.find((box) => box.index === before.currentPage);
    check(
      "wrapped: a narrower viewport puts fewer pages in a row and keeps the current page in view",
      perRow(after) < perRow(before) &&
        current !== undefined &&
        inView(after, current) &&
        after.pages.every((box) => box.left >= -1 && box.left + box.width <= after.clientWidth + 1),
      `${perRow(before)} then ${perRow(after)} per row; page ${before.currentPage + 1} ${current ? round(current) : "unmounted"}`,
    );
    check("wrapped: no errors while resizing", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- Flipping pages in "page" mode ---
  for (const spread of ["none", "odd"] as const) {
    const { page, errors } = await open(
      launched.browser,
      demo(`scroll=page&spread=${spread}&scale=fit-page`),
    );
    const step = spread === "none" ? 1 : 2;
    const shownFirst = async () => (await geometry(page)).shown?.first ?? -1;
    const scroller = page.locator(".parapdf-viewport");
    await scroller.focus();
    await settle(page);
    // The row after the one shown is drawn before a flip shows it.
    const drawnAhead = await page.evaluate(
      (next) => (window as unknown as Demo).__viewer?.hasPixels(next) === true,
      step,
    );
    check(
      `page${spread === "odd" ? ", odd spreads" : ""}: the next row is drawn before it shows`,
      drawnAhead,
    );
    const flips: string[] = [];
    // Arrows scroll a row wider than the viewport to its edge before they flip.
    const press = async (key: string) => {
      const before = await shownFirst();
      for (let attempt = 0; attempt < 40 && (await shownFirst()) === before; attempt++) {
        await page.keyboard.press(key);
        await still(page);
      }
      await frames(page);
      const after = await page.evaluate(() => {
        const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
        const viewer = (window as unknown as Demo).__viewer as unknown as {
          store: { get(): { currentPage: number } };
        };
        return `scroll ${scroller.scrollLeft},${scroller.scrollTop} of ${scroller.scrollWidth}x${scroller.scrollHeight} in ${scroller.clientWidth}x${scroller.clientHeight}, current ${viewer.store.get().currentPage}`;
      });
      flips.push(`${key} ${await shownFirst()} (${after})`);
      return shownFirst();
    };
    const keys =
      (await press("PageDown")) === step &&
      (await press("ArrowRight")) === 2 * step &&
      (await press("ArrowDown")) === 3 * step &&
      (await press("PageUp")) === 2 * step &&
      (await press("ArrowLeft")) === step &&
      (await press("End")) === (spread === "none" ? 7 : 6) &&
      (await press("Home")) === 0;
    check(
      `page${spread === "odd" ? ", odd spreads" : ""}: keys flip whole rows`,
      keys,
      flips.join(", "),
    );
    await page.getByRole("button", { name: "Next page" }).click();
    await frames(page);
    const viaButton = await shownFirst();
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(5));
    await frames(page);
    const viaGoTo = await geometry(page);
    check(
      `page${spread === "odd" ? ", odd spreads" : ""}: the next-page button and goToPage flip too`,
      viaButton === step &&
        viaGoTo.shown !== null &&
        viaGoTo.shown.first <= 5 &&
        viaGoTo.shown.last >= 5 &&
        viaGoTo.pages
          .filter((box) => !box.hidden)
          .every(
            (box) =>
              box.index >= (viaGoTo.shown?.first ?? 0) && box.index <= (viaGoTo.shown?.last ?? 0),
          ),
      `button ${viaButton}, goToPage(5) shows ${JSON.stringify(viaGoTo.shown)}`,
    );
    check(
      `page${spread === "odd" ? ", odd spreads" : ""}: no errors while flipping`,
      errors.length === 0,
      errors.slice(0, 3).join(" | "),
    );
    await page.context().close();
  }

  // --- A zoomed page scrolls within itself before keys flip it ---
  {
    const { page, errors } = await open(launched.browser, demo("scroll=page&scale=2&page=2"));
    const scroller = page.locator(".parapdf-viewport");
    await scroller.focus();
    let g = await geometry(page);
    const start = g.shown?.first;
    // The wheel scrolls to the page's end and no further.
    const box = await scroller.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let turn = 0; turn < 8; turn++) await page.mouse.wheel(0, 1000);
    await still(page);
    await frames(page);
    g = await geometry(page);
    check(
      "page, zoomed: the wheel scrolls within the page and does not flip it",
      g.shown?.first === start &&
        g.scrollHeight > g.clientHeight &&
        near(g.scrollTop, g.scrollHeight - g.clientHeight),
      `shows ${JSON.stringify(g.shown)}, scrolled ${g.scrollTop} of ${g.scrollHeight - g.clientHeight}`,
    );
    await page.evaluate(() => {
      (document.querySelector(".parapdf-viewport") as HTMLElement).scrollTop = 0;
    });
    await still(page);
    await page.keyboard.press("PageDown");
    await still(page);
    g = await geometry(page);
    const scrolled = g.shown?.first === start && g.scrollTop > 0;
    let presses = 0;
    while ((await geometry(page)).shown?.first === start && presses < 20) {
      await page.keyboard.press("PageDown");
      await still(page);
      presses++;
    }
    await frames(page);
    g = await geometry(page);
    check(
      "page, zoomed: PageDown scrolls down the page first, then flips to the next page's top",
      scrolled && g.shown?.first === (start ?? 0) + 1 && g.scrollTop === 0,
      `after ${presses + 1} presses shows ${JSON.stringify(g.shown)} at ${g.scrollTop}`,
    );
    await page.keyboard.press("PageUp");
    await still(page);
    await frames(page);
    g = await geometry(page);
    check(
      "page, zoomed: PageUp at the top flips back to the previous page's bottom",
      g.shown?.first === start && near(g.scrollTop, g.scrollHeight - g.clientHeight),
      `shows ${JSON.stringify(g.shown)} at ${g.scrollTop} of ${g.scrollHeight - g.clientHeight}`,
    );
    check("page, zoomed: no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
