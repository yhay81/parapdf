/**
 * Functional checks for view rotation and the document escape hatch: the
 * page box, canvases, text runs, overlays, search highlights, and link jumps
 * follow a quarter turn, turning back restores the layout, and
 * useSession().proxy hands out pdf.js's own document.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:rotation
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    captureFailure(name);
  }
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const close = (a: number, b: number, tolerance = 2) => Math.abs(a - b) <= tolerance;

/** Waits until the viewer shows `rotation` and the visible pages are sharp again. */
const settle = (page: Page, rotation: number) =>
  page.waitForFunction(
    (expected) => {
      const viewer = (
        window as unknown as {
          __viewer?: { store: { get(): { rotation?: number } }; sharpness(): number };
        }
      ).__viewer;
      return viewer?.store.get().rotation === expected && viewer.sharpness() >= 0.99;
    },
    rotation,
    { timeout: 15_000 },
  );

const boxOf = (page: Page, selector: string): Promise<Box | null> =>
  page.evaluate((target) => {
    const rect = document.querySelector(target)?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  }, selector);

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4181, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4181/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const errors: string[] = [];
const newPage = async (file: string, query = ""): Promise<Page> => {
  const context = await launched.browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}?engine=${engine}&file=${file}${query}`);
  await page.waitForSelector('section[data-page="1"] .parapdf-text-layer span', {
    timeout: 30_000,
  });
  return page;
};
const rotate = async (page: Page, name: "Rotate clockwise" | "Rotate counterclockwise") => {
  const button = page.getByRole("button", { name, exact: true });
  if ((await button.count()) === 0) return false;
  await button.click();
  return true;
};

try {
  // Layout, pixels, text, overlays, and search on a portrait bill.
  const page = await newPage("bill-hr815.pdf");
  const section = 'section[data-page="1"]';
  // Turn at a fixed zoom: in "fit-width" mode a turn fits the turned page's
  // width instead of swapping the box (check-options.ts covers that).
  await page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: { setScale(scale: number): void; store: { get(): { scale: number } } };
      }
    ).__viewer;
    viewer.setScale(viewer.store.get().scale);
  });
  const portrait = await boxOf(page, section);
  const geometry = await page.evaluate(() => {
    const viewer = (
      window as unknown as {
        __viewer: {
          store: {
            get(): { layout: { scale: number; sizes: { width: number; height: number }[] } };
          };
        };
      }
    ).__viewer;
    const { layout } = viewer.store.get();
    return { scale: layout.scale, size: layout.sizes[0] };
  });
  const turned = await rotate(page, "Rotate clockwise");
  check("the toolbar rotates the view", turned);
  if (turned) await settle(page, 90);
  const landscape = await boxOf(page, section);
  check(
    "a quarter turn swaps the page box",
    portrait !== null &&
      landscape !== null &&
      close(landscape.width, portrait.height) &&
      close(landscape.height, portrait.width),
    `${portrait?.width}×${portrait?.height} -> ${landscape?.width}×${landscape?.height}`,
  );
  const canvas = await page.evaluate(() => {
    const [base, detail] = document.querySelectorAll<HTMLCanvasElement>(
      'section[data-page="1"] canvas',
    );
    // A page may show only its detail layer: read the layer that holds pixels.
    const drawn = detail && detail.width > 0 ? detail : base;
    return { width: drawn?.width ?? 0, height: drawn?.height ?? 0 };
  });
  check(
    "pages render turned",
    canvas.width > canvas.height,
    `canvas ${canvas.width}×${canvas.height}`,
  );
  const run = await page.evaluate(() => {
    const span = [
      ...document.querySelectorAll('section[data-page="1"] .parapdf-text-layer span'),
    ].find((element) => element.textContent?.includes("Making emergency"));
    const rect = span?.getBoundingClientRect();
    const page = document.querySelector('section[data-page="1"]')?.getBoundingClientRect();
    return rect && page
      ? {
          vertical: rect.height > rect.width,
          inside:
            rect.left >= page.left - 1 &&
            rect.right <= page.right + 1 &&
            rect.top >= page.top - 1 &&
            rect.bottom <= page.bottom + 1,
        }
      : null;
  });
  check("text runs turn with the page", run?.vertical === true && run.inside, JSON.stringify(run));
  // The demo outlines 220×30 points at (72, 36) on page 1. A clockwise quarter
  // turn moves a point (x, y) of a page H points tall to (H - y, x).
  const overlay = await page.evaluate(() => {
    const element = document.querySelector('section[data-page="1"] [style*="outline"]');
    const rect = element?.getBoundingClientRect();
    const page = document.querySelector('section[data-page="1"]')?.getBoundingClientRect();
    return rect && page
      ? {
          left: rect.left - page.left,
          top: rect.top - page.top,
          width: rect.width,
          height: rect.height,
        }
      : null;
  });
  const { scale, size } = geometry;
  const expected = size
    ? {
        left: (size.height - (36 + 30)) * scale,
        top: 72 * scale,
        width: 30 * scale,
        height: 220 * scale,
      }
    : null;
  check(
    "overlays turn with the page",
    overlay !== null &&
      expected !== null &&
      close(overlay.left, expected.left) &&
      close(overlay.top, expected.top) &&
      close(overlay.width, expected.width) &&
      close(overlay.height, expected.height),
    `${JSON.stringify(overlay)} vs ${JSON.stringify(expected)}`,
  );
  await page.evaluate(() => {
    window.__search?.search("israel");
  });
  // The match's page builds its text layer once scrolling settles.
  await page
    .waitForFunction(
      () => (CSS.highlights.get("parapdf-search-current")?.size ?? 0) > 0,
      undefined,
      {
        timeout: 10_000,
      },
    )
    .catch(() => {});
  const highlight = await page.evaluate(() => {
    const entry = CSS.highlights.get("parapdf-search-current");
    const [range] = entry ? [...entry] : [];
    const rect = range instanceof Range ? range.getBoundingClientRect() : null;
    const scroller = document.querySelector(".parapdf-viewport")?.getBoundingClientRect();
    return rect && scroller
      ? {
          text: range?.toString(),
          vertical: rect.height > rect.width,
          visible:
            rect.bottom > scroller.top &&
            rect.top < scroller.bottom &&
            rect.right > scroller.left &&
            rect.left < scroller.right,
        }
      : null;
  });
  check(
    "search scrolls to a turned match and highlights it",
    highlight?.text?.toLowerCase() === "israel" &&
      highlight.vertical === true &&
      highlight.visible === true,
    JSON.stringify(highlight),
  );
  if (turned && (await rotate(page, "Rotate counterclockwise"))) await settle(page, 0);
  const restored = await boxOf(page, section);
  check(
    "turning back restores the page box",
    portrait !== null &&
      restored !== null &&
      close(restored.width, portrait.width) &&
      close(restored.height, portrait.height),
    `${restored?.width}×${restored?.height}`,
  );
  const native = await page.evaluate(async () => {
    const doc = (
      window as { __pdfDocument?: { numPages: number; getMetadata(): Promise<unknown> } }
    ).__pdfDocument;
    if (!doc) return null;
    const metadata = (await doc.getMetadata()) as { info?: Record<string, unknown> };
    return { pages: doc.numPages, hasInfo: typeof metadata.info === "object" };
  });
  check(
    "useSession().proxy exposes pdf.js's PDFDocumentProxy",
    native?.pages === 110 && native.hasInfo,
    JSON.stringify(native),
  );
  await page.context().close();

  // Page five is A4 in /UserUnit 2 with an intrinsic quarter turn. Check
  // the layers at their layout zoom and again while CSS follows a new zoom.
  const mixed = await newPage("synthetic-mixed-sizes.pdf", "&scale=1&forms=1&annotations=1");
  await mixed.evaluate(() => window.__viewer?.goToPage(4));
  const fifth = mixed.locator('section[data-page="5"]');
  await fifth.locator(".textWidgetAnnotation input").waitFor({ state: "attached" });
  await fifth.locator(".parapdf-editor-layer[data-main-rotation]").waitFor({ state: "attached" });
  await mixed.evaluate(() => window.__annotations?.setTool("ink"));
  for (const zoom of [1, 1.5]) {
    await mixed.evaluate((scale) => window.__viewer?.setScale(scale), zoom);
    const bounds = await fifth.evaluate((host) => {
      const origin = host.getBoundingClientRect();
      const box = (selector: string) => {
        const rect = host.querySelector(selector)?.getBoundingClientRect();
        return rect && [rect.left - origin.left, rect.top - origin.top, rect.width, rect.height];
      };
      const text = box(".parapdf-text-layer span");
      return {
        text,
        link: box(".linkAnnotation"),
        field: box(".textWidgetAnnotation"),
        editor: box(".parapdf-editor-layer"),
      };
    });
    const at = (actual: number[] | undefined, expected: number[]) =>
      actual?.every((n, i) => Math.abs(n - (expected[i] ?? 0) * zoom) < 2) ?? false;
    check(
      `rotated text and controls follow the page's units at scale ${zoom}`,
      !!bounds.text &&
        Math.abs((bounds.text[1] ?? 0) - 96 * zoom) < 2 &&
        at(bounds.link, [280, 80, 24, 120]) &&
        at(bounds.field, [200, 80, 24, 120]) &&
        at(bounds.editor, [0, 0, 842, 595]),
      JSON.stringify(bounds),
    );
  }
  const searchBox = await mixed.evaluate(async () => {
    const text = await window.__viewer?.session?.text(4);
    return Array.from(text?.boxes.slice(0, 4) ?? []);
  });
  // At (48, 349) in raw units, the first run is 18 units tall. Its font
  // height becomes its width when the file turns the page clockwise.
  check(
    "unmounted text positions use the same rotated PDF coordinates",
    searchBox[0] === 698 && searchBox[1] === 96 && searchBox[2] === 36 && (searchBox[3] ?? 0) > 400,
    JSON.stringify(searchBox),
  );
  await mixed.context().close();

  // A link followed in a turned view lands on its target.
  const guide = await newPage("usrguide.pdf");
  await guide
    .locator('section[data-page="1"] .parapdf-annotation-layer a')
    .first()
    .waitFor({ state: "attached", timeout: 30_000 });
  // The outline's button moves the toolbar as it arrives.
  await guide.getByRole("button", { name: "Outline", exact: true }).waitFor({ timeout: 30_000 });
  if (await rotate(guide, "Rotate clockwise")) await settle(guide, 90);
  const link = guide
    .locator('section[data-page="1"] .parapdf-annotation-layer a')
    .and(guide.locator('[title="2 Creating document commands and environments"]'))
    .first();
  if ((await link.count()) > 0) await link.click();
  await guide.waitForTimeout(1500);
  const landed = await guide.evaluate(() => {
    const scroller = document.querySelector(".parapdf-viewport")?.getBoundingClientRect();
    const viewer = (
      window as unknown as { __viewer: { store: { get(): { currentPage: number } } } }
    ).__viewer;
    const current = viewer.store.get().currentPage + 1;
    // The table of contents on page 1 names the section too; look on the target page.
    const span = [
      ...document.querySelectorAll(`section[data-page="${current}"] .parapdf-text-layer span`),
    ].find((element) => element.textContent?.includes("Creating document commands"));
    const rect = span?.getBoundingClientRect();
    return {
      page: current,
      visible:
        rect !== undefined &&
        scroller !== undefined &&
        rect.bottom > scroller.top &&
        rect.top < scroller.bottom &&
        rect.right > scroller.left &&
        rect.left < scroller.right,
    };
  });
  check(
    "a link followed in a turned view lands on its section",
    landed.page > 1 && landed.visible,
    JSON.stringify(landed),
  );
  await guide.context().close();

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
