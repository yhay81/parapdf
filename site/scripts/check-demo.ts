/**
 * Checks what the demo keeps of the reader's changes, in the built site:
 * showing and hiding the annotation tools keeps the reading position, the
 * form values, and the annotations; opening another document asks first
 * while changes were not downloaded, keeps them when the reader cancels,
 * and discards them when the reader accepts; a downloaded or untouched
 * document gives way without asking, and the next one opens empty.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/site build &&
 *   pnpm --filter @parapdf/site check:demo
 * Environment: BROWSER (chromium, webkit, or firefox).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "astro";
import type { Page } from "playwright";
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

const field = (page: Page) => page.locator(".parapdf-viewport input[type=text]").first();
const documentTitle = (page: Page) =>
  page.getByRole("button", { name: /^Document:/ }).getAttribute("aria-label");

/** Opens a sample from the documents menu. */
async function choose(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: /^Document:/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(title) }).click();
  await page.waitForTimeout(800);
}

/** Draws a stroke with the Draw tool on. */
async function draw(page: Page): Promise<void> {
  const box = await page.locator(".parapdf-viewport").boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

const server = await preview({
  root,
  server: { port: 4186, host: "127.0.0.1" },
  logLevel: "error",
});
const base = `http://127.0.0.1:${server.port}/demo/`;
let launched: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  launched = await launchBrowser();
  console.log(launched.label);
  const context = await launched.browser.newContext({
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialogs: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });

  await page.goto(`${base}?file=f1040.pdf`);
  await field(page).waitFor({ timeout: 30_000 });
  await field(page).fill("Ada Lovelace");
  const scroller = page.locator(".parapdf-viewport");
  await scroller.evaluate((element) => {
    element.scrollTop = 600;
  });
  await page.waitForTimeout(500);
  const before = await scroller.evaluate((element) => element.scrollTop);

  // Draw with the annotation tools, hide them, and show and hide them again.
  const annotate = page.getByRole("button", { name: "Annotate" }).first();
  await annotate.click();
  await page.getByRole("toolbar", { name: "Annotations" }).waitFor();
  await page.getByRole("button", { name: "Draw" }).click();
  await page.waitForTimeout(500);
  await draw(page);
  // Hiding the tools ends the drawing, which then shows as an ink annotation.
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(500);
  const drawn = await page.locator(".inkEditor").count();
  await annotate.click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(800);
  const after = await scroller.evaluate((element) => element.scrollTop);
  const value = await field(page).inputValue();
  const kept = await page.locator(".inkEditor").count();
  check(
    "showing and hiding the annotation tools keeps the form value",
    value === "Ada Lovelace",
    value,
  );
  check(
    "showing and hiding the annotation tools keeps the drawing",
    drawn === 1 && kept === drawn,
    `${drawn} → ${kept}`,
  );
  check(
    "showing and hiding the annotation tools keeps the reading position",
    Math.abs(after - before) < 4,
    `${before} → ${after}`,
  );

  await choose(page, "1,000 pages");
  check(
    "another document asks first while changes were not downloaded; cancel keeps them",
    dialogs.length === 1 &&
      (await documentTitle(page)) === "Document: Form 1040" &&
      (await field(page).inputValue()) === "Ada Lovelace" &&
      (await page.locator(".inkEditor").count()) === 1,
    `${dialogs.length} dialog(s): ${dialogs[0] ?? ""}`,
  );

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).first().click();
  const file = await downloading;
  check(
    "Download saves the document",
    file.suggestedFilename() === "f1040.pdf",
    file.suggestedFilename(),
  );
  await page.waitForTimeout(300);
  await choose(page, "1,000 pages");
  check(
    "after a download, another document opens without asking",
    dialogs.length === 1 && (await documentTitle(page)) === "Document: 1,000 pages",
  );

  await choose(page, "Form 1040");
  await field(page).waitFor();
  check(
    "an untouched document gives way without asking, and the next one opens empty",
    dialogs.length === 1 && (await field(page).inputValue()) === "",
  );

  // A drawing alone, without a form value, also counts as a change.
  await annotate.click();
  await page.getByRole("button", { name: "Draw" }).click();
  await page.waitForTimeout(500);
  await draw(page);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(500);
  accept = true;
  await choose(page, "1,000 pages");
  check(
    "a drawing alone asks too; accepting discards it and opens the other document",
    dialogs.length === 2 && (await documentTitle(page)) === "Document: 1,000 pages",
  );
  await choose(page, "Form 1040");
  await field(page).waitFor();
  await field(page).fill("Discard this value");
  await page.getByRole("button", { name: /^Document:/ }).click();
  await page.getByRole("menuitemradio", { name: /LaTeX2e for authors/ }).click();
  await page.getByRole("button", { name: /^Document:/ }).click();
  await page.getByRole("menuitemradio", { name: /Form 1040/ }).click();
  await field(page).waitFor();
  check(
    "immediately reopening a discarded sample starts with empty fields",
    (await field(page).inputValue()) === "",
  );

  const contents = await readFile(join(root, "../bench/corpus/f1040.pdf"));
  const picker = page.locator('input[type="file"][accept*="pdf"]');
  // Hold an earlier selection until the newer one is already on screen.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "slow.pdf") {
        await new Promise<void>((resolve) =>
          window.addEventListener("release-file", () => resolve(), { once: true }),
        );
      }
      return original.call(this);
    };
  });
  await picker.setInputFiles({ name: "slow.pdf", mimeType: "application/pdf", buffer: contents });
  await picker.setInputFiles({
    name: "my-form.pdf",
    mimeType: "application/pdf",
    buffer: contents,
  });
  await field(page).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("release-file")));
  const localDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).first().click();
  const local = await localDownload;
  check(
    "a later file selection wins and downloads with its own filename",
    (await documentTitle(page)) === "Document: my-form.pdf" &&
      local.suggestedFilename() === "my-form.pdf",
    local.suggestedFilename(),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await Promise.all([launched?.close(), server.stop()]);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
