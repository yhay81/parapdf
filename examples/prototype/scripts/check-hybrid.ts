/**
 * Functional checks for the hybrid engine (`?engine=hybrid`): image-only
 * pages render with hayro and every other page with pdf.js, the hayro module
 * loads only for documents with image-only pages, hayro's pixels match
 * pdf.js's, and text layers, search, and selection on scans still come from
 * pdf.js. Exits non-zero on failure.
 *
 * Usage: pnpm bench:build && pnpm --filter @parapdf/prototype build &&
 * pnpm --filter @parapdf/prototype check:hybrid
 * Environment: BROWSER (chromium, webkit, or firefox).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import { browserFromEnv, launchBrowser } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Opened {
  page: Page;
  requests: string[];
}

interface HybridState {
  renderers: Record<number, string>;
  fallbacks: string[];
}

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4184, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4184/";
const launched = await launchBrowser(browserFromEnv(), { deviceScaleFactor: 2 });
console.log(launched.label);
const errors: string[] = [];

/** Opens `file` in a fresh context and waits until page 1 has full-resolution pixels. */
async function open(file: string, engine = "hybrid"): Promise<Opened> {
  const context = await launched.browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${file}: ${error.message}`));
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${baseUrl}?engine=${engine}&file=${file}`);
  await page.waitForFunction(
    () => {
      const detail = document.querySelectorAll<HTMLCanvasElement>(
        'section[data-page="1"] canvas',
      )[1];
      return (detail?.width ?? 0) > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  // Let the text and annotation layers of the first pages settle.
  await page.waitForTimeout(800);
  return { page, requests };
}

const hybridState = (page: Page): Promise<HybridState> =>
  page.evaluate(() => {
    const records = (
      window as {
        __benchRecords?: {
          hybrid: { type: string; pageIndex: number | null; renderer?: string; reason?: string }[];
        };
      }
    ).__benchRecords;
    const renderers: Record<number, string> = {};
    const fallbacks: string[] = [];
    for (const event of records?.hybrid ?? []) {
      if (event.type === "classified" && event.pageIndex !== null && event.renderer) {
        renderers[event.pageIndex] = event.renderer;
      }
      if (event.type === "fallback") fallbacks.push(`${event.pageIndex}: ${event.reason}`);
    }
    return { renderers, fallbacks };
  });

/** Page 1 scaled to 240 CSS pixels wide, as RGBA, from its sharpest painted canvas. */
const thumbnail = (page: Page): Promise<number[] | null> =>
  page.evaluate(() => {
    const canvases = [
      ...document.querySelectorAll<HTMLCanvasElement>('section[data-page="1"] canvas'),
    ].filter((canvas) => canvas.width > 0);
    const source = canvases.at(-1);
    if (!source) return null;
    const probe = document.createElement("canvas");
    probe.width = 240;
    probe.height = Math.round((240 * source.height) / source.width);
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, probe.width, probe.height);
    return [...context.getImageData(0, 0, probe.width, probe.height).data];
  });

const inkRatio = (pixels: number[]): number => {
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0) < 384) dark++;
  }
  return dark / (pixels.length / 4);
};

/** Mean absolute difference per color channel, 0 to 255. */
const meanDifference = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      sum += Math.abs((a[index + channel] ?? 0) - (b[index + channel] ?? 0));
      count++;
    }
  }
  return sum / count;
};

const hayroRequested = (requests: string[]) => requests.some((url) => /hayro_wasm_bench/.test(url));
const classifierRequested = (requests: string[]) =>
  requests.some((url) => /hayro_classify_bg/.test(url));

async function searchFor(page: Page, query: string): Promise<number> {
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
  return page.evaluate(
    () =>
      (
        window as { __viewer?: { store: { get(): { search: { matches: unknown[] } } } } }
      ).__viewer?.store.get().search.matches.length ?? 0,
  );
}

try {
  // Text and vector documents never load hayro.
  for (const file of ["bill-hr815.pdf", "synthetic-vector-200k.pdf"]) {
    const { page, requests } = await open(file);
    const state = await hybridState(page);
    check(
      `${file}: page 1 renders with pdf.js`,
      state.renderers[0] === "base",
      JSON.stringify(state.renderers),
    );
    check(`${file}: no page goes to hayro`, !Object.values(state.renderers).includes("hayro"));
    check(`${file}: the classifier module loaded`, classifierRequested(requests));
    check(`${file}: the hayro module never loaded`, !hayroRequested(requests));
    check(`${file}: no fallbacks`, state.fallbacks.length === 0, state.fallbacks.join(" | "));
    await page.context().close();
  }

  // Scans render with hayro, and look like pdf.js's rendering.
  for (const file of [
    "bunka-kokugo-series-019-p4.pdf",
    "patent-us223898.pdf",
    "wdl6812-manuscript.pdf",
  ]) {
    const hybrid = await open(file);
    const state = await hybridState(hybrid.page);
    check(
      `${file}: page 1 renders with hayro`,
      state.renderers[0] === "hayro",
      JSON.stringify(state.renderers),
    );
    check(`${file}: the hayro module loaded`, hayroRequested(hybrid.requests));
    check(`${file}: no fallbacks`, state.fallbacks.length === 0, state.fallbacks.join(" | "));
    const pixels = await thumbnail(hybrid.page);
    const ink = pixels ? inkRatio(pixels) : 0;
    check(`${file}: hayro painted page 1`, ink > 0.005 && ink < 0.99, `ink ${ink.toFixed(3)}`);

    if (file === "patent-us223898.pdf") {
      // The OCR text layer is invisible in the PDF, so the canvas came from
      // hayro, but selection and search still use pdf.js's text.
      const text = await hybrid.page.evaluate(
        () =>
          document.querySelector('section[data-page="1"] .parapdf-text-layer')?.textContent ?? "",
      );
      check(
        `${file}: page 1 exposes its OCR text`,
        /Electric-Lamp/.test(text),
        JSON.stringify(text.slice(0, 60)),
      );
      const run = hybrid.page
        .locator('section[data-page="1"] .parapdf-text-layer span', { hasText: "Electric-Lamp" })
        .first();
      const box = await run.boundingBox();
      if (box) {
        await hybrid.page.mouse.move(box.x + 2, box.y + box.height / 2);
        await hybrid.page.mouse.down();
        await hybrid.page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
        await hybrid.page.mouse.up();
      }
      const selected = await hybrid.page.evaluate(() => window.getSelection()?.toString() ?? "");
      check(`${file}: OCR text is selectable`, /Electric/.test(selected), JSON.stringify(selected));
      const matches = await searchFor(hybrid.page, "Menlo Park");
      check(`${file}: search finds OCR text`, matches >= 1, `${matches} matches`);

      // Zooming re-renders the detail layer, which already holds a hayro
      // bitmap, at the new scale.
      await hybrid.page.evaluate(() =>
        (window as { __viewer?: { goToPage(index: number): void } }).__viewer?.goToPage(0),
      );
      const detailWidth = () =>
        hybrid.page.evaluate(
          () =>
            document.querySelectorAll<HTMLCanvasElement>('section[data-page="1"] canvas')[1]
              ?.width ?? 0,
        );
      // Search scrolled to a later page; wait until page 1 is sharp again.
      await hybrid.page.waitForFunction(
        () =>
          (document.querySelectorAll<HTMLCanvasElement>('section[data-page="1"] canvas')[1]
            ?.width ?? 0) > 0,
        undefined,
        { timeout: 15_000 },
      );
      await hybrid.page.waitForTimeout(300);
      const before = await detailWidth();
      await hybrid.page.evaluate(() =>
        (window as { __viewer?: { zoomBy(factor: number): void } }).__viewer?.zoomBy(1.5),
      );
      const grew = await hybrid.page
        .waitForFunction(
          (width) =>
            (document.querySelectorAll<HTMLCanvasElement>('section[data-page="1"] canvas')[1]
              ?.width ?? 0) >
            width * 1.3,
          before,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        );
      const zoomed = await hybridState(hybrid.page);
      check(
        `${file}: zooming re-renders page 1 with hayro`,
        grew && zoomed.fallbacks.length === 0,
        `detail width ${before} → ${await detailWidth()}`,
      );
    }

    const reference = await open(file, "pdfjs-next");
    const referencePixels = await thumbnail(reference.page);
    const difference =
      pixels && referencePixels ? meanDifference(pixels, referencePixels) : Number.NaN;
    check(
      `${file}: hayro's page 1 matches pdf.js's`,
      difference < 12,
      `mean difference ${difference.toFixed(1)} of 255 per channel`,
    );
    await hybrid.page.context().close();
    await reference.page.context().close();
  }

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
