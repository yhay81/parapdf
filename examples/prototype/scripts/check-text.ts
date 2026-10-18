/**
 * Functional checks for the text layer: selection, search highlights,
 * normalization, and accessibility semantics. Exits non-zero on failure.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:text
 * SCREENSHOT=path.png saves the search view for visual review.
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function openViewer(page: Page, baseUrl: string, file: string): Promise<void> {
  await page.goto(`${baseUrl}?engine=${engine}&file=${file}`);
  await page.waitForSelector('section[data-page="1"] .parapdf-text-layer span', {
    timeout: 30_000,
  });
}

async function searchFor(page: Page, query: string): Promise<{ total: number; summary: string }> {
  const input = page.getByRole("searchbox", { name: "Find in document" });
  await input.fill(query);
  await input.press("Enter");
  await page.waitForFunction(
    () => {
      const viewer = (window as { __viewer?: { store: { get(): { search: { status: string } } } } })
        .__viewer;
      return viewer?.store.get().search.status === "done";
    },
    undefined,
    { timeout: 60_000 },
  );
  // Let the selected match's page build its text layer and highlights.
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const viewer = (
      window as { __viewer?: { store: { get(): { search: { matches: unknown[] } } } } }
    ).__viewer;
    return {
      total: viewer?.store.get().search.matches.length ?? 0,
      summary: document.querySelector(".search-summary")?.textContent ?? "",
    };
  });
}

const currentHighlightText = (page: Page) =>
  page.evaluate(() => {
    const highlight = CSS.highlights.get("parapdf-search-current");
    const [range] = highlight ? [...highlight] : [];
    return range instanceof Range ? range.toString() : null;
  });

interface TextLine {
  top: number;
  height: number;
  left: number;
  right: number;
  /** Non-space characters. */
  chars: number;
}

/** A page's box and the lines of its text layer, top to bottom, in viewport coordinates. */
const pageLines = (page: Page, pageNumber: number) =>
  page.evaluate((pageNumber) => {
    const section = document.querySelector(`section[data-page="${pageNumber}"]`);
    const lines: TextLine[] = [];
    for (const span of section?.querySelectorAll(".parapdf-text-layer span") ?? []) {
      const chars = (span.textContent ?? "").replace(/\s/g, "").length;
      if (chars === 0) continue;
      const rect = span.getBoundingClientRect();
      const line = lines.find((entry) => Math.abs(entry.top - rect.top) < rect.height / 2);
      if (line) {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.chars += chars;
      } else {
        lines.push({
          top: rect.top,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          chars,
        });
      }
    }
    lines.sort((a, b) => a.top - b.top);
    const box = section?.getBoundingClientRect();
    return {
      lines,
      top: box?.top ?? 0,
      bottom: box?.bottom ?? 0,
      left: box?.left ?? 0,
      right: box?.right ?? 0,
    };
  }, pageNumber);

const count = (lines: TextLine[], from: number, to?: number): number =>
  lines.slice(from, to).reduce((sum, line) => sum + line.chars, 0);

const middle = (line: TextLine): number => line.top + line.height / 2;

const selectedChars = (page: Page) =>
  page.evaluate(() => (window.getSelection()?.toString() ?? "").replace(/\s/g, "").length);

interface ViewerProbe {
  scroller: HTMLElement | null;
  store: { get(): { scale: number; layout: { tops: number[] } | null } };
}

/** Scrolls the boundary between pages 1 and 2 to the middle of the viewport. */
async function centerFirstBoundary(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = (window as { __viewer?: ViewerProbe }).__viewer;
    const scroller = viewer?.scroller;
    const top = viewer?.store.get().layout?.tops[1];
    if (scroller && top !== undefined) scroller.scrollTop = top - scroller.clientHeight / 2;
  });
  for (const pageNumber of [1, 2]) {
    await page.waitForSelector(
      `section[data-page="${pageNumber}"] .parapdf-text-layer .endOfContent`,
      { state: "attached", timeout: 30_000 },
    );
  }
}

/** A page's lines once two measurements a quarter second apart agree, as after a zoom. */
async function settledLines(page: Page, pageNumber: number) {
  let lines = await pageLines(page, pageNumber);
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(250);
    const next = await pageLines(page, pageNumber);
    if (JSON.stringify(next) === JSON.stringify(lines)) break;
    lines = next;
  }
  return lines;
}

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4185, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4185/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const errors: string[] = [];
// Each document gets a fresh context, like a first visit. On a second visit
// in the same context WebKit refused pdf.js's module workers under COEP,
// apparently when taken from its cache, and pdf.js silently parsed on the
// main thread.
const newPage = async (): Promise<Page> => {
  const context = await launched.browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
};
let page = await newPage();

try {
  // Selection and semantics on a born-digital document.
  await openViewer(page, baseUrl, "bill-hr815.pdf");
  const semantics = await page.evaluate(() => ({
    viewport: {
      role: document.querySelector(".parapdf-viewport")?.getAttribute("role"),
      tabIndex: (document.querySelector(".parapdf-viewport") as HTMLElement | null)?.tabIndex,
      label: document.querySelector(".parapdf-viewport")?.getAttribute("aria-label"),
    },
    firstPageLabel: document.querySelector('section[data-page="1"]')?.getAttribute("aria-label"),
    canvasesHidden: [...document.querySelectorAll("section[data-page] canvas")].every(
      (canvas) => canvas.parentElement?.getAttribute("aria-hidden") === "true",
    ),
    textRuns: document.querySelectorAll('section[data-page="1"] .parapdf-text-layer span').length,
    textContent: document
      .querySelector('section[data-page="1"] .parapdf-text-layer')
      ?.textContent?.slice(0, 400),
  }));
  check(
    "viewport is a focusable, labelled document",
    semantics.viewport.role === "document" &&
      semantics.viewport.tabIndex === 0 &&
      semantics.viewport.label === "PDF document",
  );
  check(
    "pages are labelled regions",
    semantics.firstPageLabel === "Page 1 of 110",
    String(semantics.firstPageLabel),
  );
  check("canvases are hidden from assistive technology", semantics.canvasesHidden);
  check(
    "page 1 exposes its text",
    semantics.textRuns > 20 && /Making emergency supplemental/.test(semantics.textContent ?? ""),
    `${semantics.textRuns} runs`,
  );

  // Drag-select a line with the mouse, as a user would.
  const run = page
    .locator('section[data-page="1"] .parapdf-text-layer span', { hasText: "Making emergency" })
    .first();
  const box = await run.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  check(
    "mouse drag selects text",
    /Making emergency supplemental/.test(selected),
    JSON.stringify(selected.slice(0, 60)),
  );

  // Search across the whole document and land on the first match.
  const israel = await searchFor(page, "israel");
  check("search finds matches across pages", israel.total > 5, `${israel.total} matches`);
  check(
    "the selected match is highlighted",
    (await currentHighlightText(page))?.toLowerCase() === "israel",
  );
  check("result count is announced", /^1 of \d+$/.test(israel.summary), israel.summary);
  await page.getByRole("searchbox", { name: "Find in document" }).press("Enter");
  await page.waitForTimeout(800);
  const second = await page.evaluate(() => {
    const viewer = (window as { __viewer?: { store: { get(): { search: { current: number } } } } })
      .__viewer;
    return viewer?.store.get().search.current;
  });
  check("Enter moves to the next match", second === 1, `current=${second}`);
  check(
    "the next match is highlighted",
    (await currentHighlightText(page))?.toLowerCase() === "israel",
  );
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

  // Page 1 breaks "divi-" / "sions" across lines; the hyphen and line end
  // must not keep the word from matching.
  const divisions = await searchFor(page, "divisions");
  check(
    "a word hyphenated across lines matches",
    divisions.total === 3,
    `${divisions.total} matches for divisions, 3 expected`,
  );

  // Japanese text in a non-embedded CID font, plus compatibility normalization.
  page = await newPage();
  await openViewer(page, baseUrl, "synthetic-cjk-nonembedded.pdf");
  const japanese = await searchFor(page, "非埋め込み");
  check("Japanese search", japanese.total >= 6, `${japanese.total} matches`);
  check("Japanese match is highlighted", (await currentHighlightText(page)) === "非埋め込み");
  const fullWidth = await searchFor(page, "ＣＭａｐ");
  check(
    "full-width query matches ASCII text",
    fullWidth.total >= 6,
    `${fullWidth.total} matches for ＣＭａｐ`,
  );

  // Japanese has no spaces, so a line can end inside a word: page 1 of the
  // MHLW notice breaks 厚生労働 after 厚生, its only occurrence.
  page = await newPage();
  await openViewer(page, baseUrl, "mhlw-doc.pdf");
  const kosei = await searchFor(page, "厚生労働");
  check(
    "a Japanese word broken across lines matches",
    kosei.total === 1 && (await currentHighlightText(page)) === "厚生労働",
    `${kosei.total} matches, highlighted ${JSON.stringify(await currentHighlightText(page))}`,
  );

  // Page 24 of the LaTeX guide shows ßüé; a query without the diacritics finds it.
  page = await newPage();
  await openViewer(page, baseUrl, "usrguide.pdf");
  const diacritics = await searchFor(page, "ßue");
  check(
    "a query without diacritics matches letters with them",
    diacritics.total === 5 && (await currentHighlightText(page)) === "ßüé",
    `${diacritics.total} matches, highlighted ${JSON.stringify(await currentHighlightText(page))}`,
  );

  // Dragging into the blank space past a line's end must select the dragged
  // lines, not the rest of the page: WebKit extended such a selection to the
  // text layer's .endOfContent element while that element was selectable.
  page = await newPage();
  await openViewer(page, baseUrl, "synthetic-text-1000.pdf");
  const first = await pageLines(page, 1);
  const fifth = first.lines[4];
  const ninth = first.lines[8];
  const drag =
    fifth && ninth
      ? {
          start: { x: fifth.left + 1, y: middle(fifth) },
          end: { x: Math.min(first.right - 20, ninth.right + 120), y: middle(ninth) },
          min: count(first.lines, 4, 7),
          max: count(first.lines, 4, 10),
        }
      : null;
  if (drag) {
    await page.mouse.move(drag.start.x, drag.start.y);
    await page.mouse.down();
    await page.mouse.move(drag.end.x, drag.end.y, { steps: 20 });
    await page.mouse.up();
  }
  const dragged = await selectedChars(page);
  check(
    "dragging past a line's end selects only the dragged lines",
    drag !== null && dragged >= drag.min && dragged <= drag.max,
    `${dragged} characters; lines 5–7 hold ${drag?.min}, lines 5–10 hold ${drag?.max}`,
  );

  // Drags between pages 1 and 2 must not jump across either page. Over the
  // gap between the pages, WebKit and Firefox put the selection's end at the
  // start of the first mounted page; over page 2's blank space, WebKit
  // extended the selection to page 2's end; and over page 1's, entered from
  // below, WebKit and Firefox put the selection's end at page 1's start.
  await centerFirstBoundary(page);
  const upper = await pageLines(page, 1);
  const lower = await pageLines(page, 2);
  const pressed = upper.lines.at(-3);
  const target = lower.lines[1];
  const cross =
    pressed && target
      ? {
          start: { x: pressed.left + 1, y: middle(pressed) },
          end: { x: Math.min(lower.right - 20, target.right + 120), y: middle(target) },
          rest: count(upper.lines, -3),
          next: count(lower.lines, 0, 2),
        }
      : null;
  let inGap = -1;
  let across = -1;
  if (cross) {
    await page.mouse.move(cross.start.x, cross.start.y);
    await page.mouse.down();
    await page.mouse.move((cross.start.x + cross.end.x) / 2, (upper.bottom + lower.top) / 2, {
      steps: 10,
    });
    inGap = await selectedChars(page);
    await page.mouse.move(cross.end.x, cross.end.y, { steps: 10 });
    await page.mouse.up();
    across = await selectedChars(page);
  }
  check(
    "a drag selection holds over the gap between pages",
    cross !== null && inGap > 0 && inGap <= cross.rest,
    `${inGap} characters; page 1 holds ${cross?.rest} from the pressed line on`,
  );
  check(
    "dragging across the gap between pages selects only the dragged lines",
    cross !== null && across >= cross.rest && across <= cross.rest + cross.next,
    `${across} characters; page 1 holds ${cross?.rest} from the pressed line on, page 2's first two lines ${cross?.next}`,
  );

  // Upward, from the end of page 2's third line into the blank space below
  // page 1's last line: page 2's first three lines, and at most page 1's
  // last line, which Chromium selects up to the pointer.
  const lifted = lower.lines[2];
  const last = upper.lines.at(-1);
  const up =
    lifted && last
      ? {
          start: { x: lifted.right - 1, y: middle(lifted) },
          x: (last.left + last.right) / 2,
          end: last.top + last.height + 20,
          min: count(lower.lines, 0, 3),
          last: last.chars,
        }
      : null;
  let upward = -1;
  if (up) {
    await page.mouse.move(up.start.x, up.start.y);
    await page.mouse.down();
    await page.mouse.move(up.x, (upper.bottom + lower.top) / 2, { steps: 10 });
    await page.mouse.move(up.x, up.end, { steps: 5 });
    await page.mouse.up();
    upward = await selectedChars(page);
  }
  check(
    "dragging up across the gap between pages selects only the dragged lines",
    up !== null && upward >= up.min && upward <= up.min + up.last,
    `${upward} characters; page 2's first three lines hold ${up?.min}, page 1's last line ${up?.last}`,
  );

  // Drags that start beside a page or in the gap between pages must start at
  // the nearest text. That space belongs to the element that holds the
  // absolutely positioned pages, and all three browsers started a selection
  // pressed there at the start of the first mounted page: 3,357 characters
  // for the drag from beside page 1. Zooming out twice leaves room beside the
  // pages.
  for (let i = 0; i < 2; i++) {
    const before = await page.evaluate(
      () => (window as { __viewer?: ViewerProbe }).__viewer?.store.get().scale ?? 0,
    );
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForFunction(
      (before) =>
        ((window as { __viewer?: ViewerProbe }).__viewer?.store.get().scale ?? 0) < before,
      before,
    );
  }
  await centerFirstBoundary(page);
  const narrowUpper = await settledLines(page, 1);
  const narrowLower = await settledLines(page, 2);
  const besideLine = narrowUpper.lines.at(-3);
  let beside = -1;
  if (besideLine) {
    const y = middle(besideLine);
    await page.mouse.move(narrowUpper.left - 40, y);
    await page.mouse.down();
    await page.mouse.move(besideLine.right - 1, y, { steps: 10 });
    await page.mouse.up();
    beside = await selectedChars(page);
  }
  check(
    "a drag that starts beside a page selects from the nearest line",
    besideLine !== undefined && beside === besideLine.chars,
    `${beside} characters; the line holds ${besideLine?.chars}`,
  );

  // From the middle of the gap down to the end of page 2's second line, where
  // WebKit and Firefox selected 3,566 characters from the start of page 1.
  const gapTarget = narrowLower.lines[1];
  let fromGap = -1;
  if (gapTarget) {
    await page.mouse.move(
      (narrowUpper.left + narrowUpper.right) / 2,
      (narrowUpper.bottom + narrowLower.top) / 2,
    );
    await page.mouse.down();
    await page.mouse.move(gapTarget.right - 1, middle(gapTarget), { steps: 10 });
    await page.mouse.up();
    fromGap = await selectedChars(page);
  }
  const gapExpected = count(narrowLower.lines, 0, 2);
  check(
    "a drag that starts between pages selects from the page boundary",
    gapTarget !== undefined && fromGap === gapExpected,
    `${fromGap} characters; page 2's first two lines hold ${gapExpected}`,
  );

  // Out of the page sideways, from the line's start to beside the page:
  // Chromium put the selection's end at the start of the page, 3,308
  // characters back. A press on selected text would drag that text instead,
  // so nothing is selected first.
  let sideways = -1;
  if (besideLine) {
    const y = middle(besideLine);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(besideLine.left + 1, y);
    await page.mouse.down();
    await page.mouse.move(narrowUpper.right + 40, y, { steps: 10 });
    await page.mouse.up();
    sideways = await selectedChars(page);
  }
  check(
    "a drag selection holds beside a page",
    besideLine !== undefined && sideways > 0 && sideways <= besideLine.chars,
    `${sideways} characters; the line holds ${besideLine?.chars}`,
  );

  // A click beside a page still clears the selection.
  if (besideLine) await page.mouse.click(narrowUpper.left - 40, middle(besideLine));
  const afterClick = await selectedChars(page);
  check(
    "a click beside a page clears the selection",
    sideways > 0 && afterClick === 0,
    `${afterClick} characters selected after the click`,
  );

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
