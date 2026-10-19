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
  // lines, not the rest of the page: WebKit extends such a selection to
  // wherever the text layer's .endOfContent element sits. The drag crosses
  // line 9's text before it leaves past the line's end: over blank space
  // Firefox keeps the selection's end where the pointer last touched text,
  // and a straight drag from line 5 slipped between the boxes of lines 7 and
  // 8 by a tenth of a pixel once Firefox's runs had their full width.
  page = await newPage();
  await openViewer(page, baseUrl, "synthetic-text-1000.pdf");
  const drag = await page.evaluate(() => {
    const section = document.querySelector('section[data-page="1"]');
    const lines: { top: number; height: number; left: number; right: number; chars: number }[] = [];
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
    const count = (from: number, to: number) =>
      lines.slice(from, to).reduce((sum, line) => sum + line.chars, 0);
    const fifth = lines[4];
    const ninth = lines[8];
    const pageRight = section?.getBoundingClientRect().right ?? 0;
    return fifth && ninth
      ? {
          start: { x: fifth.left + 1, y: fifth.top + fifth.height / 2 },
          via: { x: (ninth.left + ninth.right) / 2, y: ninth.top + ninth.height / 2 },
          end: { x: Math.min(pageRight - 20, ninth.right + 120), y: ninth.top + ninth.height / 2 },
          min: count(4, 7),
          max: count(4, 10),
        }
      : null;
  });
  if (drag) {
    await page.mouse.move(drag.start.x, drag.start.y);
    await page.mouse.down();
    await page.mouse.move(drag.via.x, drag.via.y, { steps: 12 });
    await page.mouse.move(drag.end.x, drag.end.y, { steps: 8 });
    await page.mouse.up();
  }
  const dragged = (await page.evaluate(() => window.getSelection()?.toString() ?? "")).replace(
    /\s/g,
    "",
  ).length;
  check(
    "dragging past a line's end selects only the dragged lines",
    drag !== null && dragged >= drag.min && dragged <= drag.max,
    `${dragged} characters; lines 5–7 hold ${drag?.min}, lines 5–10 hold ${drag?.max}`,
  );

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
