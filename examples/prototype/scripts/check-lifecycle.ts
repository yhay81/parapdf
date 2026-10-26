/**
 * Functional checks for the document lifecycle: React StrictMode's double
 * mount and quick remounts share one loaded document, the document is
 * destroyed only after the last viewer has been gone for a moment, work that
 * outlives a closed viewer neither fails noisily nor raises unhandled
 * rejections, an equal source object keeps the open document, and a data
 * source keeps the application's bytes and opens again after its document
 * was destroyed. The StrictMode part runs on the Vite development server,
 * because production React does not double-mount.
 *
 * Usage: pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype check:lifecycle
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINE (pdfjs-next),
 * DIST (another build of the demo, in a directory of its own; the StrictMode
 * part runs on the source).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { createServer, preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const configFile = join(exampleDir, "vite.config.ts");
const engine = process.env.ENGINE ?? "pdfjs-next";
let failures = 0;
// WebKit refuses module worker scripts it takes from its cache in this
// cross-origin-isolated demo, so pdf.js's renderer worker for a reopened
// document fails to start there. That is reported, not counted as a failure.
const browserNotes: string[] = [];
const isWebKitWorkerRefusal = (text: string) =>
  /Cross-Origin-Embedder-Policy|due to access control checks/.test(text);

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
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

async function openPage(browser: Browser, url: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("calibrate.html", url).href);
  const errors: string[] = [];
  const record = (text: string) => {
    if (isWebKitWorkerRefusal(text)) browserNotes.push(text);
    else errors.push(text);
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  await page.goto(url);
  await waitForNewViewer(page);
  return { page, errors };
}

const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);

try {
  // Development server: StrictMode mounts, unmounts, and mounts every effect.
  const dev = await createServer({
    root: exampleDir,
    configFile,
    logLevel: "warn",
    server: { port: 4189, host: "127.0.0.1", strictPort: false },
  });
  await dev.listen();
  try {
    const devUrl = dev.resolvedUrls?.local[0] ?? "http://127.0.0.1:4189/";
    const { page, errors } = await openPage(
      launched.browser,
      `${devUrl}?engine=${engine}&count=1&file=bill-hr815.pdf`,
    );
    const first = await snapshot(page);
    check(
      "StrictMode's double mount loads the document once",
      first.opens === 1,
      `${first.opens} loads`,
    );
    for (let round = 0; round < 5; round++) {
      const previous = await currentViewer(page);
      await call(page, "remount");
      await waitForNewViewer(page, previous);
    }
    const remounted = await snapshot(page);
    check(
      "five remounts in StrictMode reuse the loaded document",
      remounted.opens === 1 && remounted.destroys === 0,
      `${remounted.opens} loads, ${remounted.destroys} destroyed`,
    );
    check(
      "no unhandled rejections in development",
      remounted.unhandled.length === 0 && errors.length === 0,
      [...remounted.unhandled, ...errors].slice(0, 3).join(" | "),
    );
    await page.context().close();
  } finally {
    await dev.close();
  }

  // Production build: closing while background work runs, and reopening.
  const server = await preview({
    root: exampleDir,
    configFile,
    logLevel: "warn",
    ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
    preview: { port: 4184, host: "127.0.0.1", strictPort: false, open: false },
  });
  try {
    const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4184/";
    const { page, errors } = await openPage(
      launched.browser,
      `${baseUrl}?engine=${engine}&count=1&file=synthetic-text-1000.pdf`,
    );
    // Search all 1,000 pages and close the viewer while it runs, along with
    // the page-size pass and any renders still in flight.
    await page.evaluate(() => {
      window.__search?.search("lorem");
    });
    await call(page, "unmount");
    await page.waitForTimeout(2500);
    const closed = await snapshot(page);
    check(
      "the last viewer's document is destroyed after it closes",
      closed.opens === 1 && closed.destroys === 1,
      `${closed.opens} loads, ${closed.destroys} destroyed`,
    );

    await call(page, "mount");
    await waitForNewViewer(page);
    const reopened = await snapshot(page);
    check(
      "a later mount loads the document again",
      reopened.opens === 2 && reopened.destroys === 1,
      `${reopened.opens} loads, ${reopened.destroys} destroyed`,
    );

    // Close right after mounting, while the document may still be loading.
    await call(page, "unmount");
    await page.waitForTimeout(2500);
    const previous = await currentViewer(page);
    await call(page, "mount");
    await page.waitForFunction(
      (old) => (window as { __viewer?: unknown }).__viewer !== old,
      previous,
      { timeout: 30_000 },
    );
    await call(page, "unmount");
    await page.waitForTimeout(2500);
    const settled = await snapshot(page);
    check(
      "every loaded document is destroyed once nothing uses it",
      settled.opens === settled.destroys,
      `${settled.opens} loads, ${settled.destroys} destroyed`,
    );
    check(
      "closed viewers raise no unhandled rejections or errors",
      settled.unhandled.length === 0 && errors.length === 0,
      [...settled.unhandled, ...errors].slice(0, 3).join(" | "),
    );
    await page.context().close();

    // The demo passes a new source object at every render. An equal one must
    // keep the open document, and with it the view's rotation, which opening
    // a document resets.
    const equal = await openPage(
      launched.browser,
      `${baseUrl}?engine=${engine}&count=1&file=bill-hr815.pdf`,
    );
    const rotation = () =>
      equal.page.evaluate(() => {
        const demo = window as {
          __viewer?: { store: { get(): { rotation: number } } };
          __session?: { state: { get(): { status: string } } };
        };
        const state = demo.__viewer?.store.get();
        const status = demo.__session?.state.get().status;
        return state ? { rotation: state.rotation, status } : null;
      });
    await equal.page.evaluate(() => {
      (window as { __viewer?: { rotate(degrees: number): void } }).__viewer?.rotate(90);
      window.__lifecycle?.rerender();
    });
    await equal.page.waitForTimeout(500);
    const kept = await rotation();
    check(
      "a new but equal source keeps the open document",
      kept?.rotation === 90 && kept.status === "ready",
      JSON.stringify(kept),
    );
    await equal.page.context().close();

    // Bytes the application passes stay its own: pdf.js transfers what it
    // gets to its worker, which used to leave the application's buffer empty,
    // and the same bytes could not open again once their document was gone.
    const data = await openPage(
      launched.browser,
      `${baseUrl}?engine=${engine}&count=1&file=bill-hr815.pdf&source=data`,
    );
    const bytes = () => data.page.evaluate(() => window.__lifecycle?.sourceBytes() ?? null);
    const loadedBytes = await bytes();
    check(
      "a data source keeps the application's bytes",
      loadedBytes !== null && loadedBytes > 0,
      `${loadedBytes} bytes left`,
    );
    await call(data.page, "unmount");
    await data.page.waitForTimeout(2500);
    await call(data.page, "mount");
    let reopenedData = true;
    await waitForNewViewer(data.page).catch(() => {
      reopenedData = false;
    });
    const again = await snapshot(data.page);
    check(
      "the same bytes open again after their document was destroyed",
      reopenedData && again.opens === 2 && again.destroys === 1,
      `${again.opens} loads, ${again.destroys} destroyed${reopenedData ? "" : ", no pixels within 30 s"}`,
    );
    check(
      "data sources raise no unhandled rejections or errors",
      again.unhandled.length === 0 && data.errors.length === 0,
      [...again.unhandled, ...data.errors].slice(0, 3).join(" | "),
    );
    await data.page.context().close();
  } finally {
    await server.close();
  }
} finally {
  await launched.close();
}

if (browserNotes.length > 0) {
  console.log(
    `NOTE the browser refused a worker script under COEP ${browserNotes.length} times; pdf.js then draws that document on the main thread`,
  );
}
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
