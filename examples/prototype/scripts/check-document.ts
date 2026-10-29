/**
 * Functional checks for what the document itself asks of a viewer and what
 * an application reads and sets in it: the view each kind of destination
 * asks for (XYZ with and without a zoom, Fit, FitH, FitV, FitR), back and
 * forward through link jumps with their zoom, the document's initial view
 * (/OpenAction, /PageLayout, /PageMode) and the options that win over it,
 * permissions, followed or only reported, form fields read, set, saved,
 * and heard as the reader fills them in, view states kept and shown again,
 * at open and later, in another viewport, and the PDF's preload. They run
 * on the synthetic navigation, restricted, and feature sampler documents
 * and on usrguide.pdf.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build &&
 *   pnpm --filter @parapdf/prototype check:document
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next),
 * DIST (another build of the demo, in a directory of its own).
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

interface FormField {
  name: string;
  type: string;
  value: string | string[];
  defaultValue: string | string[];
  options: { value: string; label: string }[];
  exportValues: string[];
  widgets: { id: string; pageIndex: number }[];
}

interface ViewState {
  page: number;
  x: number;
  y: number;
  scale: number | string;
  rotation: number;
  spread: string;
  scrollMode: string;
}

/** The viewer runtime the demo exposes, as far as these checks call it. */
interface Viewer {
  store: {
    get(): {
      status: string;
      currentPage: number;
      scale: number;
      zoomMode: string;
      spread: string;
      scrollMode: string;
    };
  };
  scroller: HTMLElement | null;
  hasPixels(index: number): boolean;
  goToPage(index: number): void;
  setScale(scale: number | string): void;
  goToDestination(dest: unknown): Promise<boolean>;
  rotate(degrees: number): void;
  setSpread(spread: string): void;
  stats: Record<string, number> | null;
}

/** The package's functions the demo exposes, which take the viewer. */
interface Parapdf {
  getViewState(viewer: Viewer): ViewState | null;
  setViewState(viewer: Viewer, view: Record<string, unknown>): void;
  print(viewer: Viewer | undefined): Promise<void>;
  save(viewer: Viewer | undefined): Promise<Uint8Array | null>;
  getFormFields(viewer: Viewer | undefined): Promise<FormField[]>;
  setFormValues(viewer: Viewer | undefined, values: Record<string, unknown>): Promise<string[]>;
}

/** What the demo exposes on `window` for these checks. */
interface Demo {
  __setViewerProps(props: Record<string, unknown>): void;
  __viewer?: Viewer;
  __session?: {
    state: { get(): { status: string; permissions: Record<string, boolean> | null } };
    initialView(): Promise<{
      destination: { pageIndex: number } | null;
      pageLayout: string | null;
      pageMode: string | null;
    } | null>;
  };
  __parapdf?: Parapdf;
  __history?: {
    store: { get(): { canGoBack: boolean; canGoForward: boolean } };
    back(): void;
    forward(): void;
  };
  __annotations?: {
    store: { get(): { state: unknown } };
    setTool(tool: string): Promise<void>;
  } | null;
  __onFormChange?: (change: { name: string; value: unknown }) => void;
  __pdfDocument?: {
    getPage(n: number): Promise<{ getAnnotations(): Promise<{ dest?: unknown }[]> }>;
  };
  __changes?: { name: string; value: unknown }[];
  __setFragment?: (fragment: string) => void;
}

/**
 * The viewer's state, with its history's and its annotation editing's, and
 * its session's permissions and initial view.
 */
const state = (page: Page) =>
  page.evaluate(async () => {
    const demo = window as unknown as Demo;
    const viewer = demo.__viewer?.store.get();
    if (!viewer) return undefined;
    const history = demo.__history?.store.get();
    return {
      ...viewer,
      permissions: demo.__session?.state.get().permissions ?? null,
      documentView: (await demo.__session?.initialView()) ?? null,
      canGoBack: history?.canGoBack ?? false,
      canGoForward: history?.canGoForward ?? false,
      annotationState: demo.__annotations?.store.get().state ?? null,
    };
  });

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
    () => (window as unknown as Demo).__session?.state.get().status === "ready",
    undefined,
    {
      timeout: 30_000,
    },
  );
  await settle(page);
  return { page, errors };
}

/** Waits until the visible pages are drawn and their text and annotation layers built. */
const settle = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const viewer = (window as unknown as Demo).__viewer;
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

/**
 * The PDF point of the current page at the viewport's top-left corner, read
 * from the page's box on screen, and the scroller's size.
 */
const corner = (page: Page) =>
  page.evaluate(() => {
    const viewer = (window as unknown as Demo).__viewer;
    const scroller = viewer?.scroller;
    const { currentPage = 0, scale = 1 } = viewer?.store.get() ?? {};
    const section = document.querySelector(`section[data-page="${currentPage + 1}"]`);
    if (!scroller || !section) return null;
    const view = scroller.getBoundingClientRect();
    const box = section.getBoundingClientRect();
    return {
      x: (view.left - box.left) / scale,
      y: (view.top - box.top) / scale,
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    };
  });

/** The destinations of page 1's links, in the order the generator wrote them. */
const linkDestinations = (page: Page) =>
  page.evaluate(async () => {
    const first = await (window as unknown as Demo).__pdfDocument?.getPage(1);
    return ((await first?.getAnnotations()) ?? []).map((annotation) => annotation.dest);
  });

const close = (value: number | undefined, target: number, tolerance: number) =>
  value !== undefined && Math.abs(value - target) <= tolerance;

/**
 * Whether the page's `x` is in view: an explicit left scrolls sideways only
 * when it is out of view, except in "horizontal" mode.
 */
const inView = (view: { x: number; width: number } | null, x: number, scale = 1) =>
  view !== null && x >= view.x && x <= view.x + view.width / scale;

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4185, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4185/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
const demo = (query: string) => `${baseUrl}?engine=${engine}&${query}`;

try {
  // --- Destinations take the view they ask for; back and forward restore it ---
  {
    const { page, errors } = await open(launched.browser, demo("file=synthetic-navigation.pdf"));
    const start = await state(page);
    check(
      "the document's initial view is reported without being followed",
      start?.documentView?.pageLayout === "TwoColumnLeft" &&
        start.documentView.pageMode === "UseOutlines" &&
        start.documentView.destination?.pageIndex === 2 &&
        start.currentPage === 0 &&
        start.spread === "none" &&
        start.zoomMode === "fit-width",
      JSON.stringify({
        view: start?.documentView,
        page: start?.currentPage,
        spread: start?.spread,
      }),
    );
    const dests = await linkDestinations(page);
    check("page 1 links to six destinations", dests.length === 6, String(dests.length));
    const go = async (index: number) => {
      await page.evaluate(
        (dest) => (window as unknown as Demo).__viewer?.goToDestination(dest),
        dests[index],
      );
      await page.waitForTimeout(100);
      return { state: await state(page), corner: await corner(page) };
    };

    // A link the reader clicks follows its destination like goToDestination().
    await page.locator('section[data-page="1"] .parapdf-annotation-layer a').first().click();
    await page.waitForTimeout(100);
    const clicked = await state(page);
    check(
      "clicking an XYZ link with a zoom of 3 zooms to 300%",
      clicked?.currentPage === 1 && close(clicked.scale, 4, 1e-3) && clicked.zoomMode === "custom",
      JSON.stringify({ page: clicked?.currentPage, scale: clicked?.scale }),
    );
    const zoomed = await corner(page);
    check(
      "an XYZ destination's top lands at the viewport's top, its left in view",
      inView(zoomed, 100, clicked?.scale) && close(zoomed?.y, 792 - 500, 1),
      JSON.stringify(zoomed),
    );
    await page.evaluate(() => (window as unknown as Demo).__history?.back());
    await page.waitForTimeout(100);
    const back = await state(page);
    check(
      "back returns to page 1 at the zoom before the jump",
      back?.currentPage === 0 &&
        back.zoomMode === "fit-width" &&
        close(back.scale, start?.scale ?? 0, 1e-3) &&
        back.canGoForward &&
        !back.canGoBack,
      JSON.stringify({ page: back?.currentPage, mode: back?.zoomMode, scale: back?.scale }),
    );
    await page.evaluate(() => (window as unknown as Demo).__history?.forward());
    await page.waitForTimeout(100);
    const forward = await state(page);
    const forwardCorner = await corner(page);
    check(
      "forward returns to the destination, its zoom, and its point",
      forward?.currentPage === 1 &&
        close(forward.scale, 4, 1e-3) &&
        inView(forwardCorner, 100, forward.scale) &&
        close(forwardCorner?.y, 292, 1) &&
        forward.canGoBack &&
        !forward.canGoForward,
      JSON.stringify({ page: forward?.currentPage, scale: forward?.scale, ...forwardCorner }),
    );
    await page.evaluate(() => (window as unknown as Demo).__history?.back());
    const kept = await go(1);
    check(
      "an XYZ destination with a zoom of 0 keeps the zoom",
      close(kept.state?.scale, start?.scale ?? 0, 1e-3) && close(kept.corner?.y, 392, 1),
      JSON.stringify({ scale: kept.state?.scale, ...kept.corner }),
    );
    check(
      "a new jump after back forgets forward",
      kept.state?.canGoForward === false && kept.state.canGoBack,
    );
    const fit = await go(2);
    check(
      "Fit fits the whole page",
      fit.state?.zoomMode === "fit-page" &&
        close(fit.state.scale * 792, (fit.corner?.height ?? 0) - 24, 1),
      JSON.stringify({ mode: fit.state?.zoomMode, scale: fit.state?.scale, ...fit.corner }),
    );
    const fitH = await go(3);
    check(
      "FitH fits the page's width with its top at the viewport's top",
      fitH.state?.currentPage === 2 &&
        fitH.state.zoomMode === "fit-width" &&
        close(fitH.state.scale, start?.scale ?? 0, 1e-3) &&
        close(fitH.corner?.y, 792 - 300, 1),
      JSON.stringify({ mode: fitH.state?.zoomMode, scale: fitH.state?.scale, ...fitH.corner }),
    );
    const fitV = await go(4);
    check(
      "FitV fits the page's height",
      fitV.state?.zoomMode === "custom" &&
        close(fitV.state.scale * 792, (fitV.corner?.height ?? 0) - 24, 1),
      JSON.stringify({ scale: fitV.state?.scale, ...fitV.corner }),
    );
    const fitR = await go(5);
    const rectScale = Math.min((fitR.corner?.width ?? 0) / 200, (fitR.corner?.height ?? 0) / 100);
    check(
      "FitR fills the viewport with its rectangle from its top-left corner",
      fitR.state?.currentPage === 3 &&
        close(fitR.state.scale, rectScale, 1e-3) &&
        close(fitR.corner?.x, 100, 1) &&
        close(fitR.corner?.y, 792 - 200, 1),
      JSON.stringify({ scale: fitR.state?.scale, rectScale, ...fitR.corner }),
    );
    for (let step = 0; step < 5; step++)
      await page.evaluate(() => (window as unknown as Demo).__history?.back());
    await page.waitForTimeout(100);
    const first = await state(page);
    check(
      "back through every jump returns to the start",
      first?.currentPage === 0 &&
        close(first.scale, start?.scale ?? 0, 1e-3) &&
        first.zoomMode === "fit-width" &&
        !first.canGoBack,
      JSON.stringify({ page: first?.currentPage, scale: first?.scale }),
    );
    check("no errors following destinations", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- destinationZoom: false only scrolls ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-navigation.pdf&destinationZoom=0"),
    );
    const before = await state(page);
    const dests = await linkDestinations(page);
    await page.evaluate(
      (dest) => (window as unknown as Demo).__viewer?.goToDestination(dest),
      dests[0],
    );
    await page.waitForTimeout(100);
    const after = await state(page);
    const point = await corner(page);
    check(
      "with destinationZoom false, a destination keeps the zoom and still lands on its point",
      after?.currentPage === 1 &&
        close(after.scale, before?.scale ?? 0, 1e-3) &&
        after.zoomMode === "fit-width" &&
        close(point?.y, 292, 1),
      JSON.stringify({ scale: after?.scale, ...point }),
    );
    check("no errors without destination zoom", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  // --- The document's initial view ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-navigation.pdf&view=document"),
    );
    const opened = await state(page);
    const point = await corner(page);
    check(
      "the document opens where /OpenAction says, at its zoom",
      opened?.currentPage === 2 &&
        close(opened.scale, (2 * 96) / 72, 1e-3) &&
        opened.zoomMode === "custom" &&
        close(point?.y, 792 - 400, 1),
      JSON.stringify({ page: opened?.currentPage, scale: opened?.scale, ...point }),
    );
    check(
      "pages are arranged as /PageLayout says",
      opened?.spread === "odd" && opened.scrollMode === "vertical",
      `${opened?.spread} ${opened?.scrollMode}`,
    );
    const outline = await page
      .getByRole("button", { name: "Outline", exact: true })
      .getAttribute("aria-expanded");
    check(
      "the application opens the panel /PageMode asks for",
      outline === "true",
      String(outline),
    );
    check("no errors opening as the document asks", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
  {
    const { page } = await open(
      launched.browser,
      demo("file=synthetic-navigation.pdf&view=document&page=2&spread=none"),
    );
    const opened = await state(page);
    check(
      "the application's page and arrangement win over the document's",
      opened?.currentPage === 1 && opened.spread === "none" && opened.zoomMode === "fit-width",
      JSON.stringify({ page: opened?.currentPage, spread: opened?.spread, mode: opened?.zoomMode }),
    );
    await page.context().close();
  }
  {
    const { page } = await open(
      launched.browser,
      demo("file=synthetic-navigation.pdf&view=document&scale=fit-page"),
    );
    const opened = await state(page);
    check(
      "the application's zoom wins over the destination's, which still gives the page",
      opened?.currentPage === 2 && opened.zoomMode === "fit-page" && opened.spread === "odd",
      JSON.stringify({ page: opened?.currentPage, mode: opened?.zoomMode }),
    );
    await page.context().close();
  }

  // --- Permissions: reported, and followed on request ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-restricted.pdf&forms=1"),
    );
    const loaded = await state(page);
    check(
      "a restricted document's permissions are reported",
      JSON.stringify(loaded?.permissions) ===
        JSON.stringify({
          restricted: true,
          print: false,
          printHighQuality: true,
          modify: false,
          copy: false,
          copyForAccessibility: true,
          annotate: false,
          fillForms: true,
          assemble: true,
        }),
      JSON.stringify(loaded?.permissions),
    );
    const free = await page.evaluate(async () => {
      window.print = () => {};
      const span = document.querySelector(".parapdf-text-layer span");
      const printed = await (window as unknown as Demo).__parapdf
        ?.print((window as unknown as Demo).__viewer)
        .then(() => "printed")
        .catch((error: unknown) => String(error));
      window.dispatchEvent(new Event("afterprint"));
      // Safari 27 computes only the prefixed property; `userSelect` is undefined.
      return {
        select: span
          ? getComputedStyle(span).userSelect ||
            getComputedStyle(span).getPropertyValue("-webkit-user-select")
          : null,
        printed,
      };
    });
    check(
      "without enforcePermissions, the viewer only reports them",
      free.select === "text" && free.printed === "printed",
      JSON.stringify(free),
    );
    check("no errors reporting permissions", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-restricted.pdf&forms=1&annotations=1&permissions=1"),
    );
    await page.waitForSelector(".parapdf-text-layer span");
    const enforced = await page.evaluate(async () => {
      const span = document.querySelector(".parapdf-text-layer span");
      window.print = () => {};
      const copy = new Event("copy", { bubbles: true, cancelable: true });
      span?.dispatchEvent(copy);
      const printed = await (window as unknown as Demo).__parapdf
        ?.print((window as unknown as Demo).__viewer)
        .then(() => "printed")
        .catch((error: unknown) => String(error));
      await (window as unknown as Demo).__annotations?.setTool("ink");
      return {
        select: span
          ? getComputedStyle(span).userSelect ||
            getComputedStyle(span).getPropertyValue("-webkit-user-select")
          : null,
        copyPrevented: copy.defaultPrevented,
        printed,
        editing: (window as unknown as Demo).__annotations?.store.get().state ?? null,
        field: document.querySelector('.parapdf-annotation-layer input[name="comment"]') !== null,
      };
    });
    check(
      "without permission to copy, text cannot be selected or copied",
      enforced.select === "none" && enforced.copyPrevented,
      JSON.stringify(enforced),
    );
    check(
      "without permission to print, print() fails",
      enforced.printed?.includes("does not permit printing") === true,
      String(enforced.printed),
    );
    check(
      "without permission to annotate, annotations cannot be created",
      enforced.editing === null,
      JSON.stringify(enforced.editing),
    );
    check("with permission to fill forms, fields can be filled in", enforced.field);
    check(
      "no errors following permissions",
      errors.every((error) => error.includes("does not permit printing")),
      errors.join(" | "),
    );
    await page.context().close();
  }
  {
    const { page } = await open(
      launched.browser,
      demo("file=synthetic-features.pdf&permissions=1&annotations=1"),
    );
    await page.waitForFunction(
      () => (window as unknown as Demo).__annotations?.store.get().state != null,
      {
        timeout: 10_000,
      },
    );
    const loaded = await state(page);
    await page.waitForSelector(".parapdf-annotation-layer img");
    const icon = await page.evaluate(
      () =>
        document.querySelector(".parapdf-annotation-layer img")?.getAttribute("alt") ?? undefined,
    );
    check("a comment's icon is named by the comment", icon === "A comment on the sampler", icon);
    const select = await page.evaluate(() => {
      const span = document.querySelector(".parapdf-text-layer span");
      return span
        ? getComputedStyle(span).userSelect ||
            getComputedStyle(span).getPropertyValue("-webkit-user-select")
        : null;
    });
    check(
      "an unencrypted document permits everything",
      loaded?.permissions?.restricted === false &&
        Object.values(loaded.permissions).filter((value) => value === false).length === 1 &&
        select === "text" &&
        loaded.annotationState !== null,
      JSON.stringify({ permissions: loaded?.permissions, select }),
    );
    await page.context().close();
  }

  // --- Form fields: read, entered, set, and saved ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-features.pdf&forms=1&page=2"),
    );
    await page.waitForSelector('.parapdf-annotation-layer input[name="name"]');
    const fields = await page.evaluate(() =>
      (window as unknown as Demo).__parapdf?.getFormFields((window as unknown as Demo).__viewer),
    );
    const summary = fields?.map(({ name, type, value, options, exportValues, widgets }) => ({
      name,
      type,
      value,
      options: options.map((option) => option.value),
      exportValues,
      pages: widgets.map((widget) => widget.pageIndex),
    }));
    check(
      "form fields are listed with their kinds, values, options, and pages",
      JSON.stringify(summary) ===
        JSON.stringify([
          { name: "name", type: "text", value: "", options: [], exportValues: [], pages: [1] },
          {
            name: "agree",
            type: "checkbox",
            value: "Off",
            options: [],
            exportValues: ["Yes"],
            pages: [1],
          },
          {
            name: "color",
            type: "radio",
            value: "Off",
            options: [],
            exportValues: ["red", "green"],
            pages: [1, 1],
          },
          {
            name: "size",
            type: "combobox",
            value: "",
            options: ["small", "medium", "large"],
            exportValues: [],
            pages: [1],
          },
        ]),
      JSON.stringify(summary),
    );
    const tooltips = await page.evaluate(() =>
      [...document.querySelectorAll(".parapdf-annotation-layer section[data-annotation-id]")]
        .filter((section) => section.querySelector("input, select"))
        .map((section) => [
          section.getAttribute("title"),
          section.querySelector("input, select")?.getAttribute("title"),
        ]),
    );
    check(
      "a field's tooltip names its control, not its section",
      JSON.stringify(tooltips) ===
        JSON.stringify([
          [null, "Your name"],
          [null, "I agree"],
          [null, "Favorite color"],
          [null, "Favorite color"],
          [null, "Size"],
        ]),
      JSON.stringify(tooltips),
    );
    const keepsFieldFocus = await page.evaluate(async () => {
      const viewer = (window as unknown as Demo).__viewer;
      const field = document.querySelector<HTMLInputElement>(
        '.parapdf-annotation-layer input[name="name"]',
      );
      viewer?.scroller?.focus();
      viewer?.goToPage(2);
      // The reader chooses a field before the pending page focus runs.
      field?.focus({ preventScroll: true });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const kept = !!field && document.activeElement === field;
      viewer?.goToPage(1);
      return kept;
    });
    check("pending page focus keeps a field the reader focused meanwhile", keepsFieldFocus);
    await page.evaluate(() => {
      (window as unknown as Demo).__changes = [];
      (window as unknown as Demo).__onFormChange = (change) =>
        (window as unknown as Demo).__changes?.push(change);
    });
    await page.locator('.parapdf-annotation-layer input[name="name"]').fill("Ada");
    await page.locator('.parapdf-annotation-layer input[name="agree"]').check();
    await page.locator(".parapdf-annotation-layer select").selectOption("medium");
    await page.waitForTimeout(300);
    const changes = await page.evaluate(() => (window as unknown as Demo).__changes ?? []);
    check(
      "the application hears each value the reader enters, once",
      JSON.stringify(changes) ===
        JSON.stringify([
          { name: "name", value: "Ada" },
          { name: "agree", value: "Yes" },
          { name: "size", value: "medium" },
        ]),
      JSON.stringify(changes),
    );
    const entered = await page.evaluate(async () =>
      Object.fromEntries(
        (
          (await (window as unknown as Demo).__parapdf?.getFormFields(
            (window as unknown as Demo).__viewer,
          )) ?? []
        ).map(({ name, value }) => [name, value]),
      ),
    );
    check(
      "getFormFields() reads what the reader entered",
      JSON.stringify(entered) ===
        JSON.stringify({ name: "Ada", agree: "Yes", color: "Off", size: "medium" }),
      JSON.stringify(entered),
    );
    const set = await page.evaluate(() =>
      (window as unknown as Demo).__parapdf?.setFormValues((window as unknown as Demo).__viewer, {
        name: "Grace",
        agree: false,
        color: "green",
        size: "large",
        missing: "x",
      }),
    );
    check(
      "setFormValues() sets the fields it knows",
      JSON.stringify(set) === JSON.stringify(["name", "agree", "color", "size"]),
      JSON.stringify(set),
    );
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            '.parapdf-annotation-layer input[name="name"]',
          ) as HTMLInputElement | null
        )?.value === "Grace",
      undefined,
      { timeout: 10_000 },
    );
    const shown = await page.evaluate(() => {
      const input = (selector: string) =>
        document.querySelector(`.parapdf-annotation-layer ${selector}`) as HTMLInputElement | null;
      const radios = [
        ...document.querySelectorAll<HTMLInputElement>(
          '.parapdf-annotation-layer input[name="color"]',
        ),
      ];
      return {
        name: input('input[name="name"]')?.value,
        agree: input('input[name="agree"]')?.checked,
        color: radios.map((radio) => radio.checked),
        size: (document.querySelector(".parapdf-annotation-layer select") as HTMLSelectElement)
          ?.value,
      };
    });
    check(
      "the form shows the values set",
      JSON.stringify(shown) ===
        JSON.stringify({ name: "Grace", agree: false, color: [false, true], size: "large" }),
      JSON.stringify(shown),
    );
    check(
      "setting values is not heard as the reader's input",
      (await page.evaluate(() => (window as unknown as Demo).__changes?.length)) === changes.length,
    );
    const saved = await page.evaluate(async () => {
      const bytes = await (window as unknown as Demo).__parapdf?.save(
        (window as unknown as Demo).__viewer,
      );
      const text = bytes ? new TextDecoder("latin1").decode(bytes) : "";
      return { grace: text.includes("(Grace)"), large: text.includes("(large)") };
    });
    check("save() writes the values set", saved.grace && saved.large, JSON.stringify(saved));
    check("no errors with form data", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  // --- Form scripts: calculation, validation, formatting, actions ---
  {
    const { page, errors } = await open(
      launched.browser,
      demo("file=synthetic-scripts.pdf&forms=1&scripts=1"),
    );
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const field = (name: string) => page.locator(`.parapdf-annotation-layer input[name="${name}"]`);
    const value = (name: string) => field(name).inputValue();
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            '.parapdf-annotation-layer input[name="opened"]',
          ) as HTMLInputElement | null
        )?.value === "yes",
      undefined,
      { timeout: 15_000 },
    );
    check("the document's script runs as it opens", (await value("opened")) === "yes");
    await page.evaluate(() => {
      (window as unknown as Demo).__changes = [];
      (window as unknown as Demo).__onFormChange = (change) =>
        (window as unknown as Demo).__changes?.push(change);
    });
    for (const [name, typed] of [
      ["price", "2.5"],
      ["quantity", "3"],
    ] as const) {
      await field(name).click();
      // The scripts take each keystroke in turn, as pdf.js's viewer does:
      // typed faster than they answer, keys would meet a stale value.
      await page.keyboard.type(typed, { delay: 150 });
      await page.keyboard.press("Tab");
    }
    // A field shows its value formatted once it loses focus, which Tab gave the total.
    await field("status").click();
    await page
      .waitForFunction(
        () =>
          (
            document.querySelector(
              '.parapdf-annotation-layer input[name="total"]',
            ) as HTMLInputElement | null
          )?.value === "7.50",
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const shown = { price: await value("price"), total: await value("total") };
    check(
      "a calculated field follows its inputs, formatted",
      shown.price === "2.50" && shown.total === "7.50",
      JSON.stringify(shown),
    );
    const changes = await page.evaluate(() => (window as unknown as Demo).__changes ?? []);
    check(
      "the application hears the calculated value",
      changes.some((change) => change.name === "total" && String(change.value) === "7.5"),
      JSON.stringify(changes),
    );
    await field("quantity").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("500", { delay: 150 });
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);
    const rejected = { quantity: await value("quantity"), total: await value("total") };
    // pdf.js's sandbox empties the field it refuses and gives it the focus back.
    check(
      "a value its validation rejects is refused with the document's message",
      dialogs.length === 1 && rejected.quantity === "" && rejected.total === "7.50",
      JSON.stringify({ dialogs, ...rejected }),
    );
    await page.locator(".parapdf-annotation-layer .pushButton").first().click();
    await page
      .waitForFunction(
        () =>
          (
            document.querySelector(
              '.parapdf-annotation-layer input[name="status"]',
            ) as HTMLInputElement | null
          )?.value === "Applied",
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    check("a button's action runs", (await value("status")) === "Applied");
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(1));
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as unknown as Demo).__viewer?.goToPage(0));
    await page.waitForTimeout(500);
    const values = await page.evaluate(async () =>
      Object.fromEntries(
        (
          (await (window as unknown as Demo).__parapdf?.getFormFields(
            (window as unknown as Demo).__viewer,
          )) ?? []
        ).map(({ name, value }) => [name, value]),
      ),
    );
    check(
      "a page's script runs as the page opens",
      String(values.visits) === "1",
      JSON.stringify(values),
    );
    check("no errors running form scripts", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }
  // --- Form scripts: off by default, and loaded only for a document with scripts ---
  {
    const { page, errors } = await open(launched.browser, demo("file=synthetic-scripts.pdf"));
    await page.waitForFunction(() => (window as unknown as Demo).__viewer?.hasPixels(0));
    await page.evaluate(() =>
      (window as unknown as Demo).__setViewerProps({ forms: true, formScripts: true }),
    );
    const opened = page.locator('.parapdf-annotation-layer input[name="opened"]');
    await opened.waitFor();
    await page.waitForFunction(
      () =>
        (document.querySelector('input[name="opened"]') as HTMLInputElement | null)?.value ===
        "yes",
      undefined,
      { timeout: 15_000 },
    );
    check(
      "enabling forms and scripts after the first paint runs the open script",
      (await opened.inputValue()) === "yes",
    );
    check(
      "no errors enabling scripts after the first paint",
      errors.length === 0,
      errors.slice(0, 3).join(" | "),
    );
    await page.context().close();
  }
  for (const [query, label] of [
    ["file=synthetic-scripts.pdf&forms=1", "without formScripts"],
    ["file=synthetic-features.pdf&forms=1&scripts=1&page=2", "for a document without scripts"],
  ] as const) {
    const { page, errors } = await open(launched.browser, demo(query));
    const requested: string[] = [];
    page.on("request", (request) => {
      if (/quickjs|sandbox/.test(request.url())) requested.push(request.url());
    });
    await page.waitForSelector(".parapdf-annotation-layer input");
    await page.waitForTimeout(1000);
    check(`no sandbox loads ${label}`, requested.length === 0, requested.join(" | "));
    if (query.includes("synthetic-scripts")) {
      check(
        "the document's scripts do not run without formScripts",
        (await page.locator('.parapdf-annotation-layer input[name="opened"]').inputValue()) === "",
      );
    }
    check(`no errors ${label}`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }
  // --- View states: kept, shown again at open and later ---
  {
    const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
    const kept = await page.evaluate(() => {
      const viewer = (window as unknown as Demo).__viewer;
      viewer?.goToPage(3);
      viewer?.setScale(2);
      viewer?.rotate(90);
      viewer?.setSpread("odd");
      const scroller = viewer?.scroller;
      if (scroller) {
        scroller.scrollTop += 333;
        scroller.scrollLeft += 120;
      }
      return viewer ? ((window as unknown as Demo).__parapdf?.getViewState(viewer) ?? null) : null;
    });
    await page.waitForTimeout(200);
    check(
      "getViewState() keeps the page, its point, the zoom, and the arrangement",
      kept !== null &&
        kept.scale === 2 &&
        kept.rotation === 90 &&
        kept.spread === "odd" &&
        kept.scrollMode === "vertical" &&
        kept.page >= 2 &&
        kept.page <= 4,
      JSON.stringify(kept),
    );
    check("no errors keeping a view state", errors.length === 0, errors.join(" | "));
    await page.context().close();

    // The same view in a narrower viewport, opened with it.
    const narrow = await launched.browser.newContext({
      viewport: { width: 900, height: 800 },
      deviceScaleFactor: 2,
    });
    const reopened = await narrow.newPage();
    await restoreScaleFactor(reopened, `${baseUrl}calibrate.html`);
    const reopenErrors: string[] = [];
    reopened.on("pageerror", (error) => reopenErrors.push(error.message));
    await reopened.goto(
      demo(`file=usrguide.pdf&page=1&viewState=${encodeURIComponent(JSON.stringify(kept))}`),
    );
    await reopened.waitForFunction(
      () => (window as unknown as Demo).__session?.state.get().status === "ready",
      undefined,
      { timeout: 30_000 },
    );
    await settle(reopened);
    const shown = await reopened.evaluate(() => {
      const viewer = (window as unknown as Demo).__viewer;
      return {
        view: viewer ? ((window as unknown as Demo).__parapdf?.getViewState(viewer) ?? null) : null,
        back: (window as unknown as Demo).__history?.store.get().canGoBack,
      };
    });
    check(
      "initialViewState opens the same view in another viewport, over initialPage",
      shown.view !== null &&
        kept !== null &&
        shown.view.page === kept.page &&
        close(shown.view.x, kept.x, 0.5) &&
        close(shown.view.y, kept.y, 0.5) &&
        shown.view.scale === 2 &&
        shown.view.rotation === 90 &&
        shown.view.spread === "odd" &&
        shown.back === false,
      JSON.stringify(shown),
    );
    const later = await reopened.evaluate(() => {
      const { __viewer: viewer, __parapdf: parapdf } = window as unknown as Demo;
      if (!viewer || !parapdf) return { fitted: null, ignored: null, state: null };
      parapdf.setViewState(viewer, { page: 5, scale: "fit-width", rotation: 0, spread: "none" });
      const fitted = parapdf.getViewState(viewer);
      parapdf.setViewState(viewer, {
        page: "x",
        x: Number.NaN,
        scale: -1,
        rotation: Number.NaN,
        spread: "sideways",
        scrollMode: 3,
      });
      return {
        fitted,
        ignored: parapdf.getViewState(viewer),
        state: viewer.store.get().zoomMode,
      };
    });
    check(
      "setViewState() shows a page from its top with the fit it asks for",
      later.fitted?.page === 5 &&
        later.fitted.scale === "fit-width" &&
        later.fitted.rotation === 0 &&
        later.fitted.spread === "none" &&
        close(later.fitted.y, -12 / ((await state(reopened))?.scale ?? 1), 1),
      JSON.stringify(later.fitted),
    );
    check(
      "setViewState() ignores values out of range",
      JSON.stringify(later.ignored) === JSON.stringify(later.fitted) && later.state === "fit-width",
      JSON.stringify(later.ignored),
    );
    check("no errors showing view states", reopenErrors.length === 0, reopenErrors.join(" | "));
    await narrow.close();
  }
  {
    // A view state wins over the document's own initial view. Its zoom is a
    // number: the outline the demo opens for /PageMode narrows the viewport,
    // and "fit-width" would fit again around the viewport's center.
    const kept = encodeURIComponent(JSON.stringify({ page: 1, x: 0, y: 100, scale: 1 }));
    const { page } = await open(
      launched.browser,
      demo(`file=synthetic-navigation.pdf&view=document&viewState=${kept}`),
    );
    const opened = await state(page);
    const view = await page.evaluate(() => {
      const { __viewer: viewer, __parapdf: parapdf } = window as unknown as Demo;
      return viewer ? parapdf?.getViewState(viewer) : undefined;
    });
    check(
      "a view state wins over /OpenAction, and the layout it leaves out still applies",
      opened?.currentPage !== 2 &&
        opened?.zoomMode === "custom" &&
        opened.scale === 1 &&
        opened.spread === "odd" &&
        close(view?.y, 100, 1),
      JSON.stringify({ page: opened?.currentPage, mode: opened?.zoomMode, view }),
    );
    await page.context().close();
  }

  // --- A URL's fragment opens where it points, and a new one moves the viewer ---
  {
    const withFragment = (fragment: string, query = "") =>
      demo(`file=synthetic-navigation.pdf&fragment=${encodeURIComponent(fragment)}${query}`);
    {
      const { page, errors } = await open(launched.browser, withFragment("page=4"));
      const opened = await state(page);
      check("#page= opens at that page", opened?.currentPage === 3, String(opened?.currentPage));
      check("no errors opening at #page=", errors.length === 0, errors.join(" | "));
      await page.context().close();
    }
    {
      const { page, errors } = await open(launched.browser, withFragment("nameddest=page-4"));
      const opened = await state(page);
      const at = await corner(page);
      check(
        "#nameddest= opens at the named destination, with its zoom",
        opened?.currentPage === 3 && opened.zoomMode === "fit-width" && close(at?.y, 192, 1),
        JSON.stringify({ page: opened?.currentPage, mode: opened?.zoomMode, at }),
      );
      check("no errors opening at #nameddest=", errors.length === 0, errors.join(" | "));
      await page.context().close();
    }
    {
      // Over the document's /OpenAction, at its page, as pdf.js's viewer does.
      // A zoom is a share of the printed size: 96 CSS pixels to 72 points at 100%.
      const { page } = await open(launched.browser, withFragment("zoom=50", "&view=document"));
      const opened = await state(page);
      check(
        "#zoom= wins over /OpenAction's zoom, on its page",
        opened?.currentPage === 2 &&
          opened.zoomMode === "custom" &&
          close(opened.scale, (0.5 * 96) / 72, 1e-6),
        JSON.stringify({ page: opened?.currentPage, mode: opened?.zoomMode, scale: opened?.scale }),
      );
      await page.context().close();
    }
    const { page, errors } = await open(launched.browser, withFragment("page=2&zoom=300,100,500"));
    const opened = await state(page);
    const at = await corner(page);
    check(
      "#page=&zoom= opens at that page, zoom, and point",
      opened?.currentPage === 1 &&
        opened.zoomMode === "custom" &&
        close(opened.scale, (3 * 96) / 72, 1e-6) &&
        close(at?.x, 100, 1) &&
        close(at?.y, 292, 1),
      JSON.stringify({ page: opened?.currentPage, scale: opened?.scale, at }),
    );
    await page.evaluate(() => {
      const demo = window as unknown as Demo & { __opened?: unknown };
      demo.__opened = demo.__pdfDocument;
      demo.__setFragment?.("nameddest=page-4");
    });
    await page
      .waitForFunction(
        () => (window as unknown as Demo).__viewer?.store.get().currentPage === 3,
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    await settle(page);
    const moved = await state(page);
    const same = await page.evaluate(() => {
      const demo = window as unknown as Demo & { __opened?: unknown };
      return {
        document: demo.__opened === demo.__pdfDocument,
        downloads: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
          (entry) => entry.name.includes("synthetic-navigation.pdf"),
        ).length,
      };
    });
    check(
      "a new fragment moves the viewer as a link does, without opening the document again",
      moved?.currentPage === 3 &&
        moved.zoomMode === "fit-width" &&
        moved.canGoBack &&
        same.document &&
        same.downloads === 1,
      JSON.stringify({
        page: moved?.currentPage,
        mode: moved?.zoomMode,
        back: moved?.canGoBack,
        same,
      }),
    );
    check("no errors moving to a new fragment", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  // --- The PDF downloads once, from React's preload outside WebKit (decision 0014) ---
  {
    const { page, errors } = await open(launched.browser, demo("file=usrguide.pdf"));
    const loaded = await page.evaluate(() => ({
      preloads: document.querySelectorAll('link[rel="preload"][as="fetch"][href$="usrguide.pdf"]')
        .length,
      downloads: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .filter((entry) => entry.name.endsWith("usrguide.pdf"))
        .map((entry) => entry.initiatorType),
    }));
    const webkit = launched.name === "webkit" || launched.name === "safari";
    check(
      webkit
        ? "WebKit does not preload the PDF"
        : "the PDF downloads once, from React's preload, before pdf.js asks for it",
      webkit
        ? loaded.preloads === 0
        : loaded.preloads === 1 &&
            (launched.name !== "chromium" ||
              (loaded.downloads.length === 1 && loaded.downloads[0] === "link")),
      JSON.stringify(loaded),
    );
    check("no errors with the preload", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
} finally {
  await launched.close();
  await server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
