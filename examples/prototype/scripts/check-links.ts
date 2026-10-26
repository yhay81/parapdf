/**
 * Functional checks for links and the outline on usrguide.pdf (LaTeX with
 * hyperref): internal link names and navigation by mouse and keyboard, the
 * back stack, outline consistency, and external link attributes.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:links
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

interface ViewerProbe {
  scrollTop: number;
  currentPage: number;
  canGoBack: boolean;
}

const probe = (page: Page): Promise<ViewerProbe> =>
  page.evaluate(() => {
    const viewer = window.__viewer;
    return {
      scrollTop: Math.round(viewer?.scroller?.scrollTop ?? -1),
      currentPage: viewer?.store.get().currentPage ?? -1,
      canGoBack: window.__history?.store.get().canGoBack ?? false,
    };
  });

const pageLinks = (page: Page, pageNumber: number) =>
  page.locator(`section[data-page="${pageNumber}"] .parapdf-annotation-layer a`);

const SECTION = "2 Creating document commands and environments";

/** Four blank pages with the PDF's own rotation, independent of view rotation. */
function rotatedPages(): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>",
    ...[0, 90, 180, 270].map(
      (rotation) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << >> >>`,
    ),
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return `${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4186, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4186/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const context = await launched.browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${baseUrl}?engine=${engine}&file=usrguide.pdf`);
  await pageLinks(page, 1).first().waitFor({ state: "attached", timeout: 30_000 });
  const start = await probe(page);

  const links = await pageLinks(page, 1).evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute("href") ?? "",
      title: element.getAttribute("title") ?? "",
    })),
  );
  check("the table of contents has internal links", links.length >= 20, `${links.length} links`);
  check(
    "internal links carry the linked text as their accessible name",
    links.filter((link) => link.href.startsWith("#") && link.title.length > 0).length >= 20,
    JSON.stringify(links.slice(0, 2)),
  );

  // Mouse: follow the table-of-contents entry for section 2.
  const tocLink = pageLinks(page, 1)
    .and(page.locator(`[title="${SECTION}"]`))
    .first();
  await tocLink.click();
  await page.waitForTimeout(600);
  const afterClick = await probe(page);
  check(
    "clicking an internal link jumps forward",
    afterClick.currentPage > start.currentPage && afterClick.canGoBack,
    `page ${start.currentPage + 1} -> ${afterClick.currentPage + 1}`,
  );
  // The landing page's text layer is built once scrolling settles.
  await page.waitForTimeout(1200);
  const landedText = await page
    .locator(`section[data-page="${afterClick.currentPage + 1}"] .parapdf-text-layer`)
    .textContent();
  check(
    "the jump lands on the linked section",
    (landedText ?? "").includes("Creating document commands"),
  );

  // Back returns to where the jump started.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForTimeout(400);
  const afterBack = await probe(page);
  check(
    "Back returns to the starting position",
    Math.abs(afterBack.scrollTop - start.scrollTop) <= 2 && !afterBack.canGoBack,
    `${start.scrollTop} vs ${afterBack.scrollTop}`,
  );

  // Keyboard: focus the same link and press Enter.
  await tocLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const afterEnter = await probe(page);
  check(
    "Enter on a focused link follows it",
    Math.abs(afterEnter.scrollTop - afterClick.scrollTop) <= 2,
    `${afterClick.scrollTop} vs ${afterEnter.scrollTop}`,
  );
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForTimeout(400);
  check("Alt+Left goes back", Math.abs((await probe(page)).scrollTop - start.scrollTop) <= 2);

  // The outline entry for the same section lands at the same place.
  await page.getByRole("button", { name: "Outline" }).click();
  const outline = page.getByRole("navigation", { name: "Document outline" });
  const entries = await outline.getByRole("button").count();
  check("the outline lists its entries", entries >= 20, `${entries} entries`);
  await outline.getByRole("button", { name: SECTION, exact: true }).click();
  await page.waitForTimeout(600);
  const afterOutline = await probe(page);
  check(
    "the outline and the link reach the same position",
    afterOutline.currentPage === afterClick.currentPage,
    `link page ${afterClick.currentPage + 1}, outline page ${afterOutline.currentPage + 1}`,
  );

  // External links open in a new tab without access to this page.
  await page.evaluate(() => {
    (window as { __viewer?: { goToPage(index: number): void } }).__viewer?.goToPage(25);
  });
  const external = pageLinks(page, 26).first();
  await external.waitFor({ state: "attached", timeout: 15_000 });
  const attributes = await external.evaluate((element) => ({
    href: element.getAttribute("href"),
    target: element.getAttribute("target"),
    rel: element.getAttribute("rel"),
  }));
  check(
    "external links open safely in a new tab",
    attributes.href?.startsWith("https://") === true &&
      attributes.target === "_blank" &&
      (attributes.rel ?? "").includes("noopener"),
    JSON.stringify(attributes),
  );

  const rotatedContext = await launched.browser.newContext();
  const rotated = await rotatedContext.newPage();
  await rotated.route("**/corpus/rotated-destinations.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: rotatedPages() }),
  );
  await rotated.goto(`${baseUrl}?engine=${engine}&file=rotated-destinations.pdf`);
  await rotated.waitForFunction(
    () =>
      (window as { __session?: { state: { get(): { status: string } } } }).__session?.state.get()
        .status === "ready",
  );
  const destinations = await rotated.evaluate(async () => {
    // The loaded session, which resolves destinations for the viewer.
    const doc = (
      window as {
        __viewer?: { session: { resolveDestination(dest: unknown): Promise<unknown> } | null };
      }
    ).__viewer?.session;
    // A FitR rectangle, 120–400 by 100–300, gives its top-left corner as the page shows.
    const expected = [
      {
        point: { x: 120, y: 492 },
        horizontal: { x: null, y: 492 },
        vertical: { x: 120, y: null },
        rect: { x: 120, y: 492 },
      },
      {
        point: { x: 300, y: 120 },
        horizontal: { x: 300, y: null },
        vertical: { x: null, y: 120 },
        rect: { x: 100, y: 120 },
      },
      {
        point: { x: 492, y: 300 },
        horizontal: { x: null, y: 300 },
        vertical: { x: 492, y: null },
        rect: { x: 212, y: 100 },
      },
      {
        point: { x: 492, y: 492 },
        horizontal: { x: 492, y: null },
        vertical: { x: null, y: 492 },
        rect: { x: 492, y: 212 },
      },
    ];
    const views = {
      FitH: "width",
      FitBH: "width",
      FitV: "height",
      FitBV: "height",
      XYZ: "zoom",
      FitR: "rect",
      Fit: "page",
    };
    const results: { rotation: number; mode: string; actual: unknown; expected: unknown }[] = [];
    for (const [pageIndex, points] of expected.entries()) {
      for (const [mode, args, target] of [
        ["FitH", [300], points.horizontal],
        ["FitBH", [300], points.horizontal],
        ["FitV", [120], points.vertical],
        ["FitBV", [120], points.vertical],
        ["XYZ", [null, 300, null], points.horizontal],
        ["XYZ", [120, null, null], points.vertical],
        ["XYZ", [120, 300, null], points.point],
        ["FitR", [120, 100, 400, 300], points.rect],
        ["Fit", [], { x: null, y: null }],
      ] as const) {
        const resolved = (await doc?.resolveDestination([pageIndex, { name: mode }, ...args])) as {
          view?: { fit: string };
        } | null;
        const { view, ...actual } = resolved ?? {};
        results.push({
          rotation: pageIndex * 90,
          mode,
          actual: { ...actual, fit: view?.fit },
          expected: { pageIndex, ...target, fit: views[mode] },
        });
      }
    }
    return results;
  });
  for (const rotation of [0, 90, 180, 270]) {
    const wrong = destinations.filter(
      (result) =>
        result.rotation === rotation &&
        JSON.stringify(result.actual) !== JSON.stringify(result.expected),
    );
    check(
      `destinations preserve specified coordinates with the PDF rotated ${rotation} degrees`,
      wrong.length === 0,
      wrong.length ? JSON.stringify(wrong) : "9 destinations",
    );
  }
  await rotatedContext.close();

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
