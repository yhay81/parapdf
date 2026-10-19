/**
 * Functional checks for the text layer: selection, search highlights,
 * normalization, accessibility semantics including the text's language, and
 * text runs ending on their glyphs on English and Japanese pages and after
 * zooming. Exits non-zero on failure.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:text
 * SCREENSHOT=path.png saves the search view for visual review.
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

/** Opens `file` in the demo; `query` adds parameters such as `&lang=ja`. */
async function openViewer(page: Page, baseUrl: string, file: string, query = ""): Promise<void> {
  await page.goto(`${baseUrl}?engine=${engine}&file=${file}${query}`);
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

interface RunOffsets {
  /** Text runs compared with pdf.js's own glyph boxes. */
  runs: number;
  /** Largest and mean horizontal distance between a run's ends and its glyphs, in PDF points. */
  worst: number;
  mean: number;
  /** The CSS scale the page's text layer follows its zoom with, "" when laid out for it. */
  cssScale: string;
}

/**
 * How far the text runs of page `number` sit from the glyphs pdf.js draws:
 * the left and right ends of each run of two or more characters against the
 * item's origin and width.
 */
const runOffsets = (page: Page, number: number): Promise<RunOffsets> =>
  page.evaluate(async (number) => {
    interface Item {
      str?: string;
      transform: number[];
      width: number;
    }
    const state = window as unknown as {
      __viewer: { store: { get(): { layout: { scale: number } } } };
      __pdfDocument: {
        getPage(number: number): Promise<{
          getViewport(options: { scale: number }): {
            convertToViewportPoint(x: number, y: number): number[];
          };
          getTextContent(options: object): Promise<{ items: Item[] }>;
        }>;
      };
    };
    const { scale } = state.__viewer.store.get().layout;
    const pdfPage = await state.__pdfDocument.getPage(number);
    const viewport = pdfPage.getViewport({ scale });
    const { items } = await pdfPage.getTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    const section = document.querySelector(`section[data-page="${number}"]`);
    const origin = section?.getBoundingClientRect().left ?? 0;
    const spans = [
      ...(section?.querySelectorAll(".parapdf-text-layer span:not(.markedContent)") ?? []),
    ];
    let cursor = 0;
    let worst = 0;
    let sum = 0;
    let runs = 0;
    for (const item of items) {
      if (!item.str || item.str.length < 2) continue;
      while (cursor < spans.length && spans[cursor]?.textContent !== item.str) cursor++;
      const rect = spans[cursor++]?.getBoundingClientRect();
      if (!rect) break;
      const [x = 0] = viewport.convertToViewportPoint(
        item.transform[4] ?? 0,
        item.transform[5] ?? 0,
      );
      const left = rect.left - origin;
      const offset =
        Math.max(Math.abs(left - x), Math.abs(left + rect.width - (x + item.width * scale))) /
        scale;
      worst = Math.max(worst, offset);
      sum += offset;
      runs++;
    }
    const layer = section?.querySelector<HTMLElement>(".parapdf-text-layer");
    return { runs, worst, mean: runs ? sum / runs : 0, cssScale: layer?.style.scale ?? "" };
  }, number);

const describe = (offsets: RunOffsets | undefined) =>
  offsets
    ? `${offsets.runs} runs, worst ${offsets.worst.toFixed(2)} pt, mean ${offsets.mean.toFixed(2)} pt${offsets.cssScale ? `, CSS scale ${Number(offsets.cssScale).toFixed(2)}` : ""}`
    : "not measured";

/**
 * Whether a page's runs end on their glyphs: within 3 points, a quarter of a
 * 12-point em, and half a point on average. Chromium places runs laid out at
 * small zooms up to 2.4 points off.
 */
const onGlyphs = (offsets: RunOffsets | undefined) =>
  offsets !== undefined && offsets.runs > 20 && offsets.worst <= 3 && offsets.mean <= 0.5;

/** The `lang` attribute of page `number`'s text layer. */
const textLanguage = (page: Page, number: number) =>
  page.evaluate(
    (number) =>
      document
        .querySelector(`section[data-page="${number}"] .parapdf-text-layer`)
        ?.getAttribute("lang") ?? null,
    number,
  );

interface TextLine {
  top: number;
  height: number;
  left: number;
  right: number;
  /** Non-space characters. */
  chars: number;
}

/**
 * A page's box, the right and bottom edges of its text layer, and the lines of
 * that layer, top to bottom, in viewport coordinates.
 */
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
    const text = section?.querySelector(".parapdf-text-layer")?.getBoundingClientRect();
    return {
      lines,
      top: box?.top ?? 0,
      bottom: box?.bottom ?? 0,
      left: box?.left ?? 0,
      right: box?.right ?? 0,
      textRight: text?.right ?? 0,
      textBottom: text?.bottom ?? 0,
    };
  }, pageNumber);

const count = (lines: TextLine[], from: number, to?: number): number =>
  lines.slice(from, to).reduce((sum, line) => sum + line.chars, 0);

const middle = (line: TextLine): number => line.top + line.height / 2;

const selectedChars = (page: Page) =>
  page.evaluate(() => (window.getSelection()?.toString() ?? "").replace(/\s/g, "").length);

interface Point {
  x: number;
  y: number;
}

/**
 * Moves the mouse in a straight line to `to` through whole pixels, at most a
 * pixel along each axis per move, and runs `step` after each move.
 */
async function moveInPixelSteps(
  page: Page,
  from: Point,
  to: Point,
  step?: () => Promise<void>,
): Promise<void> {
  const x = Math.round(from.x);
  const y = Math.round(from.y);
  const dx = Math.round(to.x) - x;
  const dy = Math.round(to.y) - y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + Math.round((dx * i) / steps), y + Math.round((dy * i) / steps));
    await step?.();
  }
}

interface ViewerProbe {
  scroller: HTMLElement | null;
  store: { get(): { scale: number; layout: { tops: number[] } | null } };
  setScale(scale: number): void;
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
  await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
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
  // bill-hr815 declares no language, so its text keeps the page's.
  const inherited = await textLanguage(page, 1);
  check(
    "text of a PDF without a language takes the page's",
    inherited === "en",
    `lang ${JSON.stringify(inherited)}`,
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

  // pdf.js sizes each run by measuring it on a canvas in the text content's
  // language. Runs drawn in another language's fonts end short of or past
  // their glyphs: in Firefox on a Japanese system, which resolves an unknown
  // language to the system's, runs of this PDF, which declares none, ended
  // 12–15% short, up to 49 points on page 1 and 53 on page 2, until text
  // layers took the language pdf.js measures in.
  await page.waitForSelector('section[data-page="2"] .parapdf-text-layer span', {
    timeout: 30_000,
  });
  const fitted = [await runOffsets(page, 1), await runOffsets(page, 2)];
  check(
    "text runs end on their glyphs",
    fitted.every(onGlyphs),
    `page 1: ${describe(fitted[0])}; page 2: ${describe(fitted[1])}`,
  );

  // Zooming scales laid-out text layers with CSS. Zooming in 3× lays page 1,
  // in view, out again at the new zoom, while page 2, outside the viewport,
  // keeps its layout under a CSS scale. Either way the runs must stay on the
  // glyphs pdf.js draws.
  const fitScale = await page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: {
          store: { get(): { scale: number } };
          setScale(scale: number, anchor: { x: number; y: number }): void;
        };
      }
    ).__viewer;
    const scale = viewer.store.get().scale;
    viewer.setScale(scale * 3, { x: 0, y: 0 });
    return scale;
  });
  await page.waitForTimeout(1200);
  const zoomed = [await runOffsets(page, 1), await runOffsets(page, 2)];
  const aligned = zoomed.every((after, index) => {
    const before = fitted[index];
    return (
      before !== undefined &&
      before.runs > 20 &&
      after.runs === before.runs &&
      after.worst <= before.worst + 0.25 &&
      after.mean <= before.mean + 0.1
    );
  });
  check(
    "text runs stay on their glyphs after zooming in 3×",
    aligned,
    `page 1: ${describe(fitted[0])} -> ${describe(zoomed[0])}; page 2: ${describe(fitted[1])} -> ${describe(zoomed[1])}`,
  );
  await page.evaluate((scale) => {
    (
      window as unknown as {
        __viewer: { setScale(scale: number, anchor: { x: number; y: number }): void };
      }
    ).__viewer.setScale(scale, { x: 0, y: 0 });
  }, fitScale);
  await page.waitForTimeout(800);

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

  // On a Japanese page the same PDF's text takes Japanese, whose generic
  // fonts are wider. Chromium and WebKit resolve an unknown language to
  // their default fonts, so before text layers took the language pdf.js
  // measures in, they drew these runs 14–18% too wide, up to 57 points.
  page = await newPage();
  await openViewer(page, baseUrl, "bill-hr815.pdf", "&lang=ja");
  // The scheduler appends .endOfContent once the layer holds every run.
  await page.waitForSelector('section[data-page="1"] .parapdf-text-layer .endOfContent', {
    state: "attached",
  });
  const onJapanesePage = await runOffsets(page, 1);
  const japanesePageLanguage = await textLanguage(page, 1);
  check(
    "text runs on a Japanese page end on their glyphs",
    japanesePageLanguage === "ja" && onGlyphs(onJapanesePage),
    `lang ${JSON.stringify(japanesePageLanguage)}, ${describe(onJapanesePage)}`,
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
  // The notice declares Japanese (/Lang ja), so assistive technology reads
  // its text as Japanese on this English page.
  const declared = await textLanguage(page, 1);
  check(
    "text takes the language the PDF declares",
    declared === "ja",
    `lang ${JSON.stringify(declared)}`,
  );
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
  // The drag crosses line 9's text before it leaves past the line's end:
  // over blank space Firefox keeps the selection's end where the pointer last
  // touched text, and a straight drag from line 5 slipped between the boxes
  // of lines 7 and 8 by a tenth of a pixel once Firefox's runs had their full
  // width.
  page = await newPage();
  await openViewer(page, baseUrl, "synthetic-text-1000.pdf");
  const first = await pageLines(page, 1);
  const fifth = first.lines[4];
  const ninth = first.lines[8];
  const drag =
    fifth && ninth
      ? {
          start: { x: fifth.left + 1, y: middle(fifth) },
          via: { x: (ninth.left + ninth.right) / 2, y: middle(ninth) },
          end: { x: Math.min(first.right - 20, ninth.right + 120), y: middle(ninth) },
          min: count(first.lines, 4, 7),
          max: count(first.lines, 4, 10),
        }
      : null;
  if (drag) {
    await page.mouse.move(drag.start.x, drag.start.y);
    await page.mouse.down();
    await page.mouse.move(drag.via.x, drag.via.y, { steps: 12 });
    await page.mouse.move(drag.end.x, drag.end.y, { steps: 8 });
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

  // The same drag without a pause: one move onto page 2's first line, then
  // one straight into page 1's margin. Re-inserting page 1's .endOfContent at
  // every selectionchange, as pdf.js's reset does, left it without a box until
  // the next style flush, and Firefox hit-tested the second move against the
  // bare text layer: all of page 1, 3,631 characters, in 7 of 7 runs. The
  // press lands on the previous selection, so nothing is selected first.
  const head = lower.lines[0];
  let quick = -1;
  if (up && head) {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(up.start.x, up.start.y);
    await page.mouse.down();
    await page.mouse.move((head.left + head.right) / 2, middle(head));
    await page.mouse.move(up.x, up.end);
    await page.mouse.up();
    quick = await selectedChars(page);
  }
  check(
    "a quick drag up from page 2's text into page 1's margin selects only the dragged lines",
    up !== null && quick >= up.min && quick <= up.min + up.last,
    `${quick} characters; page 2's first three lines hold ${up?.min}, page 1's last line ${up?.last}`,
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

  // The drags between and out of pages once more, a pixel at a time, and to
  // keep that short, straight from the pressed point, sideways from the
  // middle of a line. pdf.js's pages have a 2 px strip along their bottom
  // edge, outside the text layer, where every browser puts the selection's
  // end at the start of the page, and larger steps tend to skip it. Here a
  // page's box is rounded to whole pixels and pdf.js rounds its text layer
  // down, so at scale 1.3 page 1 (795.6 by 1,029.6 px) is 796 by 1,030 px
  // around a 795 by 1,029 px text layer. While sections were selectable
  // during a drag, Chromium and WebKit put the selection's end at the page's
  // start over that last row and column: all of page 1 (3,631 characters)
  // dragging up, page 1 up to the pressed line (3,308) on the way down until
  // the pointer reached page 2, and page 1 up to the middle of the line
  // (3,333) sideways.
  await page.evaluate(() => (window as { __viewer?: ViewerProbe }).__viewer?.setScale(1.3));
  await centerFirstBoundary(page);
  const roundUpper = await settledLines(page, 1);
  const roundLower = await settledLines(page, 2);
  const below = (roundUpper.bottom - roundUpper.textBottom).toFixed(1);
  const beyond = (roundUpper.right - roundUpper.textRight).toFixed(1);

  // Down from the start of page 1's third-to-last line to the height of page
  // 2's second line, reading the selection after every move.
  const stepPressed = roundUpper.lines.at(-3);
  const stepTarget = roundLower.lines[1];
  const stepRest = count(roundUpper.lines, -3);
  const stepNext = count(roundLower.lines, 0, 2);
  let stepDown = -1;
  let stepDownLargest = -1;
  if (stepPressed && stepTarget) {
    const start = { x: stepPressed.left + 1, y: middle(stepPressed) };
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await moveInPixelSteps(page, start, { x: start.x, y: middle(stepTarget) }, async () => {
      stepDownLargest = Math.max(stepDownLargest, await selectedChars(page));
    });
    await page.mouse.up();
    stepDown = await selectedChars(page);
  }
  check(
    "dragging down across the gap in 1 px steps selects only the dragged lines at every step",
    stepDown >= stepRest &&
      stepDown <= stepRest + stepNext &&
      stepDownLargest <= stepRest + stepNext,
    `${stepDown} characters, at most ${stepDownLargest} on the way; page 1 holds ${stepRest} from the pressed line on, page 2's first two lines ${stepNext}; page 1's box reaches ${below} px below its text layer`,
  );

  // Up from the end of page 2's third line to 20 px below page 1's last line.
  const stepLifted = roundLower.lines[2];
  const stepLast = roundUpper.lines.at(-1);
  const stepMin = count(roundLower.lines, 0, 3);
  let stepUp = -1;
  if (stepLifted && stepLast) {
    const start = { x: stepLifted.right - 1, y: middle(stepLifted) };
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await moveInPixelSteps(page, start, { x: start.x, y: stepLast.top + stepLast.height + 20 });
    await page.mouse.up();
    stepUp = await selectedChars(page);
  }
  check(
    "dragging up across the gap in 1 px steps selects only the dragged lines",
    stepLast !== undefined && stepUp >= stepMin && stepUp <= stepMin + stepLast.chars,
    `${stepUp} characters; page 2's first three lines hold ${stepMin}, page 1's last line ${stepLast?.chars}; page 1's box reaches ${below} px below its text layer`,
  );

  // Right from the middle of page 1's third-to-last line to 40 px beside the page.
  let stepSideways = -1;
  if (stepPressed) {
    const start = { x: (stepPressed.left + stepPressed.right) / 2, y: middle(stepPressed) };
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await moveInPixelSteps(page, start, { x: roundUpper.right + 40, y: start.y });
    await page.mouse.up();
    stepSideways = await selectedChars(page);
  }
  check(
    "a drag out of a page sideways in 1 px steps holds beside it",
    stepPressed !== undefined && stepSideways > 0 && stepSideways < stepPressed.chars,
    `${stepSideways} characters; the line holds ${stepPressed?.chars}; page 1's box reaches ${beyond} px right of its text layer`,
  );

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
