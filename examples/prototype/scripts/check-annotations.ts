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
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";
import { decodePng } from "./png.ts";

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

interface Saved {
  pageIndex: number;
  type: string;
  data: { rect?: number[] } & Record<string, unknown>;
}

/** The viewer runtime the demo exposes, as far as these checks call it. */
interface Viewer {
  store: { get(): { currentPage: number } };
  stats: Record<string, number> | null;
  hasPixels(index: number): boolean;
  goToPage(index: number): void;
  setScale(scale: number | string): void;
  rotate(degrees?: number): void;
}

/** The viewer's annotation editing, which the demo loads for `?annotations=1`. */
interface Editing {
  store: {
    get(): {
      tool: string;
      state: {
        canUndo: boolean;
        canRedo: boolean;
        hasSelection: boolean;
        isEmpty: boolean;
        selected: {
          id: string;
          pageIndex: number;
          type: string;
          comment: string | null;
          altText: { text: string; decorative: boolean } | null;
        } | null;
      } | null;
      styles: { ink: { color: string; thickness: number } } | null;
    };
  };
  setTool(tool: string): Promise<void>;
  setStyle(tool: string, style: object): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  setComment(comment: string | null): boolean;
  setAltText(altText: { text: string; decorative: boolean }): boolean;
  addImage(image: Blob | string, options?: object): Promise<boolean>;
  addSignature(signature: object, options?: object): Promise<boolean>;
  export(): Saved[];
  import(annotations: Saved[]): Promise<number>;
}

/** The demo's window: other checks declare `__viewer` with their own `Viewer`. */
type Demo = {
  __viewer?: Viewer;
  __annotations?: Editing | null;
  __parapdf?: { save(viewer: Viewer | undefined): Promise<Uint8Array | null> };
};

interface ImageResult {
  added: boolean;
  exported: number;
  saved: number;
  altText?: unknown;
}

type ImageDemo = Demo & {
  __imageSettled?: boolean;
  __imageResult?: Promise<ImageResult>;
  __pendingImage?: Promise<boolean | undefined>;
  __lifecycle?: { unmount(): void };
};

type SignatureDemo = Demo & {
  __signatureDecodeStarted?: boolean;
  __releaseSignatureDecode?: () => void;
  __pendingSignature?: Promise<boolean | undefined>;
};

declare global {
  interface Window {
    pdfjsLib?: {
      getDocument(source: { data: Uint8Array }): {
        promise: Promise<{
          getPage(n: number): Promise<{
            getAnnotations(): Promise<{ subtype: string; contentsObj?: { str: string } }[]>;
          }>;
        }>;
      };
    };
  }
}

const viewerState = (page: Page) =>
  page.evaluate(() => {
    const demo = window as unknown as Demo;
    const editing = demo.__annotations?.store.get();
    return {
      currentPage: demo.__viewer?.store.get().currentPage ?? 0,
      annotationTool: editing?.tool ?? "none",
      annotationState: editing?.state ?? null,
      annotationStyles: editing?.styles ?? null,
    };
  });
const exported = (page: Page) =>
  page.evaluate(() => (window as unknown as Demo).__annotations?.export() ?? []);

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
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
  await page.evaluate(() =>
    (window as unknown as Demo).__annotations?.setStyle("ink", {
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("freetext"));
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("highlight"));
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("highlight"));
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
    return (window as unknown as Demo).__annotations?.addImage(blob, { altText: "Blue box" });
  });
  await page.waitForFunction(() => document.querySelector(".stampEditor canvas") !== null);
  check(
    "an image is added to the current page and selects the stamp tool",
    imageAdded === true && (await viewerState(page))?.annotationTool === "stamp",
  );
  const signed = await page.evaluate(() =>
    (window as unknown as Demo).__annotations?.addSignature(
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
  const beforeUndo = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
  const afterUndo = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__annotations?.redo());
  const afterRedo = (await exported(page)).length;
  check(
    "undo removes the last annotation and redo brings it back",
    afterUndo === beforeUndo - 1 && afterRedo === beforeUndo,
    `${beforeUndo} → ${afterUndo} → ${afterRedo}`,
  );
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));

  // --- Pages that unmount and mount again ---
  await page
    .getByRole("searchbox")
    .first()
    .focus()
    .catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  // With a tool chosen, the layer that shows them again is not hidden, and
  // pdf.js's editors focus themselves as it adds them.
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
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
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
  const count = (await exported(page)).length;
  await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
  const afterRemountUndo = await exported(page);
  check(
    "showing them again adds no undo step",
    afterRemountUndo.length === count - 1 &&
      !afterRemountUndo.some((annotation) => annotation.type === "signature"),
    `${count} → ${afterRemountUndo.length}`,
  );
  await page.evaluate(() => (window as unknown as Demo).__annotations?.redo());
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));

  // --- Comments and alternative text ---
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("stamp"));
  // Focused, as the keyboard reaches it: the signature, centered too, covers it.
  await page.locator('section[data-page="1"] .stampEditor').focus();
  let selected = (await viewerState(page))?.annotationState?.selected;
  check(
    "selecting an image publishes it with its alternative text",
    selected?.type === "stamp" &&
      selected.pageIndex === 0 &&
      selected.comment === null &&
      selected.altText?.text === "Blue box" &&
      selected.altText.decorative === false,
    JSON.stringify(selected),
  );
  const changed = await page.evaluate(() => {
    const editing = (window as unknown as Demo).__annotations;
    return [
      editing?.setAltText({ text: "Navy box", decorative: false }),
      editing?.setComment("Check the color"),
    ];
  });
  selected = (await viewerState(page))?.annotationState?.selected;
  check(
    "the selected image takes a new alternative text and a comment",
    changed.every(Boolean) &&
      selected?.altText?.text === "Navy box" &&
      selected.comment === "Check the color",
    JSON.stringify(selected),
  );
  await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
  const undone = (await viewerState(page))?.annotationState?.selected;
  await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
  const undoneTwice = (await viewerState(page))?.annotationState?.selected;
  await page.evaluate(() => {
    const editing = (window as unknown as Demo).__annotations;
    editing?.redo();
    editing?.redo();
  });
  selected = (await viewerState(page))?.annotationState?.selected;
  check(
    "undo and redo take a comment and an alternative text back and forth",
    undone?.comment === null &&
      undone.altText?.text === "Navy box" &&
      undoneTwice?.altText?.text === "Blue box" &&
      selected?.comment === "Check the color" &&
      selected.altText?.text === "Navy box",
    JSON.stringify([undone, undoneTwice, selected]),
  );
  // The demo's form, outside the pages: typing there keeps the image selected.
  const form = page.getByRole("form", { name: "Selected annotation" });
  await form.getByLabel("Comment").fill("Draft");
  await form.getByRole("button", { name: "Cancel" }).click();
  const cancelled = await form.getByLabel("Comment").inputValue();
  await form.getByLabel("Comment").fill("Check the color, please");
  await form.getByRole("button", { name: "Apply" }).click();
  selected = (await viewerState(page))?.annotationState?.selected;
  check(
    "an application's form edits the comment, and cancels, with the image still selected",
    cancelled === "Check the color" &&
      selected?.type === "stamp" &&
      selected.comment === "Check the color, please",
    JSON.stringify([cancelled, selected]),
  );
  await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
  const stamp = (await exported(page)).find((annotation) => annotation.type === "stamp");
  const stampData = stamp?.data as
    | { popup?: { contents?: string }; accessibilityData?: { altText?: string } }
    | undefined;
  check(
    "export keeps the comment and the alternative text",
    stampData?.popup?.contents === "Check the color" &&
      stampData.accessibilityData?.altText === "Navy box",
    JSON.stringify([stampData?.popup, stampData?.accessibilityData]),
  );
  const several = await page.evaluate(() => {
    const editing = (window as unknown as Demo).__annotations;
    editing?.selectAll();
    return {
      selected: editing?.store.get().state?.selected ?? null,
      comment: editing?.setComment("Nothing"),
    };
  });
  check(
    "with several selected, none is described and none takes a comment",
    several.selected === null && several.comment === false,
    JSON.stringify(several),
  );
  await page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));
  check(
    "nothing is selected once the tool goes back to none",
    (await viewerState(page))?.annotationState?.selected === null,
  );

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
    const bytes = await (window as unknown as Demo).__parapdf?.save(
      (window as unknown as Demo).__viewer,
    );
    if (!bytes || !window.pdfjsLib) return [];
    const saved = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const first = await saved.getPage(1);
    return (await first.getAnnotations()).map((annotation) =>
      annotation.subtype === "Stamp" ? `Stamp:${annotation.contentsObj?.str}` : annotation.subtype,
    );
  });
  check(
    "save() writes them into the PDF",
    ["FreeText", "Highlight", "Ink", "Stamp:Check the color"].every((subtype) =>
      subtypes.includes(subtype),
    ),
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
      (annotations) => (window as unknown as Demo).__annotations?.import(annotations),
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
    const importedStamp = again.find((annotation) => annotation.type === "stamp")?.data as
      | { popup?: { contents?: string }; accessibilityData?: { altText?: string } }
      | undefined;
    check(
      "imported annotations keep their comment and alternative text",
      importedStamp?.popup?.contents === "Check the color" &&
        importedStamp.accessibilityData?.altText === "Navy box",
      JSON.stringify([importedStamp?.popup, importedStamp?.accessibilityData]),
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
      (window as unknown as Demo).__annotations?.addSignature(
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

  // --- Awaiting image insertion means export and save are ready ---
  {
    const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
    const png = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no image context");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black";
      context.font = "italic 80px serif";
      context.fillText("Ada Lovelace", 10, 110);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    let releaseImage = () => {};
    const response = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route("**/delayed-annotation.png", async (route) => {
      await response;
      await route.fulfill({ contentType: "image/png", body: Buffer.from(png ?? "", "base64") });
    });
    const requested = page.waitForRequest("**/delayed-annotation.png");
    await page.evaluate((url) => {
      const demo = window as unknown as ImageDemo;
      demo.__imageSettled = false;
      demo.__imageResult = (async () => {
        const added =
          (await demo.__annotations?.addImage(url, { altText: "Ready image" })) === true;
        demo.__imageSettled = true;
        // Deliberately no canvas, timeout, or frame wait after addImage().
        const exported = demo.__annotations?.export() ?? [];
        const bytes = await demo.__parapdf?.save(demo.__viewer);
        const doc = bytes && (await window.pdfjsLib?.getDocument({ data: bytes }).promise);
        const annotations = doc ? await (await doc.getPage(1)).getAnnotations() : [];
        return {
          added,
          exported: exported.filter((annotation) => annotation.type === "stamp").length,
          saved: annotations.filter((annotation) => annotation.subtype === "Stamp").length,
          altText: (exported[0]?.data.accessibilityData as { altText?: string })?.altText,
        };
      })();
    }, new URL("delayed-annotation.png", baseUrl).href);
    await requested;
    await page.waitForTimeout(100);
    check(
      "addImage() stays pending while the image response is delayed",
      (await page.evaluate(() => (window as unknown as ImageDemo).__imageSettled)) === false,
    );
    check(
      "a loading image leaves no unfinished annotation to export",
      (await exported(page)).length === 0,
    );
    releaseImage();
    const image = await page.evaluate(() => (window as unknown as ImageDemo).__imageResult);
    check(
      "await addImage() allows immediate export and save with the image and alt text",
      image?.added === true &&
        image.exported === 1 &&
        image.saved === 1 &&
        image.altText === "Ready image",
      JSON.stringify(image),
    );
    const failed = await page.evaluate(async () => {
      const viewer = (window as unknown as Demo).__annotations;
      await viewer?.setTool("freetext");
      const before = viewer?.export().length;
      const added = await viewer?.addImage(new Blob(["invalid image"], { type: "image/png" }));
      const after = viewer?.export().length;
      return {
        added,
        before,
        after,
        saved:
          (await (window as unknown as Demo).__parapdf?.save((window as unknown as Demo).__viewer))
            ?.byteLength ?? 0,
        tool: viewer?.store.get().tool,
        stampEditing: document
          .querySelector(".parapdf-editor-layer")
          ?.classList.contains("stampEditing"),
      };
    });
    check(
      "an undecodable image resolves false and leaves export and save usable",
      failed.added === false && failed.before === failed.after && failed.saved > 0,
      JSON.stringify(failed),
    );
    check(
      "an undecodable image leaves the published and active stamp tool in step",
      failed.tool === "stamp" && failed.stampEditing === true,
      JSON.stringify(failed),
    );
    const signature = await page.evaluate(async (png) => {
      const viewer = (window as unknown as Demo).__annotations;
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const added = await viewer?.addSignature({ image: blob }, { description: "Image signature" });
      const exported = viewer?.export() ?? [];
      const bytes = await (window as unknown as Demo).__parapdf?.save(
        (window as unknown as Demo).__viewer,
      );
      const doc = bytes && (await window.pdfjsLib?.getDocument({ data: bytes }).promise);
      const annotations = doc ? await (await doc.getPage(1)).getAnnotations() : [];
      return {
        added,
        exported: exported.filter((annotation) => annotation.type === "signature").length,
        saved: annotations.filter((annotation) => annotation.subtype === "Stamp").length,
      };
    }, png);
    check(
      "await addSignature() allows immediate export and save of an image signature",
      signature.added === true && signature.exported === 1 && signature.saved === 2,
      JSON.stringify(signature),
    );
    const bitmapSignature = await page.evaluate(async (png) => {
      const viewer = (window as unknown as Demo).__annotations;
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const added = await viewer?.addSignature(
          { image: bitmap },
          { description: "Bitmap signature" },
        );
        const exported = viewer?.export() ?? [];
        const bytes = await (window as unknown as Demo).__parapdf?.save(
          (window as unknown as Demo).__viewer,
        );
        const doc = bytes && (await window.pdfjsLib?.getDocument({ data: bytes }).promise);
        const annotations = doc ? await (await doc.getPage(1)).getAnnotations() : [];
        return {
          added,
          exported: exported.filter((annotation) => annotation.type === "signature").length,
          saved: annotations.filter((annotation) => annotation.subtype === "Stamp").length,
          bitmapIntact: bitmap.width > 0 && bitmap.height > 0,
        };
      } finally {
        bitmap.close();
      }
    }, png);
    check(
      "an ImageBitmap signature is immediately exported and saved, retaining the caller's bitmap",
      bitmapSignature.added === true &&
        bitmapSignature.exported === 2 &&
        bitmapSignature.saved === 3 &&
        bitmapSignature.bitmapIntact,
      JSON.stringify(bitmapSignature),
    );
    const failedSignature = await page.evaluate(async () => {
      const viewer = (window as unknown as Demo).__annotations;
      const added = await viewer?.addSignature({
        image: new Blob(["invalid image"], { type: "image/png" }),
      });
      return { added, count: viewer?.export().length };
    });
    check(
      "an undecodable image signature resolves false without an annotation",
      failedSignature.added === false && failedSignature.count === 3,
      JSON.stringify(failedSignature),
    );

    for (const tool of ["freetext", "stamp"]) {
      const path = `cancelled-${tool}-annotation.png`;
      let releaseCancelledImage = () => {};
      const cancelledResponse = new Promise<void>((resolve) => {
        releaseCancelledImage = resolve;
      });
      await page.route(`**/${path}`, async (route) => {
        await cancelledResponse;
        await route.fulfill({ contentType: "image/png", body: Buffer.from(png ?? "", "base64") });
      });
      const before = (await exported(page)).length;
      const cancelledRequest = page.waitForRequest(`**/${path}`);
      await page.evaluate((url) => {
        const demo = window as unknown as ImageDemo;
        demo.__pendingImage = demo.__annotations?.addImage(url);
      }, new URL(path, baseUrl).href);
      await cancelledRequest;
      await page.evaluate(async (tool) => {
        const viewer = (window as unknown as Demo).__annotations;
        await viewer?.setTool("freetext");
        // Choosing stamp again must not revive an earlier insertion.
        if (tool === "stamp") await viewer?.setTool(tool);
      }, tool);
      releaseCancelledImage();
      const cancelled = await page.evaluate(() => (window as unknown as ImageDemo).__pendingImage);
      const active = await page.evaluate((tool) => {
        const viewer = (window as unknown as Demo).__annotations;
        return {
          tool: viewer?.store.get().tool,
          editing: document
            .querySelector(".parapdf-editor-layer")
            ?.classList.contains(`${tool}Editing`),
        };
      }, tool);
      check(
        `choosing ${tool} while an image loads cancels it and keeps that tool active`,
        cancelled === false &&
          (await exported(page)).length === before &&
          active.tool === tool &&
          active.editing === true,
        JSON.stringify({ cancelled, ...active }),
      );
    }

    let releaseClosedImage = () => {};
    const closedResponse = new Promise<void>((resolve) => {
      releaseClosedImage = resolve;
    });
    await page.route("**/closed-annotation.png", async (route) => {
      await closedResponse;
      await route.fulfill({ contentType: "image/png", body: Buffer.from(png ?? "", "base64") });
    });
    const closedRequest = page.waitForRequest("**/closed-annotation.png");
    await page.evaluate((url) => {
      const demo = window as unknown as ImageDemo;
      demo.__imageSettled = false;
      demo.__pendingImage = demo.__annotations?.addImage(url).then((added) => {
        demo.__imageSettled = true;
        return added;
      });
    }, new URL("closed-annotation.png", baseUrl).href);
    await closedRequest;
    await page.evaluate(() => (window as unknown as ImageDemo).__lifecycle?.unmount());
    await page.waitForFunction(() => (window as unknown as ImageDemo).__imageSettled, undefined, {
      timeout: 3000,
    });
    check(
      "closing a viewer resolves addImage() false before its delayed response arrives",
      (await page.evaluate(() => (window as unknown as ImageDemo).__pendingImage)) === false,
    );
    const closedDownloaded = page.waitForResponse("**/closed-annotation.png");
    releaseClosedImage();
    await closedDownloaded;
    await page.waitForTimeout(100);
    check("no errors while adding images", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- Failed signatures leave neither editors nor undo steps ---
  {
    const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
    const emptySignatures = [
      { text: "" },
      { text: "   " },
      { strokes: [], width: 100, height: 100 },
    ];
    for (const signature of emptySignatures) {
      const failed = await page.evaluate(async (signature) => {
        const viewer = (window as unknown as Demo).__annotations;
        const added = await viewer?.addSignature(signature);
        return {
          added,
          exported: viewer?.export().length,
          editors: document.querySelectorAll(".signatureEditor").length,
          state: viewer?.store.get().state,
        };
      }, signature);
      check(
        `an empty signature resolves false without an editor or undo step: ${JSON.stringify(signature)}`,
        failed.added === false &&
          failed.exported === 0 &&
          failed.editors === 0 &&
          failed.state?.canUndo === false &&
          failed.state.isEmpty,
        JSON.stringify(failed),
      );
    }
    const history = await page.evaluate(async (emptySignatures) => {
      const viewer = (window as unknown as Demo).__annotations;
      const added = await viewer?.addSignature({ text: "Ada Lovelace" });
      viewer?.undo();
      const afterUndo = viewer?.export().length;
      for (const signature of emptySignatures) await viewer?.addSignature(signature);
      const canRedo = viewer?.store.get().state?.canRedo;
      viewer?.redo();
      const afterRedo = viewer?.export().length;
      viewer?.undo();
      return {
        added,
        afterUndo,
        canRedo,
        afterRedo,
        afterSecondUndo: viewer?.export().length,
      };
    }, emptySignatures);
    check(
      "failed signatures preserve redo and a successful signature takes exactly one undo step",
      history.added === true &&
        history.afterUndo === 0 &&
        history.canRedo === true &&
        history.afterRedo === 1 &&
        history.afterSecondUndo === 0,
      JSON.stringify(history),
    );
    await page.evaluate(async () => {
      const demo = window as unknown as SignatureDemo;
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 80;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no signature context");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black";
      context.font = "italic 40px serif";
      context.fillText("Ada", 10, 50);
      const blob = await (await fetch(canvas.toDataURL("image/png"))).blob();
      const original = window.createImageBitmap;
      const decoding = new Promise<void>((resolve) => {
        demo.__releaseSignatureDecode = resolve;
      });
      demo.__signatureDecodeStarted = false;
      window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
        if (args[0] !== blob) return original(...args);
        window.createImageBitmap = original;
        demo.__signatureDecodeStarted = true;
        return decoding.then(() => original(...args));
      }) as typeof createImageBitmap;
      demo.__pendingSignature = demo.__annotations?.addSignature({ image: blob });
    });
    await page.waitForFunction(
      () => (window as unknown as SignatureDemo).__signatureDecodeStarted === true,
    );
    const textTool = page
      .getByRole("toolbar", { name: "Annotations" })
      .getByRole("button", { name: "Text", exact: true });
    await textTool.click();
    await page.waitForFunction(
      () =>
        (window as unknown as Demo).__annotations?.store.get().tool === "freetext" &&
        document.querySelector(".parapdf-editor-layer")?.classList.contains("freetextEditing"),
    );
    await textTool.focus();
    const cancelledSignature = await page.evaluate(async () => {
      const demo = window as unknown as SignatureDemo;
      demo.__releaseSignatureDecode?.();
      const added = await demo.__pendingSignature;
      return {
        added,
        tool: demo.__annotations?.store.get().tool,
        editing: document
          .querySelector(".parapdf-editor-layer")
          ?.classList.contains("freetextEditing"),
        exported: demo.__annotations?.export().length,
        editors: document.querySelectorAll(".signatureEditor").length,
        state: demo.__annotations?.store.get().state,
        focused: document.activeElement?.textContent === "Text",
      };
    });
    check(
      "choosing another tool while a signature decodes cancels it without taking focus or changing history",
      cancelledSignature.added === false &&
        cancelledSignature.tool === "freetext" &&
        cancelledSignature.editing === true &&
        cancelledSignature.exported === 0 &&
        cancelledSignature.editors === 0 &&
        cancelledSignature.state?.canUndo === false &&
        cancelledSignature.state.canRedo === true &&
        cancelledSignature.focused,
      JSON.stringify(cancelledSignature),
    );
    await page.waitForTimeout(100);
    check(
      "no errors while rejecting empty signatures",
      errors.length === 0,
      errors.slice(0, 3).join(" | "),
    );
    await page.context().close();
  }
  // --- Annotations the file holds ---
  {
    const { page, errors } = await open(launched.browser, demo("file=synthetic-annotations.pdf"));
    const section = page.locator('section[data-page="1"]');
    const sectionOf = (on: Page) => on.locator('section[data-page="1"]');
    /** The editors on page 1, by kind, with their boxes in points from the page's corner. */
    const editors = () =>
      page.evaluate(() => {
        const host = document.querySelector('section[data-page="1"]');
        const layer = host?.querySelector(".parapdf-editor-layer");
        if (!host || !layer) return [];
        const page = host.getBoundingClientRect();
        const scale = page.width / 612;
        return [...layer.children].map((editor) => {
          const box = editor.getBoundingClientRect();
          return {
            kind: editor.className.split(" ")[0] ?? "",
            x: Math.round((box.x - page.x) / scale),
            y: Math.round((box.y - page.y) / scale),
            canvas: editor.querySelector("canvas") !== null,
          };
        });
      });
    const kinds = async () =>
      (await editors())
        .map(({ kind }) => kind)
        .sort()
        .join(" ");
    /** The color a screenshot shows at a point of page 1, in points from its top-left corner. */
    const colorAt = async (x: number, y: number, on = page) => {
      const box = await sectionOf(on).boundingBox();
      if (!box) return [0, 0, 0];
      const scale = box.width / 612;
      const clip = { x: box.x + x * scale - 2, y: box.y + y * scale - 2, width: 4, height: 4 };
      const { rgba, width } = decodePng(await on.screenshot({ clip }));
      const at = (Math.floor(width / 2) * width + Math.floor(width / 2)) * 4;
      return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0];
    };
    // The stamp is a blue box at [350, 500, 450, 560] in PDF space, its
    // middle 400 by 262 points from the page's top-left corner.
    const blue = ([r, , b]: number[]) => (b ?? 0) > 180 && (r ?? 0) < 120;
    const tool = (name: string) =>
      page.evaluate((name) => (window as unknown as Demo).__annotations?.setTool(name), name);
    const settle = () => page.waitForTimeout(600);

    const drawn = blue(await colorAt(400, 262));
    check(
      "with no tool, the file's annotations are drawn and none is an editor",
      drawn && (await editors()).length === 0 && (await exported(page)).length === 0,
    );
    await tool("ink");
    await settle();
    const editable = "freeTextEditor highlightEditor inkEditor stampEditor";
    const stamp = (await editors()).find(({ kind }) => kind === "stampEditor");
    check(
      "choosing a tool makes the file's text, drawing, highlight, and image editors, and not its square",
      (await kinds()) === editable && stamp?.canvas === true,
      `${await kinds()}; stamp canvas ${stamp?.canvas}`,
    );
    check("the image stays in view as an editor", blue(await colorAt(400, 262)));
    await tool("none");
    await settle();
    await tool("ink");
    await settle();
    check(
      "choosing a tool again makes no second editor, and unchanged annotations export nothing",
      (await kinds()) === editable && (await exported(page)).length === 0,
      await kinds(),
    );

    // Move the image 100 points down, and delete the text. A first click
    // selects the image, and chooses its tool as pdf.js does; then it drags.
    await section.locator(".stampEditor").click();
    const stampBox = await section.locator(".stampEditor").boundingBox();
    const sectionBox = await section.boundingBox();
    if (stampBox && sectionBox) {
      const scale = sectionBox.width / 612;
      const [x, y] = [stampBox.x + stampBox.width / 2, stampBox.y + stampBox.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 50 * scale, { steps: 5 });
      await page.mouse.move(x, y + 100 * scale, { steps: 5 });
      await page.mouse.up();
    }
    await page.locator(".freeTextEditor").click();
    await page.keyboard.press("Delete");
    await settle();
    let annotations = await exported(page);
    const moved = annotations.find((annotation) => annotation.type === "stamp");
    check(
      "a moved annotation of the file exports in its place, and a deleted one not at all",
      annotations.length === 1 &&
        moved?.data.annotationElementId === "25R" &&
        Math.abs((moved.data.rect?.[1] ?? 0) - 400) < 2,
      rects(annotations),
    );
    check(
      "the editors follow: the text is gone and the image moved",
      (await kinds()) === "highlightEditor inkEditor stampEditor" &&
        (await editors()).find(({ kind }) => kind === "stampEditor")?.y === (stamp?.y ?? 0) + 100,
      JSON.stringify(await editors()),
    );
    await page.evaluate(() => (window as unknown as Demo).__annotations?.undo());
    await settle();
    const undone = await kinds();
    await page.evaluate(() => (window as unknown as Demo).__annotations?.redo());
    await settle();
    check(
      "undo brings the deleted text back and redo deletes it again",
      undone === editable && (await kinds()) === "highlightEditor inkEditor stampEditor",
      `${undone} → ${await kinds()}`,
    );

    // Back to no tool: the drawing leaves the changed and deleted ones out.
    await tool("none");
    await settle();
    check(
      "with no tool again, the image shows only where it moved, and the text not at all",
      !blue(await colorAt(400, 262)) &&
        blue(await colorAt(400, 362)) &&
        (await kinds()) === "stampEditor",
      `${await colorAt(400, 262)} / ${await colorAt(400, 362)}; ${await kinds()}`,
    );

    // Unmount the page and come back, zoom, and turn.
    await tool("ink");
    await settle();
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(7));
    await page.waitForTimeout(800);
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(0));
    await editorLayer(page, 1);
    await settle();
    const back = await editors();
    check(
      "the page mounting again shows the changes, and no editor twice",
      (await kinds()) === "highlightEditor inkEditor stampEditor" &&
        back.find(({ kind }) => kind === "stampEditor")?.y === (stamp?.y ?? 0) + 100,
      JSON.stringify(back),
    );
    await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale(2));
    await settle();
    await page.evaluate(() => (window as unknown as Demo).__viewer?.rotate(90));
    await settle();
    await page.evaluate(() => (window as unknown as Demo).__viewer?.rotate(-90));
    await page.evaluate(() => (window as unknown as Demo).__viewer?.setScale(1));
    await editorLayer(page, 1);
    await settle();
    annotations = await exported(page);
    check(
      "zooming and turning keep the changes",
      (await kinds()) === "highlightEditor inkEditor stampEditor" &&
        annotations.length === 1 &&
        Math.abs((annotations[0]?.data.rect?.[1] ?? 0) - 400) < 2,
      `${await kinds()}; ${rects(annotations)}`,
    );

    // Saving writes the changes into the file, read back as above: what
    // WebKit reports of the second document's worker is not the viewer's.
    const before = errors.length;
    const saved = await page.evaluate(async () => {
      const demo = window as unknown as Demo;
      const bytes = await demo.__parapdf?.save(demo.__viewer);
      if (!bytes || !window.pdfjsLib) return [];
      const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      const found = await (await doc.getPage(1)).getAnnotations();
      return found.map((annotation) => {
        const { subtype, rect } = annotation as { subtype: string; rect: number[] };
        return `${subtype} ${rect.map(Math.round).join(" ")}`;
      });
    });
    errors.splice(before);
    check(
      "saving writes the move and the deletion into the file",
      !saved.some((line) => line.startsWith("FreeText")) &&
        saved.includes("Stamp 350 400 450 460") &&
        saved.some((line) => line.startsWith("Ink")) &&
        saved.some((line) => line.startsWith("Highlight")) &&
        saved.some((line) => line.startsWith("Square")),
      saved.join(" | "),
    );

    // The export, imported into the document opened again, replaces the file's image.
    await page.context().close();
    const again = await open(launched.browser, demo("file=synthetic-annotations.pdf"));
    const imported = await again.page.evaluate(
      (list) => (window as unknown as Demo).__annotations?.import(list),
      annotations,
    );
    await again.page.waitForTimeout(600);
    const importedColors = [
      await colorAt(400, 262, again.page),
      await colorAt(400, 362, again.page),
    ];
    check(
      "the imported change shows in place of the file's annotation, which is drawn no more",
      !blue(importedColors[0] ?? []) && blue(importedColors[1] ?? []),
      importedColors.join(" / "),
    );
    await again.page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
    await again.page.waitForTimeout(600);
    const replaced = await again.page.evaluate(() =>
      [...document.querySelectorAll('section[data-page="1"] .parapdf-editor-layer > div')].map(
        (editor) => editor.className.split(" ")[0],
      ),
    );
    check(
      "an imported change replaces the file's annotation it was made of",
      imported === 1 &&
        replaced.filter((kind) => kind === "stampEditor").length === 1 &&
        replaced.length === 4,
      `${imported}; ${replaced.join(" ")}`,
    );
    // Imported again while a tool is chosen, it replaces the editor it made.
    await again.page.evaluate(
      (list) => (window as unknown as Demo).__annotations?.import(list),
      annotations,
    );
    const twice = await again.page.evaluate(() => ({
      stamps: document.querySelectorAll('section[data-page="1"] .stampEditor').length,
      exported: (window as unknown as Demo).__annotations?.export() ?? [],
    }));
    check(
      "importing the change again replaces it, and exports it once",
      twice.stamps === 1 &&
        twice.exported.length === 1 &&
        twice.exported[0]?.data.annotationElementId === "25R",
      `${twice.stamps}; ${rects(twice.exported)}`,
    );

    // With no tool, a double click on an annotation of the file edits it.
    await again.page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("none"));
    await again.page.waitForTimeout(600);
    await again.page.locator('section[data-page="1"] .freeTextAnnotation').dblclick();
    await again.page.waitForTimeout(600);
    const chosen = await viewerState(again.page);
    check(
      "a double click with no tool chosen edits that annotation",
      chosen.annotationTool === "freetext",
      chosen.annotationTool,
    );
    // A comment on a drawing of the file changes it: saved over it.
    await again.page.evaluate(() => (window as unknown as Demo).__annotations?.setTool("ink"));
    await again.page.waitForTimeout(600);
    await again.page.locator('section[data-page="1"] .inkEditor').focus();
    const fileComment = await again.page.evaluate(async () => {
      const demo = window as unknown as Demo;
      const editing = demo.__annotations;
      const selected = editing?.store.get().state?.selected ?? null;
      const set = editing?.setComment("From the reader");
      const ink = editing?.export().find((annotation) => annotation.type === "ink");
      const bytes = await demo.__parapdf?.save(demo.__viewer);
      if (!bytes || !window.pdfjsLib) return { selected, set, ink, saved: null };
      const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      const found = await (await doc.getPage(1)).getAnnotations();
      const saved = found.find((annotation) => annotation.subtype === "Ink")?.contentsObj?.str;
      return { selected, set, ink, saved };
    });
    check(
      "a comment on an annotation of the file exports and saves with it",
      fileComment.selected?.type === "ink" &&
        fileComment.set === true &&
        fileComment.ink?.data.annotationElementId !== undefined &&
        (fileComment.ink?.data as { popup?: { contents?: string } } | undefined)?.popup
          ?.contents === "From the reader" &&
        fileComment.saved === "From the reader",
      JSON.stringify({ ...fileComment, ink: fileComment.ink?.data.popup }),
    );
    check(
      "no errors while editing the file's annotations",
      errors.length === 0 && again.errors.length === 0,
      [...errors, ...again.errors].slice(0, 3).join(" | "),
    );
    await again.page.context().close();
  }
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
