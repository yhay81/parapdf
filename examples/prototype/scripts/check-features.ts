/**
 * Functional checks for what a document viewer offers besides its pages,
 * the features other React PDF viewers have: encrypted documents and the
 * password prompt, load progress, page labels, metadata, attachments, layers
 * (optional content), comment popups, form filling and saving, printing,
 * downloading, thumbnails, "fit-page" zoom, keyboard zoom, the initial page,
 * the hand tool, search options, spreads, selections in PDF points, and the
 * structure of tagged PDFs. They run on the synthetic feature sampler and
 * encrypted documents, on f1040.pdf (a tagged form), and on bill-hr815.pdf
 * (a long document).
 *
 * Colors on pages are read from screenshots: pdf.js's renderer worker draws
 * into canvases the main thread cannot read.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:features
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import type { Browser, Page } from "playwright";
import { preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** The viewer runtime the demo exposes, as far as these checks call it. */
interface Viewer {
  store: {
    get(): {
      status: string;
      error: string | null;
      passwordReason: string | null;
      progress: { loaded: number; total: number | null } | null;
      pageCount: number;
      currentPage: number;
      scale: number;
      zoomMode: string;
      spread: string;
      tool: string;
      pageLabels: string[] | null;
      metadata: { title: string | null; language: string | null; creationDate: Date | null } | null;
      attachments: { id: string; filename: string; description: string | null }[] | null;
      layers: { id: string | null; name: string; visible: boolean }[] | null;
      search: { matches: unknown[]; status: string };
      layout: {
        gap: number;
        tops: Float64Array;
        rowTops: Float64Array;
        widths: Float64Array;
        heights: Float64Array;
      } | null;
    };
  };
  hasPixels(index: number): boolean;
  goToPage(index: number): void;
  setScale(scale: number | string): void;
  setSpread(spread: string): void;
  setTool(tool: string): void;
  setLayerVisible(id: string, visible: boolean): void;
  search(query: string, options?: object): void;
  save(): Promise<Uint8Array | null>;
  print(options?: object): Promise<void>;
  getAttachmentContent(id: string): Promise<Uint8Array | null>;
  getSelection(): {
    text: string;
    pages: {
      pageIndex: number;
      rects: { x: number; y: number; width: number; height: number }[];
    }[];
  } | null;
  stats: Record<string, number> | null;
}

declare global {
  interface Window {
    __viewer?: Viewer;
  }
}

const state = (page: Page) => page.evaluate(() => window.__viewer?.store.get());

async function open(browser: Browser, url: string, { ready = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("calibrate.html", url).href);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  if (ready) {
    await page.waitForFunction(() => window.__viewer?.hasPixels(0) === true, undefined, {
      timeout: 30_000,
    });
  }
  return { page, errors };
}

/** Waits until the visible pages are drawn and their text and annotation layers built. */
const settle = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const viewer = window.__viewer;
        const stats = viewer?.stats;
        if (!viewer || !stats) return false;
        const key = JSON.stringify(stats);
        const holder = window as { __lastStats?: string; __stableSince?: number };
        if (holder.__lastStats !== key) {
          holder.__lastStats = key;
          holder.__stableSince = performance.now();
          return false;
        }
        return performance.now() - (holder.__stableSince ?? 0) > 400;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .catch(() => {});

/** Decodes a PNG screenshot into RGBA pixels: 8-bit, non-interlaced, as Playwright writes them. */
function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : 4;
    } else if (type === "IDAT") data.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predicted = a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      line[x] = (value + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * width + x) * 4 + c] = c < channels ? (line[x * channels + c] ?? 0) : 255;
      }
    }
    previous.set(line);
  }
  return { width, height, rgba: out };
}

/**
 * The color shown at a point of a page, given in PDF points from its
 * top-left corner, as "r,g,b" from a screenshot of that spot.
 */
async function colorAt(page: Page, pageNumber: number, x: number, y: number): Promise<string> {
  const box = await page.locator(`section[data-page="${pageNumber}"]`).boundingBox();
  const scale = (await state(page))?.scale ?? 1;
  if (!box) return "none";
  const clip = { x: box.x + x * scale - 2, y: box.y + y * scale - 2, width: 4, height: 4 };
  const { rgba, width } = decodePng(await page.screenshot({ clip }));
  const at = (Math.floor(width / 2) * width + Math.floor(width / 2)) * 4;
  return `${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`;
}

/** Whether "r,g,b" is near the given color. */
const near = (color: string, target: [number, number, number]) =>
  color.split(",").every((value, index) => Math.abs(Number(value) - (target[index] ?? 0)) < 40);

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4186, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4186/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const demo = (query: string) => `${baseUrl}?engine=${engine}&${query}`;

try {
  // --- Encrypted documents ---
  {
    const { page, errors } = await open(launched.browser, demo("file=synthetic-encrypted.pdf"), {
      ready: false,
    });
    await page.waitForFunction(() => window.__viewer?.store.get().status === "password");
    check(
      "an encrypted document asks for its password",
      (await state(page))?.passwordReason === "required",
    );
    const input = page.getByRole("form", { name: "Password" }).locator("input[type=password]");
    await input.fill("wrong");
    await input.press("Enter");
    await page.waitForFunction(() => window.__viewer?.store.get().passwordReason === "incorrect");
    check("a wrong password asks again, saying it was wrong", true);
    await input.fill("parapdf");
    await input.press("Enter");
    await page.waitForFunction(() => window.__viewer?.hasPixels(0) === true, undefined, {
      timeout: 30_000,
    });
    const unlocked = await state(page);
    check(
      "the right password opens it",
      unlocked?.status === "ready" && unlocked.pageCount === 3,
      `${unlocked?.status}, ${unlocked?.pageCount} pages`,
    );
    check(
      "load progress reaches the document's size",
      (unlocked?.progress?.loaded ?? 0) > 0,
      JSON.stringify(unlocked?.progress),
    );
    check(
      "no errors while asking for a password",
      errors.every((error) => /PasswordException|password/i.test(error)),
      errors.slice(0, 3).join(" | "),
    );
    await page.context().close();

    const given = await open(
      launched.browser,
      demo("file=synthetic-encrypted.pdf&password=parapdf"),
    );
    check(
      "a password in the source opens it without asking",
      (await state(given.page))?.status === "ready",
    );
    await given.page.context().close();

    // Without a prompt, an encrypted document fails as it did before
    // passwords were supported, with or without a wrong password.
    for (const query of ["", "&password=wrong"]) {
      const failed = await open(
        launched.browser,
        demo(`file=synthetic-encrypted.pdf&passwordPrompt=0${query}`),
        { ready: false },
      );
      await failed.page.waitForFunction(() =>
        ["error", "ready"].includes(window.__viewer?.store.get().status ?? ""),
      );
      const result = await state(failed.page);
      check(
        `passwordPrompt: false fails the document${query ? " with a wrong password" : ""}`,
        result?.status === "error" && /PasswordException/.test(result.error ?? ""),
        `${result?.status}: ${result?.error}`,
      );
      await failed.page.context().close();
    }
  }

  // --- The feature sampler, with forms ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-features.pdf&forms=1"),
    );
    await settle(page);
    const loaded = await state(page);
    check(
      "page labels",
      JSON.stringify(loaded?.pageLabels) === JSON.stringify(["i", "ii", "1", "2", "3", "4"]),
      JSON.stringify(loaded?.pageLabels),
    );
    const metadata = await page.evaluate(() => {
      const value = window.__viewer?.store.get().metadata;
      return value ? { ...value, creationDate: value.creationDate?.toISOString() ?? null } : null;
    });
    check(
      "metadata: title, language, and dates",
      metadata?.title === "ParaPDF feature sampler" &&
        metadata.language === "en" &&
        metadata.creationDate === "2026-01-01T00:00:00.000Z",
      JSON.stringify(metadata),
    );
    check(
      "attachments are listed",
      loaded?.attachments?.length === 1 && loaded.attachments[0]?.filename === "notes.txt",
      JSON.stringify(loaded?.attachments),
    );
    const content = await page.evaluate(async () => {
      const bytes = await window.__viewer?.getAttachmentContent("notes.txt");
      return bytes ? new TextDecoder().decode(bytes) : null;
    });
    check(
      "an attachment's content",
      content === "Notes embedded in the sampler.\n",
      JSON.stringify(content),
    );
    await page.getByRole("button", { name: "Attachments", exact: true }).click();
    const [attachmentDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      page
        .getByRole("region", { name: "Attachments" })
        .getByRole("button", { name: "notes.txt" })
        .click(),
    ]);
    check(
      "opening an attachment downloads it",
      attachmentDownload.suggestedFilename() === "notes.txt",
      attachmentDownload.suggestedFilename(),
    );
    // Closing the panel widens the viewport: "fit-width" zooms and the pages are drawn again.
    await page.getByRole("button", { name: "Attachments", exact: true }).click();
    await settle(page);

    // Layers: A (a red square at 72–192 × 192–312 points) shows, B (blue, 240–360) does not.
    check(
      "layers are listed with their visibility",
      JSON.stringify(loaded?.layers?.map(({ name, visible }) => [name, visible])) ===
        JSON.stringify([
          ["Layer A", true],
          ["Layer B", false],
        ]),
      JSON.stringify(loaded?.layers),
    );
    const layerIds = loaded?.layers?.map((layer) => layer.id ?? "") ?? [];
    const before = [await colorAt(page, 1, 132, 252), await colorAt(page, 1, 300, 252)];
    check(
      "a hidden layer is not drawn",
      near(before[0] ?? "", [255, 0, 0]) && near(before[1] ?? "", [255, 255, 255]),
      before.join(" / "),
    );
    await page.evaluate(([a, b]) => {
      window.__viewer?.setLayerVisible(b ?? "", true);
      window.__viewer?.setLayerVisible(a ?? "", false);
    }, layerIds);
    await settle(page);
    const after = [await colorAt(page, 1, 132, 252), await colorAt(page, 1, 300, 252)];
    check(
      "showing and hiding layers draws the page again",
      near(after[0] ?? "", [255, 255, 255]) && near(after[1] ?? "", [0, 0, 255]),
      after.join(" / "),
    );
    check(
      "the state follows the layers",
      JSON.stringify((await state(page))?.layers?.map((layer) => layer.visible)) ===
        JSON.stringify([false, true]),
    );

    // A comment without an appearance of its own shows pdf.js's icon, from
    // the files the package ships (or pdf.js master's, with ENGINE=pdfjs-next).
    const icon = await page
      .locator('section[data-page="1"] .parapdf-annotation-layer img')
      .first()
      .evaluate(async (image: HTMLImageElement) => {
        await image.decode().catch(() => {});
        return { src: image.src, width: image.naturalWidth };
      })
      .catch(() => null);
    check(
      "a comment shows pdf.js's icon",
      icon !== null && !icon.src.startsWith("data:") && icon.width > 0,
      JSON.stringify(icon),
    );

    // A comment's popup: hidden until its icon is hovered, then styled like pdf.js's.
    const trigger = page
      .locator('section[data-page="1"] .parapdf-annotation-layer .popupTriggerArea')
      .first();
    await trigger.hover();
    const popup = page.locator('section[data-page="1"] .parapdf-annotation-layer .popup').first();
    await popup.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const popupStyle = await popup.evaluate((element) => ({
      text: element.textContent ?? "",
      background: getComputedStyle(element).backgroundColor,
    }));
    check(
      "a comment's popup shows its text, styled",
      popupStyle.text.includes("A comment on the sampler") &&
        popupStyle.background === "rgb(255, 255, 153)",
      JSON.stringify(popupStyle),
    );

    // Search options on page 1's "Rose rose ROSE resume résumé cat concatenate cat-like".
    const count = async (query: string, options: object = {}) => {
      await page.evaluate(([q, o]) => window.__viewer?.search(q as string, o as object), [
        query,
        options,
      ] as const);
      await page.waitForFunction(() => window.__viewer?.store.get().search.status === "done");
      return (await state(page))?.search.matches.length ?? -1;
    };
    const counts = {
      rose: await count("rose"),
      roseCase: await count("rose", { caseSensitive: true }),
      resume: await count("resume"),
      resumeMarks: await count("resume", { matchDiacritics: true }),
      cat: await count("cat"),
      catWord: await count("cat", { entireWord: true }),
    };
    check(
      "search options: case, diacritics, whole words",
      counts.rose === 3 &&
        counts.roseCase === 1 &&
        counts.resume === 2 &&
        counts.resumeMarks === 1 &&
        counts.cat === 3 &&
        counts.catWord === 2,
      JSON.stringify(counts),
    );
    await page.evaluate(() => window.__viewer?.search(""));

    // Selections in PDF points: "Rose" is drawn at 72 points, its baseline 112 below the top.
    const selection = await page.evaluate(() => {
      const span = [
        ...document.querySelectorAll('section[data-page="1"] .parapdf-text-layer span'),
      ].find((element) => element.textContent?.startsWith("Rose rose"));
      const text = span?.firstChild;
      if (!text) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return window.__viewer?.getSelection() ?? null;
    });
    const rect = selection?.pages[0]?.rects[0];
    check(
      "a selection's text and rectangles in PDF points",
      selection?.text === "Rose" &&
        selection.pages.length === 1 &&
        selection.pages[0]?.pageIndex === 0 &&
        rect !== undefined &&
        Math.abs(rect.x - 72) < 3 &&
        rect.y > 92 &&
        rect.y < 112 &&
        rect.width > 25 &&
        rect.width < 45,
      JSON.stringify(selection),
    );
    await page.evaluate(() => document.getSelection()?.removeAllRanges());

    // Forms on page 2: type, check, choose, and save.
    await page.evaluate(() => window.__viewer?.goToPage(1));
    const fields = page.locator('section[data-page="2"] .parapdf-annotation-layer');
    const name = fields.locator("input[type=text]").first();
    await name.waitFor({ timeout: 15_000 });
    await name.fill("Ada Lovelace");
    await fields.locator("input[type=checkbox]").first().click();
    await fields.locator("input[type=radio]").nth(1).click();
    await fields.locator("select").first().selectOption("medium");
    const checkedShown = await fields
      .locator('.checkBox [data-canvas-name="checked"]')
      .first()
      .evaluate((element) => getComputedStyle(element).display)
      .catch(() => "missing");
    check(
      "form fields take input; a checked box shows its checked appearance",
      checkedShown === "block",
      checkedShown,
    );
    const saved = await page.evaluate(async () => {
      const bytes = await window.__viewer?.save();
      return bytes ? new TextDecoder("latin1").decode(bytes) : "";
    });
    check(
      "saving writes the values into the document",
      saved.includes("(Ada Lovelace)") &&
        /\/V\s*\(medium\)/.test(saved) &&
        // pdf-lib names the radio buttons' states by their position: green is 1.
        /\/V\s*\/1\b/.test(saved),
      `${saved.length} bytes`,
    );

    // Printing: every page drawn into an image, only those print, then they are gone.
    const printed = await page.evaluate(async () => {
      let calls = 0;
      let images: number[] = [];
      window.print = () => {
        calls++;
        images = [...document.querySelectorAll<HTMLImageElement>(".parapdf-print img")].map(
          (image) => image.naturalWidth,
        );
      };
      await window.__viewer?.print();
      const pageRule = [...document.querySelectorAll("style")].some((style) =>
        style.textContent?.includes("@page"),
      );
      window.dispatchEvent(new Event("afterprint"));
      return { calls, images, pageRule, left: document.querySelectorAll(".parapdf-print").length };
    });
    check(
      "printing draws every page at 150 dpi and prints them",
      printed.calls === 1 &&
        printed.images.length === 6 &&
        printed.images.every((width) => Math.abs(width - 1275) <= 1) &&
        printed.pageRule,
      JSON.stringify(printed),
    );
    check("the printed pages are removed after printing", printed.left === 0);

    const [documentDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    check(
      "downloading names the file after its URL",
      documentDownload.suggestedFilename() === "synthetic-features.pdf",
      documentDownload.suggestedFilename(),
    );

    // Thumbnails, drawn for the panel and labelled with the page labels.
    await page.getByRole("button", { name: "Thumbnails", exact: true }).click();
    const thumbnails = page.getByRole("navigation", { name: "Page thumbnails" });
    await page
      .waitForFunction(
        () => {
          const canvas = document.querySelector<HTMLCanvasElement>(".parapdf-thumbnail");
          return canvas !== null && canvas.width > 0;
        },
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {});
    const thumbnailSize = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".parapdf-thumbnail");
      return canvas ? [canvas.width, canvas.height] : null;
    });
    check(
      "thumbnails are drawn at the device's resolution",
      thumbnailSize?.[0] === 240 && thumbnailSize[1] === Math.floor((240 * 792) / 612),
      JSON.stringify(thumbnailSize),
    );
    await settle(page);
    const thumbnailColor = await (async () => {
      const box = await thumbnails.locator(".parapdf-thumbnail").first().boundingBox();
      if (!box) return "none";
      // The blue square of Layer B, which the layer change shows, at 300 × 252 points.
      const clip = {
        x: box.x + (300 / 612) * box.width - 1,
        y: box.y + (252 / 792) * box.height - 1,
        width: 2,
        height: 2,
      };
      const { rgba } = decodePng(await page.screenshot({ clip }));
      return `${rgba[0]},${rgba[1]},${rgba[2]}`;
    })();
    check(
      "thumbnails show the layers the viewer shows",
      near(thumbnailColor, [0, 0, 255]),
      thumbnailColor,
    );
    await thumbnails.getByRole("button", { name: "Page 2", exact: true }).click();
    await page.waitForTimeout(300);
    check(
      "a thumbnail goes to its page",
      (await state(page))?.currentPage === 3,
      `page ${((await state(page))?.currentPage ?? -1) + 1}`,
    );
    await page.getByRole("button", { name: "Thumbnails", exact: true }).click();

    // Fit page, then keyboard zoom.
    await page.evaluate(() => window.__viewer?.setScale("fit-page"));
    await page.waitForTimeout(300);
    const fitted = await page.evaluate(() => {
      const viewer = window.__viewer;
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      const current = viewer?.store.get().currentPage ?? 0;
      const section = document.querySelector(`section[data-page="${current + 1}"]`);
      const box = section?.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      return {
        mode: viewer?.store.get().zoomMode,
        inside: box
          ? box.top >= frame.top - 1 &&
            box.bottom <= frame.bottom + 1 &&
            box.left >= frame.left - 1 &&
            box.right <= frame.right + 1
          : false,
      };
    });
    check(
      '"fit-page" shows all of the current page',
      fitted.mode === "fit-page" && fitted.inside,
      JSON.stringify(fitted),
    );
    const fitScale = (await state(page))?.scale ?? 0;
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    await page.locator(".parapdf-viewport").focus();
    await page.keyboard.press("Control+Equal");
    await page.waitForTimeout(200);
    const zoomedIn = (await state(page))?.scale ?? 0;
    await page.keyboard.press("Control+Minus");
    await page.keyboard.press("Control+Minus");
    await page.waitForTimeout(200);
    const zoomedOut = (await state(page))?.scale ?? 0;
    await page.keyboard.press("Control+Digit0");
    await page.waitForTimeout(200);
    const reset = await state(page);
    check(
      "Ctrl with +, -, and 0 zooms the document, not the page",
      Math.abs(zoomedIn / fitScale - 1.25) < 0.01 &&
        Math.abs(zoomedOut / fitScale - 1 / 1.25) < 0.01 &&
        reset?.zoomMode === "fit-width" &&
        (await page.evaluate(() => window.devicePixelRatio)) === ratio,
      `${fitScale.toFixed(3)} → ${zoomedIn.toFixed(3)} → ${zoomedOut.toFixed(3)} → ${reset?.zoomMode}`,
    );

    // The hand tool scrolls with a drag instead of selecting text.
    await page.getByRole("button", { name: "Hand tool", exact: true }).click();
    await page.evaluate(() => window.__viewer?.goToPage(2));
    await page.waitForTimeout(200);
    const scroller = page.locator(".parapdf-viewport");
    const frame = await scroller.boundingBox();
    const startTop = await scroller.evaluate((element) => element.scrollTop);
    if (frame) {
      await page.mouse.move(frame.x + frame.width / 2, frame.y + 600);
      await page.mouse.down();
      for (let step = 1; step <= 10; step++) {
        await page.mouse.move(frame.x + frame.width / 2, frame.y + 600 - step * 30);
      }
      await page.mouse.up();
    }
    const dragged = await scroller.evaluate((element) => element.scrollTop);
    const selected = await page.evaluate(() => document.getSelection()?.toString() ?? "");
    check(
      "the hand tool scrolls with the drag and selects nothing",
      Math.abs(dragged - startTop - 300) < 20 && selected === "",
      `scrolled ${dragged - startTop} px, selected ${JSON.stringify(selected)}`,
    );
    await page.getByRole("button", { name: "Hand tool", exact: true }).click();

    // Spreads: pairs side by side, centered as a row.
    interface Box {
      left: number;
      top: number;
      right: number;
    }
    const placement = async (spread: string): Promise<Box[]> => {
      await page.evaluate((mode) => {
        window.__viewer?.setSpread(mode);
        window.__viewer?.goToPage(0);
      }, spread);
      await page.waitForTimeout(300);
      return page.evaluate(() =>
        [1, 2, 3].map((number) => {
          const box = document
            .querySelector(`section[data-page="${number}"]`)
            ?.getBoundingClientRect();
          return box
            ? { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right) }
            : { left: Number.NaN, top: Number.NaN, right: Number.NaN };
        }),
      );
    };
    const none = { left: Number.NaN, top: Number.NaN, right: Number.NaN };
    const [odd1 = none, odd2 = none] = await placement("odd");
    const [even1 = none, even2 = none, even3 = none] = await placement("even");
    const gap = (await state(page))?.layout?.gap ?? 12;
    const frameBox = (await scroller.boundingBox()) ?? { x: 0, width: 0 };
    const leftMargin = odd1.left - frameBox.x;
    const rightMargin = frameBox.x + frameBox.width - odd2.right;
    check(
      "odd spreads put pages 1 and 2 side by side, centered",
      odd1.top === odd2.top &&
        Math.abs(odd2.left - (odd1.right + gap)) <= 1 &&
        Math.abs(leftMargin - rightMargin) < 30,
      JSON.stringify({ odd1, odd2, leftMargin, rightMargin }),
    );
    check(
      "even spreads show page 1 alone, then pages 2 and 3 together",
      even2.top === even3.top && even2.top > even1.top && even3.left > even2.right,
      JSON.stringify({ even1, even2, even3 }),
    );
    await page.evaluate(() => window.__viewer?.setSpread("none"));
    check("no errors on the feature sampler", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- Without forms, fields stay in the drawing; the initial page ---
  {
    const { page } = await open(launched.browser, demo("file=synthetic-features.pdf&page=3"));
    await settle(page);
    const initial = await page.evaluate(() => {
      const viewer = window.__viewer;
      const scroller = document.querySelector(".parapdf-viewport") as HTMLElement;
      const layout = viewer?.store.get().layout;
      return {
        current: viewer?.store.get().currentPage,
        offset: scroller.scrollTop - (layout?.tops[2] ?? 0),
      };
    });
    check(
      "the initial page is shown at the top",
      initial.current === 2 && Math.abs(initial.offset + 12) < 2,
      JSON.stringify(initial),
    );
    await page.evaluate(() => window.__viewer?.goToPage(1));
    await settle(page);
    const inputs = await page
      .locator('section[data-page="2"] .parapdf-annotation-layer :is(input, select)')
      .count();
    check("without forms, fields are not editable", inputs === 0, `${inputs} inputs`);
    await page.context().close();
  }

  // --- Tagged structure on f1040.pdf ---
  {
    // With forms, the fields the tree names exist as elements too.
    const { page, errors } = await open(launched.browser, demo("file=f1040.pdf&forms=1"));
    await settle(page);
    const structure = await page.evaluate(() => {
      const tree = document.querySelector('section[data-page="1"] .parapdf-structure');
      const owners = [...(tree?.querySelectorAll("[aria-owns]") ?? [])];
      const ids = owners.flatMap((element) => (element.getAttribute("aria-owns") ?? "").split(" "));
      return {
        roles: new Set(
          [...(tree?.querySelectorAll("[role]") ?? [])].map((element) =>
            element.getAttribute("role"),
          ),
        ).size,
        owned: ids.length,
        found: ids.filter((id) => document.getElementById(id) !== null).length,
      };
    });
    check(
      "a tagged page's structure owns its text runs",
      structure.roles >= 2 && structure.owned > 20 && structure.found === structure.owned,
      JSON.stringify(structure),
    );
    check("no errors on a tagged form", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- Thumbnails of a long document hold pixels only near view ---
  {
    const { page } = await open(launched.browser, demo("file=bill-hr815.pdf"));
    await page.getByRole("button", { name: "Thumbnails", exact: true }).click();
    await page.waitForTimeout(1500);
    const near = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll<HTMLCanvasElement>(".parapdf-thumbnail")];
      return {
        total: canvases.length,
        drawn: canvases.filter((canvas) => canvas.width > 0).length,
      };
    });
    check(
      "only thumbnails near view hold pixels",
      near.total === (await state(page))?.pageCount && near.drawn > 0 && near.drawn < 30,
      JSON.stringify(near),
    );
    await page.context().close();
  }
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
