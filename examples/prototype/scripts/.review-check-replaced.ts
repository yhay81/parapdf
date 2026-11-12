/**
 * Functional checks for the document lifecycle: React StrictMode's double
 * mount and quick remounts share one loaded document, the document is
 * destroyed only after the last viewer has been gone for a moment, work that
 * outlives a closed viewer neither fails noisily nor raises unhandled
 * rejections, an equal source object keeps the open document, a data
 * source keeps the application's bytes and opens again after its document
 * was destroyed, and a transport source shows its document from the ranges
 * it serves and opens again too. The StrictMode part runs on the Vite development server,
 * because production React does not double-mount.
 *
 * And the lifetimes React gives what it renders (`?lifetimes=`,
 * src/Lifetimes.tsx): a provider under a Suspense boundary mounts once what
 * reads its document below it has it; a source changed in a transition
 * commits, the document it replaces shows until then, and a document opened
 * for a transition React abandoned closes; and a document and its viewer
 * hidden in an `<Activity>`, for less and for more than a document nothing
 * holds stays open, show the page, zoom, rotation, tool, search, and
 * annotations the reader left, in StrictMode too. That check's lines say
 * how long the pages took to show again, which it does not judge.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:lifecycle
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next),
 * DIST (another build of the demo, in a directory of its own; the StrictMode
 * part runs on the source).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer, preview, type ViteDevServer } from "vite";
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const configFile = join(exampleDir, "vite.config.ts");
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    captureFailure(name);
  }
}

interface Snapshot {
  opens: number;
  destroys: number;
  unhandled: string[];
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const lifecycle = window.__lifecycle;
    return {
      opens: lifecycle?.stats.opens ?? -1,
      destroys: lifecycle?.stats.destroys ?? -1,
      unhandled: [...(lifecycle?.unhandled ?? [])],
    };
  });

type Hooks = "remount" | "unmount" | "mount";
const call = (page: Page, hook: Hooks) =>
  page.evaluate((name) => window.__lifecycle?.[name](), hook);

/** Waits until a viewer other than `previous` has painted page 1. */
async function waitForNewViewer(page: Page, previous: unknown = null): Promise<void> {
  await page.evaluate((old) => {
    (window as { __previousViewer?: unknown }).__previousViewer = old;
  }, previous);
  await page.waitForFunction(
    () => {
      const state = window as {
        __viewer?: { hasPixels(index: number): boolean };
        __previousViewer?: unknown;
      };
      return state.__viewer !== state.__previousViewer && state.__viewer?.hasPixels(0) === true;
    },
    undefined,
    { timeout: 30_000 },
  );
}

const currentViewer = (page: Page) =>
  page.evaluateHandle(() => (window as { __viewer?: unknown }).__viewer);

/** Opens `url`, and waits for its viewer to paint unless it may never come to (`painted`). */
async function openPage(browser: Browser, url: string, painted = true) {
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
  if (painted) await waitForNewViewer(page);
  return { page, errors };
}

/** Whether the viewer comes to show its document, sharp, within `timeout`. */
const shows = (page: Page, timeout = 20_000): Promise<boolean> =>
  page
    .waitForFunction(
      () => {
        const viewer = window.__viewer;
        return viewer?.store.get().layout != null && viewer.sharpness() > 0.99;
      },
      undefined,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );

/** Whether `condition` comes true in the page within `timeout`. */
const comes = (page: Page, condition: () => boolean, timeout = 10_000): Promise<boolean> =>
  page.waitForFunction(condition, undefined, { timeout }).then(
    () => true,
    () => false,
  );

/** What the reader would miss of a viewer that came back another way. */
const left = (page: Page) =>
  page.evaluate(() => {
    const viewer = window.__viewer;
    const view = viewer && window.__parapdf?.getViewState(viewer);
    const search = window.__search?.store.get();
    if (!viewer || !view || !search) return null;
    const storage = viewer.session?.proxy.annotationStorage as
      | Iterable<[string, unknown]>
      | undefined;
    return {
      page: view.page,
      scale: view.scale,
      rotation: view.rotation,
      x: view.x,
      y: view.y,
      tool: viewer.store.cold.get().tool,
      search: `${search.status} ${search.matches.length} ${search.current}`,
      annotations: window.__annotations?.export().length ?? -1,
      // The editors in the document's own storage: one each, not one more per time shown.
      editors: [...(storage ?? [])].filter(([key]) => key.startsWith("pdfjs_internal_editor_"))
        .length,
    };
  });

type Left = Awaited<ReturnType<typeof left>>;

const sameAsLeft = (now: Left, before: Left): boolean =>
  now !== null &&
  before !== null &&
  now.page === before.page &&
  now.scale === before.scale &&
  now.rotation === before.rotation &&
  Math.abs(now.x - before.x) < 3 &&
  Math.abs(now.y - before.y) < 3 &&
  now.tool === before.tool &&
  now.search === before.search &&
  now.annotations === before.annotations &&
  now.editors === before.editors;

/** Hydrate a second root and mount a third after the first already opened their shared PDF. */
async function checkReaders(browser: Browser, dev: ViteDevServer, base: string): Promise<void> {
  const path = "/scripts/lifecycle-readers.tsx";
  const { Reader } = await dev.ssrLoadModule(path);
  const markup = renderToString(createElement(Reader));
  const url = new URL(path, base).href;
  const { page, errors } = await openPage(browser, new URL("calibrate.html", base).href, false);
  try {
    await page.evaluate(
      async ({ url, markup, engine }) => {
        const readers: typeof import("./lifecycle-readers.tsx") = await import(url);
        readers.hydrateFirst(markup, engine);
      },
      { url, markup, engine },
    );
    await page.waitForFunction(
      () => Number(document.querySelector("#first output")?.textContent) > 0,
    );
    const count = await page.locator("#first output").textContent();
    await page.evaluate(
      async ({ url, markup }) => {
        const readers: typeof import("./lifecycle-readers.tsx") = await import(url);
        readers.mountOthers(markup);
      },
      { url, markup },
    );
    await page.waitForFunction(
      () => Number(document.querySelector("#hydrated output")?.textContent) > 0,
    );
    const joined = await page.locator("#joined output").textContent();
    check(
      "a new provider of a ready document exposes its proxy during render",
      joined === count,
      String(joined),
    );
    const unlocked = await comes(
      page,
      () => Number(document.querySelector("#encrypted output")?.textContent) > 0,
    );
    check(
      "a child's first effect can answer the pending password request",
      unlocked,
      (await page.locator("#encrypted").textContent()) ?? "",
    );
    check(
      "a second server-rendered root hydrates from its opening snapshot and then shows the ready document",
      (await page.locator("#hydrated output").textContent()) === count && errors.length === 0,
      errors.slice(0, 3).join(" | "),
    );
  } finally {
    await page.context().close();
  }
}

/**
 * A Suspense boundary above the provider, and below it a component that
 * reads the document with no boundary of its own: React mounts nothing of
 * the provider before the document was read, so the provider's render has
 * to open it.
 */
async function checkSuspendedMount(browser: Browser, base: string): Promise<void> {
  const { page, errors } = await openPage(
    browser,
    `${base}?lifetimes=above&engine=${engine}&count=1&file=usrguide.pdf`,
    false,
  );
  const shown = await shows(page);
  const entries = shown
    ? Number(await page.locator("[data-outline]").getAttribute("data-outline"))
    : -1;
  const state = await snapshot(page);
  check(
    "a provider under a Suspense boundary mounts once what reads its document below it has it",
    shown && entries > 0 && state.opens === 1,
    `${shown ? "shown" : "the fallback stays"}, ${entries} outline entries, ${state.opens} loads`,
  );
  check(
    "a suspended mount raises no unhandled rejections or errors",
    state.unhandled.length === 0 && errors.length === 0,
    [...state.unhandled, ...errors].slice(0, 3).join(" | "),
  );
  await page.context().close();
}

/**
 * The provider's source changed in a transition, with the document read in
 * a boundary that already shows: React commits the new source only once it
 * was read, and shows the document before it until then.
 */
async function checkTransition(browser: Browser, base: string): Promise<void> {
  const { page, errors } = await openPage(
    browser,
    `${base}?lifetimes=transition&engine=${engine}&count=1&file=bill-hr815.pdf`,
  );
  await page.locator("[data-outline]").waitFor({ state: "attached", timeout: 20_000 });
  /** Whether the transition to `file` commits and the viewer shows it. */
  const commits = (file: string) =>
    page
      .waitForFunction(
        (name) => {
          const viewer = window.__viewer;
          return (
            document.querySelector(`[data-file="${name}"] [data-pending="false"]`) !== null &&
            viewer?.sourceName === name &&
            viewer.store.get().layout !== null &&
            viewer.sharpness() > 0.99
          );
        },
        file,
        { timeout: 20_000 },
      )
      .then(
        () => true,
        () => false,
      );

  // What the viewer shows as React commits that the transition is pending.
  const during = await page.evaluate(
    (next) =>
      new Promise<{ pending: boolean; shown: string | null; painted: boolean }>((resolve) => {
        const seen = (pending: boolean) => {
          observer.disconnect();
          const viewer = window.__viewer;
          resolve({
            pending,
            shown: viewer?.sourceName ?? null,
            painted: viewer?.hasPixels(0) ?? false,
          });
        };
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-pending="true"]') !== null) seen(true);
        });
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["data-pending"],
          subtree: true,
        });
        setTimeout(() => seen(false), 5000);
        window.__lifetimes?.open?.(next);
      }),
    "usrguide.pdf",
  );
  const switched = await commits("usrguide.pdf");
  const opened = await snapshot(page);
  check(
    "a source changed in a transition commits once its document was read",
    switched && opened.opens === 2,
    `${switched ? "committed" : "still pending"}, ${opened.opens} loads`,
  );
  check(
    "the document before it shows while the transition is pending",
    during.pending && during.shown === "bill-hr815.pdf" && during.painted,
    JSON.stringify(during),
  );
  if (switched) {
    await page.waitForTimeout(2500);
    const replaced = await snapshot(page);
    check(
      "the document a transition replaced is destroyed",
      replaced.opens === 2 && replaced.destroys === 1,
      `${replaced.opens} loads, ${replaced.destroys} destroyed`,
    );

    // A transition React abandons for another: the render that opened its
    // document never mounts, and nothing ever releases it.
    const abandoned = await page.evaluate(
      async ([slow, next]) => {
        const stats = window.__lifecycle?.stats;
        const open = window.__lifetimes?.open;
        if (!stats || !open) return false;
        const opens = stats.opens;
        open(slow);
        const deadline = performance.now() + 5000;
        while (stats.opens === opens && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const rendered = stats.opens > opens;
        open(next);
        return rendered;
      },
      ["synthetic-text-1000.pdf", "bill-hr815.pdf"] as const,
    );
    const landed = await commits("bill-hr815.pdf");
    // The document of the abandoned render loads to its end, and closes ten
    // seconds after it came to rest.
    const closed = await comes(
      page,
      () => {
        const stats = window.__lifecycle?.stats;
        return stats !== undefined && stats.opens - stats.destroys === 1;
      },
      30_000,
    );
    const settled = await snapshot(page);
    check(
      "a document opened for a transition React abandoned is destroyed",
      abandoned && landed && closed && settled.opens === 4,
      `${abandoned ? "rendered" : "never rendered"}, ${landed ? "the next committed" : "the next is pending"}, ${settled.opens} loads, ${settled.destroys} destroyed`,
    );
  }
  const end = await snapshot(page);
  check(
    "transitions raise no unhandled rejections or errors",
    end.unhandled.length === 0 && errors.length === 0,
    [...end.unhandled, ...errors].slice(0, 3).join(" | "),
  );
  await page.context().close();
}

/**
 * A document and its viewer React hides and shows again (`<Activity>`),
 * which destroys their effects and keeps their state: for less than the
 * time a document nothing holds stays open, and for more, which closes it.
 * `owner` says where the viewer's owner (`useViewer()`) is, inside what
 * hides or outside it; `where` names the build.
 */
async function checkHiding(
  browser: Browser,
  base: string,
  owner: "inside" | "outside",
  where: string,
): Promise<void> {
  const { page, errors } = await openPage(
    browser,
    `${base}?lifetimes=activity&owner=${owner}&annotations=1&engine=${engine}&count=1&file=usrguide.pdf`,
  );
  const named = (what: string) => `${what} (${where}, the viewer's owner ${owner} it)`;
  // What a reader leaves behind: a finished search, a place and a way of
  // showing it, and an annotation of their own.
  await page.evaluate(() => window.__search?.search("the"));
  const searched = await comes(page, () => window.__search?.store.get().status === "done", 60_000);
  await page.evaluate(() => {
    const viewer = window.__viewer;
    viewer?.setScale(1.5);
    viewer?.rotate(90);
    viewer?.setTool("hand");
    viewer?.goToPage(2);
  });
  await shows(page);
  // Inside the page, not at its top: the offsets are part of what comes back.
  await page.evaluate(() => {
    const scroller = window.__viewer?.scroller;
    if (scroller) scroller.scrollTop += 240;
  });
  await shows(page);
  const editing = await comes(page, () => window.__annotations?.store.get().state != null);
  const added =
    editing &&
    (await page.evaluate(
      async () =>
        (await window.__annotations?.addSignature({ text: "Kept" }, { description: "Kept" })) ??
        false,
    ));
  await shows(page);
  const before = await left(page);
  check(
    named("the reader leaves a search, a view, and an annotation behind"),
    searched &&
      added &&
      before?.page === 2 &&
      before.rotation === 90 &&
      before.annotations === 1 &&
      before.editors === 1,
    JSON.stringify(before),
  );

  for (const [away, kind, loads, destroyed] of [
    [300, "for a moment", 1, 0],
    [2500, "until its document closed", 2, 1],
  ] as const) {
    await page.evaluate(() => window.__lifetimes?.show?.(false));
    await page.waitForTimeout(away);
    const hidden = await page.evaluate(() => ({
      destroys: window.__lifecycle?.stats.destroys ?? -1,
      letGo: window.__viewer?.session === null,
      kept: window.__viewer?.keptPixels ?? -1,
    }));
    // How long the reader waits for the pages, which the viewer draws again:
    // from React being told to show them to the first frame in which every
    // visible page has pixels, and to the first in which they are sharp.
    const waited = await page.evaluate(
      (timeout) =>
        new Promise<{ pixels: number | null; sharp: number | null }>((resolve) => {
          const start = performance.now();
          let pixels: number | null = null;
          window.__lifetimes?.show?.(true);
          const look = () => {
            const now = performance.now() - start;
            let sharp = false;
            try {
              const viewer = window.__viewer;
              if (viewer?.store.get().layout != null) {
                if (viewer.blankFraction() === 0) pixels ??= now;
                sharp = viewer.sharpness() > 0.99;
              }
            } catch {
              // A viewer that cannot say shows nothing.
            }
            if (sharp) resolve({ pixels: pixels ?? now, sharp: now });
            else if (now > timeout) resolve({ pixels, sharp: null });
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        }),
      20_000,
    );
    const back = waited.sharp !== null;
    // The annotation's editor returns with the page's editing layer.
    const edited =
      back && (await comes(page, () => window.__annotations?.store.get().state?.isEmpty === false));
    const outline =
      back && (await comes(page, () => document.querySelector("[data-outline]") !== null));
    const now = back ? await left(page) : null;
    const counts = await snapshot(page);
    check(
      named(`a document hidden ${kind} lets go of what it held`),
      hidden.letGo && hidden.kept === 0 && hidden.destroys === destroyed,
      JSON.stringify(hidden),
    );
    check(
      named(`a document hidden ${kind} shows again what the reader left`),
      back && edited && outline && sameAsLeft(now, before),
      `${JSON.stringify(now)}, ${
        back
          ? `pixels after ${Math.round(waited.pixels ?? 0)} ms, sharp after ${Math.round(waited.sharp ?? 0)} ms`
          : "nothing shows"
      }`,
    );
    check(
      named(`a document hidden ${kind} opens ${loads === 1 ? "once" : "again"}, without errors`),
      counts.opens === loads &&
        counts.destroys === destroyed &&
        counts.unhandled.length === 0 &&
        errors.length === 0,
      [`${counts.opens} loads, ${counts.destroys} destroyed`, ...counts.unhandled, ...errors]
        .slice(0, 4)
        .join(" | "),
    );
    if (!back) break;
  }
  await page.context().close();
}

/** The server replaces the PDF at one URL while React keeps the viewer hidden. */
async function checkReplacedFile(browser: Browser, base: string, replace: () => void) {
  const { page } = await openPage(
    browser,
    `${base}?lifetimes=activity&annotations=1&count=1&engine=${engine}&file=latest.pdf`,
  );
  try {
    await page.evaluate(() => window.__search?.search("the"));
    await page.waitForFunction(() => window.__search?.store.get().status === "done");
    await page.waitForFunction(() => window.__annotations?.store.get().state != null);
    const marked = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      canvas.getContext("2d")?.fillRect(0, 0, 24, 24);
      const added = await window.__annotations?.addImage(canvas.toDataURL(), {
        pageIndex: 0,
        altText: "Only in the first document",
      });
      return added && (window.__search?.store.get().matches.length ?? 0) > 0;
    });
    check("the first PDF has a stamp and a completed search", marked === true);
    await page.evaluate(() => window.__lifetimes?.show?.(false));
    await page.waitForFunction(() => window.__lifecycle?.stats.destroys === 1);
    replace();
    await page.evaluate(() => window.__lifetimes?.show?.(true));
    await page.waitForFunction(
      () =>
        window.__viewer?.session?.pageCount === 8 &&
        window.__annotations?.store.get().state != null,
    );
    const result = await page.evaluate(async () => {
      const viewer = window.__viewer;
      const session = viewer?.session;
      if (!session || !viewer || !window.__parapdf) throw new Error("missing reopened document");
      const bytes = await window.__parapdf.save(viewer);
      if (!bytes) throw new Error("saving the reopened document failed");
      const { pdfjs, worker } = session.pdfjs;
      const task = pdfjs.getDocument({ data: bytes, worker });
      try {
        const saved = await task.promise;
        const annotations = await (await saved.getPage(1)).getAnnotations();
        return {
          edited: window.__annotations?.export().length,
          matches: window.__search?.store.get().matches.length,
          stamps: annotations.filter((item) => item.subtype === "Stamp").length,
        };
      } finally {
        await task.destroy();
      }
    });
    // The replacement PDF has one embedded stamp of its own.
    check(
      "saving a different PDF at the same URL keeps only its own annotations",
      result.edited === 0 && result.stamps === 1,
      JSON.stringify(result),
    );
    check(
      "a different PDF at the same URL drops the old search matches",
      result.matches === 0,
      JSON.stringify(result),
    );
  } finally {
    await page.context().close();
  }
}

const launched = await launchBrowser();
let latest = "usrguide.pdf";
const server = await preview({
  root: exampleDir, configFile, build: { outDir: process.env.DIST },
  preview: { host: "127.0.0.1", port: 4184 }, plugins: [{
    name: "replace-document",
    configurePreviewServer(server) {
      server.middlewares.use((request,response,next) => {
        if (request.url === "/corpus/latest.pdf") {
          request.url = "/corpus/" + latest;
          response.setHeader("Cache-Control", "no-store");
        }
        next();
      });
    }
  }]
});
try {
 await checkReplacedFile(launched.browser, server.resolvedUrls.local[0], () => { latest="synthetic-annotations.pdf"; });
} finally {
 await server.close(); await launched.close();
}
process.exitCode = failures ? 1 : 0;
