/**
 * Checks the interactive React-vs-iframe showcases on `/` and `/why-react/` in
 * the built site: React overlays in PDF points and text-selection pinning,
 * two-way Form 1040 state and on-page validation overlays, two viewports
 * sharing one PdfDocument session, PdfViewer unmount/remount preserving scroll
 * and zoom, 1,000-page virtualization telemetry, and the container-queried
 * comparison table.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/site build &&
 *   pnpm --filter @parapdf/site check:showcases
 * Environment: BROWSER (chromium, webkit, or firefox).
 */
import { join } from "node:path";
import { preview } from "astro";
import { captureFailure, launchBrowser } from "../../bench/scripts/browsers.ts";

const root = join(import.meta.dirname, "..");
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    void captureFailure(name);
  }
}

const server = await preview({
  root,
  server: { port: 4187, host: "127.0.0.1" },
  logLevel: "error",
});
const origin = `http://127.0.0.1:${server.port}`;
let launched: Awaited<ReturnType<typeof launchBrowser>> | undefined;

try {
  launched = await launchBrowser();
  console.log(launched.label);
  const context = await launched.browser.newContext({
    viewport: { width: 1400, height: 920 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // 1. Home page workbench (`HeroViewer`)
  await page.goto(`${origin}/`);
  const workbench = page.locator(".hero-workbench");
  await workbench.locator(".pdf-pin").first().waitFor({ timeout: 30_000 });
  check(
    "home workbench renders on-page React pin and note card in PDF points",
    (await workbench.locator(".pdf-pin").first().textContent()) === "#1" &&
      (await workbench.locator(".pdf-note-card").count()) === 1,
  );

  await workbench.getByRole("button", { name: /#2.*Argument types/ }).click();
  await workbench
    .locator(".pdf-note-card")
    .filter({ hasText: "Cross-check every specifier" })
    .waitFor();
  await workbench
    .locator(".pdf-note-card")
    .getByRole("button", { name: /^Resolved/ })
    .click();
  const sidebarResolved = await workbench
    .locator(".showcase-panel")
    .getByRole("button", { name: "Resolved, note 2" })
    .getAttribute("aria-pressed");
  check(
    "clicking a sidebar note jumps the PDF and resolving on the page updates sidebar state",
    sidebarResolved === "true",
    `aria-pressed=${sidebarResolved}`,
  );

  await workbench.getByRole("tab", { name: /4\. 1,000 pages/ }).click();
  const domPagesOut = workbench.getByLabel("Mounted DOM pages");
  await domPagesOut.filter({ hasText: "/ 1,000" }).waitFor({ timeout: 30_000 });
  await workbench.getByRole("button", { name: "Reset count" }).click();
  await workbench.getByRole("button", { name: "p. 500" }).click();
  await workbench.locator("output").filter({ hasText: "500 / 1000" }).waitFor();
  const domText = (await domPagesOut.textContent()) ?? "";
  const mountedMatch = /DOM pages:\s*(\d+)\s*\/\s*1,000/.exec(domText);
  const mountedCount = mountedMatch ? Number(mountedMatch[1]) : 999;
  const commitsText = (await workbench.getByLabel("React view commits").textContent()) ?? "";
  const commitsMatch = /React commits:\s*(\d+)/.exec(commitsText);
  const commitCount = commitsMatch ? Number(commitsMatch[1]) : 999;
  check(
    "1,000-page tab keeps mounted DOM pages bounded and React commits minimal",
    mountedCount > 0 && mountedCount <= 12 && commitCount >= 1 && commitCount <= 6,
    `${domText} | ${commitsText}`,
  );

  // 2. `/why-react/` comparison table + all interactive showcases
  await page.goto(`${origin}/why-react/`);
  const tableHead = page.locator(".comparison-table thead");
  await tableHead.waitFor();
  const wideHeadDisplay = await tableHead.evaluate((el) => getComputedStyle(el).display);
  await page.setViewportSize({ width: 520, height: 900 });
  const narrowHeadDisplay = await tableHead.evaluate((el) => getComputedStyle(el).display);
  await page.setViewportSize({ width: 1400, height: 920 });
  check(
    "comparison table switches from sticky table headers to stacked cards in narrow containers",
    wideHeadDisplay === "table-header-group" && narrowHeadDisplay === "none",
    `wide=${wideHeadDisplay}, narrow=${narrowHeadDisplay}`,
  );

  // Showcase 1: Select PDF text and pin a new React component to its coordinates.
  const citations = page.locator(".example.showcase").nth(0);
  await citations.scrollIntoViewIfNeeded();
  const textSpan = citations
    .locator('section[data-page="2"] .parapdf-text-layer span')
    .filter({ hasText: /\w{4,}/ })
    .first();
  await textSpan.waitFor({ timeout: 30_000 });
  await textSpan.evaluate((element) => {
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const commentInput = citations.getByLabel("Comment");
  await commentInput.waitFor({ timeout: 10_000 });
  await commentInput.fill("Pinned during showcase check");
  await citations.getByRole("button", { name: "Pin to page" }).click();
  await citations.locator(".pdf-pin").filter({ hasText: "#4" }).waitFor();
  check(
    "selecting text on the PDF pins a new React badge (#4) onto the page",
    (await citations.locator(".pdf-pin").filter({ hasText: "#4" }).count()) === 1,
  );

  // Showcase 2: Two-way Form 1040 sync + on-page validation overlay + download.
  const forms = page.locator(".example.showcase").nth(1);
  await forms.scrollIntoViewIfNeeded();
  const f14Selector = '.parapdf-viewport input[name="topmostSubform[0].Page1[0].f1_14[0]"]';
  const pdfFirstName = forms.locator(f14Selector);
  await pdfFirstName.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (selector) => {
      const el = document
        .querySelectorAll(".example.showcase")[1]
        ?.querySelector<HTMLInputElement>(selector);
      return el?.value === "Ada";
    },
    f14Selector,
    { timeout: 15_000 },
  );
  const reactFirstName = forms.getByLabel("First name");
  check(
    "React state prefills Form 1040's first-name PDF widget on load",
    (await pdfFirstName.inputValue()) === "Ada" && (await reactFirstName.inputValue()) === "Ada",
  );

  await pdfFirstName.fill("Marie");
  await page.waitForFunction(
    () => {
      const inputs = document
        .querySelectorAll(".example.showcase")[1]
        ?.querySelectorAll<HTMLInputElement>(".showcase-panel input[type='text']");
      return inputs?.[0]?.value === "Marie";
    },
    undefined,
    { timeout: 10_000 },
  );
  check(
    "typing into the PDF widget updates React state in the sidebar",
    (await reactFirstName.inputValue()) === "Marie",
    await reactFirstName.inputValue(),
  );

  await forms.getByRole("button", { name: "Try invalid ZIP" }).click();
  await forms.locator(".pdf-field-flag").waitFor();
  check(
    "invalid ZIP renders a React validation overlay directly on Form 1040",
    (await forms.getByLabel("ZIP code").getAttribute("aria-invalid")) === "true" &&
      (await forms.locator(".pdf-field-flag").textContent()) === "5-digit ZIP needed",
  );

  const downloading = page.waitForEvent("download");
  await forms.getByRole("button", { name: "Download filled PDF" }).click();
  const downloaded = await downloading;
  check(
    "Download filled PDF saves f1040-filled.pdf",
    downloaded.suggestedFilename() === "f1040-filled.pdf",
    downloaded.suggestedFilename(),
  );

  // Showcase 3: Split session (1 PdfDocument, 2 independent PdfViewer viewports).
  const split = page.locator(".example.showcase").nth(2);
  await split.scrollIntoViewIfNeeded();
  const leftPane = split.locator(".showcase-pane").nth(0);
  const rightPane = split.locator(".showcase-pane").nth(1);
  await rightPane.locator("output").filter({ hasText: "19 / 27" }).waitFor({ timeout: 30_000 });
  await split.getByRole("button", { name: "Right → §5 Floating point" }).click();
  await rightPane
    .locator("output")
    .filter({ hasText: /^2[12] \/ 27$/ })
    .waitFor();
  const leftStillContents = await leftPane.locator("output").first().textContent();
  await split.getByRole("button", { name: "Sync right to left" }).click();
  await rightPane.locator("output").filter({ hasText: "1 / 27" }).waitFor();
  check(
    "two PdfViewers under one PdfDocument navigate independently and sync on demand",
    leftStillContents?.trim() === "1 / 27",
    `left=${leftStillContents}`,
  );

  // Showcase 4: Unmount and remount <PdfViewer /> while keeping scroll and zoom.
  const lifecycle = page.locator(".example.showcase").nth(3);
  await lifecycle.scrollIntoViewIfNeeded();
  const lifeViewport = lifecycle.locator(".parapdf-viewport");
  await lifeViewport
    .locator('section[data-page="3"] canvas:not([width="0"])')
    .first()
    .waitFor({ timeout: 30_000 });
  await lifecycle.getByRole("button", { name: "Zoom in" }).click();
  await lifeViewport.evaluate((el) => {
    el.scrollTop = 950;
  });
  await page.waitForTimeout(400);
  const scrollBefore = await lifeViewport.evaluate((el) => el.scrollTop);
  await lifecycle.getByRole("button", { name: "Unmount <PdfViewer />" }).click();
  await lifecycle.locator(".showcase-unmounted").waitFor();
  const unmountedViewports = await lifecycle.locator(".parapdf-viewport").count();
  await lifecycle
    .locator(".showcase-unmounted")
    .getByRole("button", { name: "Mount <PdfViewer /> again" })
    .click();
  await lifeViewport.waitFor();
  await page.waitForTimeout(400);
  const scrollAfter = await lifeViewport.evaluate((el) => el.scrollTop);
  check(
    "unmounting and remounting <PdfViewer /> releases DOM and restores scroll position",
    unmountedViewports === 0 && scrollBefore > 400 && Math.abs(scrollAfter - scrollBefore) < 8,
    `${scrollBefore} → ${scrollAfter}`,
  );

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await Promise.all([launched?.close(), server.stop()]);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
