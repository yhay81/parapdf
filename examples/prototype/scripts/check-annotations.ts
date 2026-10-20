/**
 * Functional checks for annotation editing (`annotationEditing`): drawing,
 * text, highlights of selected text, images, and typed signatures created on
 * usrguide.pdf; their styles, undo and redo; the annotations staying where
 * they were, without taking focus or adding undo steps, as their pages
 * unmount and mount again, zoom, and turn; saving them into the PDF's bytes,
 * read back by pdf.js; and exporting them, importing them into the document
 * opened again, pages that are not mounted included, and finding them there
 * as they were.
 *
 * Usage: pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:annotations
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

interface Saved {
  pageIndex: number;
  type: string;
  data: { rect?: number[] } & Record<string, unknown>;
}

/** The viewer runtime the demo exposes, as far as these checks call it. */
interface Viewer {
  store: {
    get(): {
      currentPage: number;
      annotationTool: string;
      annotationState: {
        canUndo: boolean;
        canRedo: boolean;
        hasSelection: boolean;
        isEmpty: boolean;
      } | null;
      annotationStyles: { ink: { color: string; thickness: number } } | null;
    };
  };
  stats: Record<string, number> | null;
  hasPixels(index: number): boolean;
  goToPage(index: number): void;
  setScale(scale: number | string): void;
  rotate(degrees?: number): void;
  setAnnotationTool(tool: string): Promise<void>;
  setAnnotationStyle(tool: string, style: object): void;
  undoAnnotation(): void;
  redoAnnotation(): void;
  addImage(image: Blob | string, options?: object): Promise<boolean>;
  addSignature(signature: object, options?: object): Promise<boolean>;
  exportAnnotations(): Saved[];
  importAnnotations(annotations: Saved[]): Promise<number>;
  save(): Promise<Uint8Array | null>;
}

/** The demo's window: other checks declare `__viewer` with their own `Viewer`. */
type Demo = { __viewer?: Viewer };

declare global {
  interface Window {
    pdfjsLib?: {
      getDocument(source: { data: Uint8Array }): {
        promise: Promise<{
          getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string }[]> }>;
        }>;
      };
    };
  }
}

const viewerState = (page: Page) =>
  page.evaluate(() => (window as unknown as Demo).__viewer?.store.get());
const exported = (page: Page) =>
  page.evaluate(() => (window as unknown as Demo).__viewer?.exportAnnotations() ?? []);

async function open(browser: Browser, url: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("calibrate.html", url).href);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(
    () => (window as unknown as Demo).__viewer?.hasPixels(0) === true,
    undefined,
    {
      timeout: 30_000,
    },
  );
  await editorLayer(page, 1);
  return { page, errors };
}

/** Waits until page `number` (one-based) has its annotation editor layer. */
const editorLayer = (page: Page, number: number) =>
  page.waitForFunction(
    (selector) => document.querySelector(selector)?.hasAttribute("data-main-rotation") === true,
    `section[data-page="${number}"] .parapdf-editor-layer`,
    { timeout: 15_000 },
  );

/** Whether two exports hold the same annotations at the same places, within half a point. */
function samePlaces(a: Saved[], b: Saved[]): boolean {
  return (
    a.length === b.length &&
    a.every((annotation, at) => {
      const other = b[at];
      const rect = annotation.data.rect ?? [];
      return (
        other !== undefined &&
        other.type === annotation.type &&
        other.pageIndex === annotation.pageIndex &&
        rect.every((value, side) => Math.abs(value - (other.data.rect?.[side] ?? Number.NaN)) < 0.5)
      );
    })
  );
}

/** The rectangles of the exported annotations, rounded, for reports. */
const rects = (annotations: Saved[]) =>
  annotations
    .map(({ pageIndex, type, data }) =>
      [pageIndex, type, ...(data.rect ?? []).map((value) => Math.round(value))].join(" "),
    )
    .join(" | ");

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4187, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4187/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const demo = (query: string) => `${baseUrl}?engine=${engine}&annotations=1&${query}`;

try {
  const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
  const section = page.locator('section[data-page="1"]');
  const box = await section.boundingBox();
  if (!box) throw new Error("page 1 has no box");

  check(
    "editing starts with no tool and nothing to undo",
    (await viewerState(page))?.annotationTool === "none" &&
      (await viewerState(page))?.annotationState?.canUndo === false,
  );

  // --- Drawing ---
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("ink"));
  await page.evaluate(() =>
    (window as unknown as Demo).__viewer?.setAnnotationStyle("ink", {
      color: "#ff0000",
      thickness: 3,
    }),
  );
  check(
    "a tool's style is published",
    (await viewerState(page))?.annotationStyles?.ink.color.toLowerCase() === "#ff0000" &&
      (await viewerState(page))?.annotationStyles?.ink.thickness === 3,
  );
  await page.mouse.move(box.x + 100, box.y + 150);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(box.x + 100 + step * 10, box.y + 150 + (step % 5) * 8);
  }
  await page.mouse.up();
  // Finishes the drawing, which takes more lines until then.
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("none"));
  let annotations = await exported(page);
  const ink = annotations.find((annotation) => annotation.type === "ink");
  check(
    "a drag draws a line in the tool's color",
    ink !== undefined && JSON.stringify(ink.data.color) === "[255,0,0]",
    JSON.stringify(ink?.data.color),
  );
  check(
    "the line is drawn into the page's canvas wrapper",
    (await section.locator(".parapdf-canvas-wrapper svg.draw").count()) > 0,
  );

  // --- Text ---
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("freetext"));
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.waitForTimeout(200);
  await page.keyboard.type("Hello ParaPDF");
  await page.mouse.click(box.x + 600, box.y + 700);
  await page.waitForTimeout(200);
  annotations = await exported(page);
  const text = annotations.find((annotation) => annotation.type === "freetext");
  check(
    "a click adds text the reader types",
    text?.data.value === "Hello ParaPDF",
    String(text?.data.value),
  );
  // Switching tools while typing finishes the text and keeps the new tool.
  await page.mouse.click(box.x + 300, box.y + 450);
  await page.waitForTimeout(200);
  await page.keyboard.type("Second");
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("highlight"));
  const second = (await exported(page)).find((annotation) => annotation.data.value === "Second");
  check(
    "choosing another tool while typing keeps the text and the new tool",
    second !== undefined && (await viewerState(page))?.annotationTool === "highlight",
    String((await viewerState(page))?.annotationTool),
  );
  if (second) {
    // The second text goes: what follows counts one of each kind.
    await page.locator(".freeTextEditor", { hasText: "Second" }).click();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
  }
  check(
    "a selected annotation is deleted with its key",
    !(await exported(page)).some((annotation) => annotation.data.value === "Second"),
  );
  const editorLabel = await section
    .locator(".freeTextEditor .internal")
    .first()
    .getAttribute("aria-label");
  check("the text editor is labelled", editorLabel === "Text Editor", String(editorLabel));

  // --- Highlight of selected text ---
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("highlight"));
  await page.mouse.click(box.x + 600, box.y + 700);
  const run = section.locator(".parapdf-text-layer span", { hasText: "Copyright" }).first();
  const runBox = await run.boundingBox();
  if (runBox) {
    await page.mouse.move(runBox.x + 2, runBox.y + runBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(runBox.x + runBox.width / 2, runBox.y + runBox.height / 2, { steps: 5 });
    await page.mouse.move(runBox.x + runBox.width - 2, runBox.y + runBox.height / 2, { steps: 5 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  annotations = await exported(page);
  check(
    "selecting text in the highlight tool highlights it",
    annotations.some((annotation) => annotation.type === "highlight"),
    `${annotations.length} annotations`,
  );
  check(
    "the highlight is drawn under the text layer",
    (await section.locator(".parapdf-canvas-wrapper svg.highlight").count()) > 0,
  );

  // --- Images and signatures ---
  const imageAdded = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(40, 20);
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "blue";
      context.fillRect(0, 0, 40, 20);
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return (window as unknown as Demo).__viewer?.addImage(blob, { altText: "Blue box" });
  });
  await page.waitForFunction(() => document.querySelector(".stampEditor canvas") !== null);
  check(
    "an image is added to the current page and selects the stamp tool",
    imageAdded === true && (await viewerState(page))?.annotationTool === "stamp",
  );
  const signed = await page.evaluate(() =>
    (window as unknown as Demo).__viewer?.addSignature(
      { text: "Ada Lovelace" },
      { description: "Ada Lovelace" },
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".signatureEditor")].some(
      (element) => !(element as HTMLElement).hidden,
    ),
  );
  check(
    "a typed signature is added and named by its description",
    signed === true &&
      (await page.locator(".signatureEditor").first().getAttribute("aria-label")) ===
        "Signature editor: Ada Lovelace",
  );
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("none"));
  annotations = await exported(page);
  const types = annotations.map((annotation) => annotation.type).sort();
  check(
    "every kind is exported",
    JSON.stringify(types) ===
      JSON.stringify(["freetext", "highlight", "ink", "signature", "stamp"]),
    types.join(","),
  );
  check(
    "the export survives JSON",
    JSON.stringify(JSON.parse(JSON.stringify(annotations))) === JSON.stringify(annotations),
  );

  // --- Undo and redo ---
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("ink"));
  const beforeUndo = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__viewer?.undoAnnotation());
  const afterUndo = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__viewer?.redoAnnotation());
  const afterRedo = (await exported(page)).length;
  check(
    "undo removes the last annotation and redo brings it back",
    afterUndo === beforeUndo - 1 && afterRedo === beforeUndo,
    `${beforeUndo} → ${afterUndo} → ${afterRedo}`,
  );
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("none"));

  // --- Pages that unmount and mount again ---
  await page
    .getByRole("searchbox")
    .first()
    .focus()
    .catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  // With a tool chosen, the layer that shows them again is not hidden, and
  // pdf.js's editors focus themselves as it adds them.
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("ink"));
  await page.getByRole("searchbox").first().focus();
  const before = await exported(page);
  await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(20));
  await page.waitForFunction(() => document.querySelector('section[data-page="1"]') === null);
  await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(0));
  await editorLayer(page, 1);
  await page.waitForTimeout(300);
  check(
    "annotations stay where they were after their page mounts again",
    samePlaces(await exported(page), before),
  );
  check(
    "their page shows them again",
    (await section.locator(".freeTextEditor, .stampEditor, .signatureEditor").count()) === 3 &&
      (await section.locator(".parapdf-canvas-wrapper svg.draw").count()) > 0,
  );
  check(
    "showing them again takes no focus",
    (await page.evaluate(() => document.activeElement?.tagName ?? "")) === focused,
    focused,
  );
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("ink"));
  const count = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__viewer?.undoAnnotation());
  const afterRemountUndo = await exported(page);
  check(
    "showing them again adds no undo step",
    afterRemountUndo.length === count - 1 &&
      !afterRemountUndo.some((annotation) => annotation.type === "signature"),
    `${count} → ${afterRemountUndo.length}`,
  );
  await page.evaluate(() => (window as unknown as Demo).__viewer?.redoAnnotation());
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setAnnotationTool("none"));

  // --- Zoom and rotation ---
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale(2));
  await page.waitForTimeout(300);
  const zoomed = await exported(page);
  check(
    "zooming keeps their place on the page",
    samePlaces(zoomed, before),
    `${rects(zoomed)} vs ${rects(before)}`,
  );
  await page.evaluate(() => (window as unknown as Demo).__viewer?.rotate(90));
  await page.waitForTimeout(300);
  const turned = await page.evaluate(() =>
    document
      .querySelector('section[data-page="1"] .parapdf-editor-layer')
      ?.getAttribute("data-main-rotation"),
  );
  check("their layer turns with the view", turned === "90", String(turned));
  await page.evaluate(() => (window as unknown as Demo).__viewer?.rotate(-90));
  await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale("fit-width"));
  await page.waitForTimeout(300);
  check("turning back leaves them where they were", samePlaces(await exported(page), before));

  check("no errors while editing", errors.length === 0, errors.slice(0, 3).join(" | "));

  // --- Saving into the PDF ---
  // Read back by a second document, whose worker WebKit refuses from its
  // cache in this context: pdf.js then parses on the page.
  const subtypes = await page.evaluate(async () => {
    const bytes = await (window as unknown as Demo).__viewer?.save();
    if (!bytes || !window.pdfjsLib) return [];
    const saved = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const first = await saved.getPage(1);
    return (await first.getAnnotations()).map((annotation) => annotation.subtype);
  });
  check(
    "save() writes them into the PDF",
    ["FreeText", "Highlight", "Ink", "Stamp"].every((subtype) => subtypes.includes(subtype)),
    subtypes.filter((subtype) => subtype !== "Link").join(","),
  );
  const saved = await exported(page);
  await page.context().close();

  // --- Importing into the document opened again ---
  {
    const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
    // The same drawing again on page 16, which is not mounted.
    const ink = saved.find((annotation) => annotation.type === "ink");
    const elsewhere = ink ? [{ ...ink, pageIndex: 15, data: { ...ink.data, pageIndex: 15 } }] : [];
    const added = await page.evaluate(
      (annotations) => (window as unknown as Demo).__viewer?.importAnnotations(annotations),
      [...saved, ...elsewhere],
    );
    check(
      "importing adds every annotation",
      added === saved.length + elsewhere.length,
      String(added),
    );
    const again = (await exported(page)).filter((annotation) => annotation.pageIndex === 0);
    check(
      "imported annotations are where they were exported",
      samePlaces(again, saved),
      `${rects(again)} vs ${rects(saved)}`,
    );
    check(
      "the page shows them",
      (await page
        .locator('section[data-page="1"] :is(.freeTextEditor, .stampEditor, .signatureEditor)')
        .count()) === 3,
    );
    check(
      "importing adds no undo step",
      (await viewerState(page))?.annotationState?.canUndo === false &&
        (await viewerState(page))?.annotationState?.isEmpty === false,
    );
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(15));
    await editorLayer(page, 16);
    check(
      "an annotation imported to a page that was not mounted shows once it mounts",
      (await page.locator('section[data-page="16"] .parapdf-canvas-wrapper svg.draw').count()) > 0,
    );
    // A signature the application drew, as strokes in a box of its own.
    const signatures = async () =>
      (await exported(page)).filter((annotation) => annotation.type === "signature").length;
    const signaturesBefore = await signatures();
    const drawn = await page.evaluate(() =>
      (window as unknown as Demo).__viewer?.addSignature(
        { strokes: [[10, 30, 40, 5, 70, 35, 100, 10]], width: 110, height: 40, thickness: 2 },
        { pageIndex: 0, description: "Drawn" },
      ),
    );
    await page.waitForTimeout(300);
    check(
      "a signature drawn as strokes is added",
      drawn === true && (await signatures()) === signaturesBefore + 1,
    );
    check("no errors while importing", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
