/**
 * Compares the shipped ParaPDF viewer and react-pdf + react-window on the
 * same PDFs. Checks mouse selection and keyboard link activation, fingerprints
 * the first sharp page, and counts the page DOM retained after a jump.
 * BROWSER selects the browser, DIST the prototype build, RUNS the number of
 * fresh contexts per viewer, and OUTPUT an optional JSON result file.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const project = fileURLToPath(new URL("..", import.meta.url));
const readers = ["ParaPDF", "react-pdf"] as const;
type Reader = (typeof readers)[number];

const documentLink = "https://example.com/from-the-file";
const plainAddresses = [
  "https://example.com/guide?page=2",
  "http://www.example.org/mirror",
  "mailto:reader@example.net",
];

function pageHost(reader: Reader) {
  return reader === "ParaPDF" ? "section[data-page]" : ".react-pdf__Page[data-page-number]";
}

function url(base: string, reader: Reader, file: string) {
  const page = new URL(reader === "ParaPDF" ? "./" : "compare.html", base);
  page.search = new URLSearchParams({
    file,
    engine: "pdfjs",
    viewer: "react-pdf-window",
    text: "1",
    links: "1",
    autoLinks: file === "synthetic-links-in-text.pdf" ? "1" : "0",
  }).toString();
  return page.href;
}

async function reading(page: Page, base: string, reader: Reader) {
  await page.goto(url(base, reader, "synthetic-links-in-text.pdf"));
  const first = page.locator(pageHost(reader)).first();
  const link = first.locator(`a[href="${documentLink}"]`);
  await link.waitFor();
  if (reader === "ParaPDF") await first.locator(`a[href="${plainAddresses[2]}"]`).waitFor();
  const addresses = await first
    .locator("a[href]")
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href).sort());
  // At 636 CSS pixels fit-width gives this letter page 612 CSS pixels.
  // At DPR 2 both viewers must finish the whole page at 1,224 × 1,584.
  const canvas = first.locator("canvas");
  await page.waitForFunction(
    (host) =>
      [...(document.querySelector(host)?.querySelectorAll("canvas") ?? [])].some(
        (c) =>
          c.width === 1224 && c.height === 1584 && getComputedStyle(c).visibility === "visible",
      ),
    pageHost(reader),
  );
  const raster = await canvas.evaluateAll(async (all) => {
    const c = all.find(
      (c): c is HTMLCanvasElement =>
        c instanceof HTMLCanvasElement &&
        c.width === 1224 &&
        c.height === 1584 &&
        getComputedStyle(c).visibility === "visible",
    );
    const ctx = c?.getContext("2d");
    if (!c || !ctx) throw new Error("Missing sharp page");
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const sha = await crypto.subtle.digest("SHA-256", pixels);
    return Array.from(new Uint8Array(sha), (b) => b.toString(16).padStart(2, "0")).join("");
  });
  // Capture the trusted activation before the browser navigates away from the PDF.
  await page.evaluate(() => {
    window.addEventListener(
      "click",
      (event) => {
        const anchor = event.target instanceof Element && event.target.closest("a");
        if (anchor && event.isTrusted && !event.defaultPrevented) {
          document.documentElement.dataset.pdfLink = anchor.href;
        }
        event.preventDefault();
      },
      { once: true },
    );
  });
  await link.press("Enter");
  const embedded = await page.evaluate(() => document.documentElement.dataset.pdfLink);
  assert.equal(embedded, documentLink);
  const line = first.getByText(/^Read the guide/);
  // Work from the printed word's position, then let the browser select it.
  const word = await line.first().evaluate((span) => {
    const text = span.firstChild;
    if (!text) throw new Error("Missing printed text");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.dblclick(word.x, word.y);
  const selected = await page.evaluate(() => getSelection()?.toString().trim());
  assert.equal(selected, "Read");
  return { selected, embedded, addresses, raster };
}

async function mountedPages(page: Page, base: string, reader: Reader) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url(base, reader, "synthetic-text-1000.pdf"));
  const host = pageHost(reader);
  const first = page.locator(host).first();
  await first.locator(".endOfContent").waitFor({ state: "attached" });
  await first.evaluate((element) => {
    const viewport = element.closest(".viewport");
    if (!viewport) throw new Error("Missing scroll container");
    viewport.scrollTop = 9 * (element.getBoundingClientRect().height + 12) + 24;
  });
  // All mounted pages have their text and page ten has a drawing at the top.
  await page.waitForFunction((host) => {
    const pages = [...document.querySelectorAll(host)];
    const tenth = pages.find(
      (p) => (p.getAttribute("data-page") ?? p.getAttribute("data-page-number")) === "10",
    );
    const viewport = tenth?.closest(".viewport");
    if (
      !tenth ||
      !viewport ||
      Math.abs(tenth.getBoundingClientRect().top - viewport.getBoundingClientRect().top) > 30
    )
      return false;
    return (
      pages.every((p) => p.querySelector(".endOfContent")) &&
      [...tenth.querySelectorAll("canvas")].some(
        (c) => c.width > 0 && c.height > 0 && getComputedStyle(c).visibility === "visible",
      )
    );
  }, host);
  return page.locator(host).evaluateAll((pages) => ({
    pageNumbers: pages.map((p) =>
      Number(p.getAttribute("data-page") ?? p.getAttribute("data-page-number")),
    ),
    canvasElements: pages.reduce((count, p) => count + p.querySelectorAll("canvas").length, 0),
    elements: pages.reduce((count, p) => count + 1 + p.querySelectorAll("*").length, 0),
  }));
}

const server = await preview({
  root: project,
  configFile: join(project, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4187, host: "127.0.0.1", strictPort: true, open: false },
});
const base = server.resolvedUrls?.local[0];
assert.ok(base);
const launched = await launchBrowser();
const samples = [];
try {
  for (let round = 0; round < Number(process.env.RUNS ?? 3); round++) {
    const rasters = new Set<string>();
    for (const reader of round % 2 ? readers.toReversed() : readers) {
      const result = await measureInTurn(launched, async (browser) => {
        const context = await browser.newContext({
          viewport: { width: 636, height: 900 },
          deviceScaleFactor: 2,
        });
        try {
          const page = await context.newPage();
          await restoreScaleFactor(page, new URL("calibrate.html", base).href);
          const content = await reading(page, base, reader);
          const dom = await mountedPages(page, base, reader);
          return { reader, round: round + 1, ...content, ...dom };
        } finally {
          await context.close();
        }
      });
      samples.push(result);
      rasters.add(result.raster);
      console.log(JSON.stringify(result));
    }
    assert.equal(rasters.size, 1, `The two readers drew different pixels in round ${round + 1}`);
  }
  if (process.env.OUTPUT)
    writeFileSync(
      process.env.OUTPUT,
      JSON.stringify({ browser: launched.label, samples }, null, 2),
    );
} finally {
  await launched.close();
  await server.close();
}
