/**
 * Functional checks for the text layer: selection, search highlights,
 * normalization, and accessibility semantics. Exits non-zero on failure.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/check-text.ts
 * SCREENSHOT=path.png saves the search view for visual review.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { preview } from "vite";

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

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4185, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4185/";
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

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

  // Japanese text in a non-embedded CID font, plus compatibility normalization.
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

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
