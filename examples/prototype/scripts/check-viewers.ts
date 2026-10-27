// biome-ignore-all lint/style/noNonNullAssertion: the probes await both viewers before asserting their state.
/**
 * M3: independent viewports of one document session, including viewport-only
 * teardown and StrictMode; M4: viewers that edit annotations sharing the
 * session. Run after build; BROWSER, ENGINE, and DIST apply.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { createServer, preview } from "vite";
import {
  captureFailure,
  launchBrowser,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const configFile = join(exampleDir, "vite.config.ts");
const engine = process.env.ENGINE ?? "pdfjs-next";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);
// WebKit refuses module worker scripts it takes from its cache in this
// cross-origin-isolated demo (as check-lifecycle.ts notes), here when the
// check opens saved bytes again; pdf.js then parses them on the main thread.
// That is reported, not counted as an error.
const isWebKitWorkerRefusal = (text: string) =>
  launched.label.startsWith("WebKit") &&
  /Cross-Origin-Embedder-Policy|due to access control checks/.test(text);
let workerRefusals = 0;

async function ready(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const viewer = window.__split?.viewers[i];
      return viewer?.store.get().layout != null && viewer.sharpness() > 0.99;
    },
    index,
    { timeout: 60_000 },
  );
}

async function checkViews(url: string) {
  const context = await launched.browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await restoreScaleFactor(page, new URL("calibrate.html", url).href);
    await page.goto(`${url}?split=1&engine=${engine}&count=1&file=synthetic-text-1000.pdf`);
    await ready(page, 0);
    await ready(page, 1);
    const shared = await page.evaluate(() => {
      const [left, right] = window.__split!.viewers;
      return {
        same: left!.session !== null && left!.session === right!.session,
        opens: window.__lifecycle!.stats.opens,
      };
    });
    assert.deepEqual(shared, { same: true, opens: 1 });
    console.log("PASS two viewers open one shared session");

    const rightBefore = await page.evaluate(() =>
      window.__parapdf!.getViewState(window.__split!.viewers[1]!),
    );
    await page.evaluate(() => {
      const left = window.__split!.viewers[0]!;
      left.goToPage(8);
      left.setScale(1.5);
      left.rotate(90);
      left.setTool("hand");
    });
    await ready(page, 0);
    assert.deepEqual(
      await page.evaluate(() => window.__parapdf!.getViewState(window.__split!.viewers[1]!)),
      rightBefore,
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const state = window.__split!.viewers[1]!.store.cold.get();
        return { rotation: state.rotation, tool: state.tool };
      }),
      { rotation: 0, tool: "select" },
    );
    // Native scrolling and keyboard zoom target only the focused viewport.
    await page.evaluate(() => {
      window.__split!.viewers[1]!.scroller!.scrollTop += 900;
    });
    await page.waitForFunction(() => window.__split!.viewers[1]!.store.get().currentPage > 0);
    const leftScale = await page.evaluate(() => window.__split!.viewers[0]!.store.get().scale);
    await page.getByRole("document", { name: "Right PDF" }).focus();
    await page.keyboard.press("Control+-");
    await ready(page, 1);
    assert.equal(
      await page.evaluate(() => window.__split!.viewers[0]!.store.get().scale),
      leftScale,
    );
    console.log("PASS scroll, navigation, zoom, rotation, tool, and keyboard are independent");

    // Detach only the viewport while its provider and shared document stay alive.
    const saved = await page.evaluate(() =>
      window.__parapdf!.getViewState(window.__split!.viewers[0]!),
    );
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Hide viewport" }).click();
    assert.equal(await page.evaluate(() => window.__split!.viewers[0]!.signal.aborted), true);
    assert.equal(await page.evaluate(() => window.__split!.viewers[1]!.signal.aborted), false);
    assert.equal(await page.evaluate(() => window.__split!.viewers[0]!.keptPixels), 0);
    assert.equal(
      await page.evaluate(() => {
        const search = window.__split!.searches[0]!;
        search.search("lorem");
        return search.store.get().status;
      }),
      "idle",
      "searching a detached viewport does not leave it searching forever",
    );
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Show viewport" }).click();
    await ready(page, 0);
    const restored = await page.evaluate(() =>
      window.__parapdf!.getViewState(window.__split!.viewers[0]!),
    );
    assert.equal(restored!.page, saved!.page);
    assert.equal(restored!.rotation, saved!.rotation);
    assert.equal(restored!.scale, saved!.scale);
    assert.ok(Math.abs(restored!.x - saved!.x) < 3 && Math.abs(restored!.y - saved!.y) < 3);
    assert.equal(await page.evaluate(() => window.__lifecycle!.stats.opens), 1);
    console.log("PASS viewport detach aborts its lifetime and reattach restores the view");

    // Start long work in both viewers, then close only the first.
    await page.evaluate(() => {
      for (const search of window.__split!.searches) search!.search("lorem");
    });
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Close viewer" }).click();
    await page.waitForFunction(
      () => window.__split!.searches[1]!.store.get().status === "done",
      undefined,
      { timeout: 60_000 },
    );
    const closed = await page.evaluate(() => {
      const [left, right] = window.__split!.viewers;
      return {
        left: left!.store.get().layout === null && left!.session === null ? "idle" : "shown",
        right: right!.store.get().layout === null ? "idle" : "shown",
        leftAborted: left!.signal.aborted,
        rightAborted: right!.signal.aborted,
        matches: window.__split!.searches[1]!.store.get().matches.length,
        destroys: window.__lifecycle!.stats.destroys,
      };
    });
    assert.equal(closed.left, "idle");
    assert.equal(closed.right, "shown");
    assert.equal(closed.leftAborted, true);
    assert.equal(closed.rightAborted, false);
    assert.ok(closed.matches > 0);
    assert.equal(closed.destroys, 0);
    await page.evaluate(() => window.__split!.viewers[1]!.goToPage(15));
    await ready(page, 1);
    console.log("PASS closing one viewer stops its work while the other searches and draws");

    await page.locator('[data-viewer="1"]').getByRole("button", { name: "Close viewer" }).click();
    await page.waitForFunction(() => window.__split!.viewers[1]!.session === null);
    assert.equal(
      await page.evaluate(() => window.__lifecycle!.stats.destroys),
      0,
      "the provider keeps the session without viewers",
    );
    await page.getByRole("button", { name: "Close document" }).click();
    await page.waitForFunction(() => window.__lifecycle!.stats.destroys === 1);
    assert.deepEqual(await page.evaluate(() => window.__lifecycle!.unhandled), []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS closing the viewers and then the provider releases the session without errors",
    );
  } catch (error) {
    await captureFailure(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await context.close();
  }
}

/** Annotations two viewers of one session create: kept apart, saved together. */
async function checkSharedEditing(url: string) {
  const context = await launched.browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (isWebKitWorkerRefusal(String(error))) workerRefusals++;
    else errors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isWebKitWorkerRefusal(message.text())) workerRefusals++;
    else errors.push(message.text());
  });
  try {
    await restoreScaleFactor(page, new URL("calibrate.html", url).href);
    await page.goto(
      `${url}?split=1&annotations=1&engine=${engine}&count=1&file=synthetic-text-1000.pdf`,
    );
    await ready(page, 0);
    await ready(page, 1);
    await page.waitForFunction(() =>
      window.__split!.annotations.every((editing) => editing?.store.get().state != null),
    );
    const editorIds = () =>
      page.evaluate(() => {
        const proxy = window.__split!.viewers[1]!.session!.proxy;
        const storage = proxy.annotationStorage as unknown as Iterable<[string, unknown]>;
        return [...storage]
          .map(([key]) => key)
          .filter((key) => key.startsWith("pdfjs_internal_editor_"));
      });
    const added = await page.evaluate(async () => {
      const [left, right] = window.__split!.annotations;
      return [
        await left!.addSignature({ text: "Left" }, { description: "Left" }),
        await right!.addSignature({ text: "Right" }, { description: "Right" }),
      ];
    });
    assert.deepEqual(added, [true, true]);
    const shared = await page.evaluate(() => ({
      same: window.__split!.viewers[0]!.session === window.__split!.viewers[1]!.session,
      opens: window.__lifecycle!.stats.opens,
      exported: window.__split!.annotations.map((editing) => editing!.export().length),
    }));
    assert.deepEqual(shared, { same: true, opens: 1, exported: [1, 1] });
    assert.equal(new Set(await editorIds()).size, 2, "the two viewers' editors have their own ids");
    /** The stamps of page 1 of the document saved from viewer `index`. */
    const savedStamps = (index: number) =>
      page.evaluate(async (i) => {
        const viewer = window.__split!.viewers[i]!;
        const bytes = await window.__parapdf!.save(viewer);
        const pdfjs = (
          window as unknown as {
            pdfjsLib: {
              getDocument(source: { data: Uint8Array }): {
                promise: Promise<{
                  getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string }[]> }>;
                }>;
              };
            };
          }
        ).pdfjsLib;
        const saved = await pdfjs.getDocument({ data: bytes! }).promise;
        const annotations = await (await saved.getPage(1)).getAnnotations();
        return annotations.filter((annotation) => annotation.subtype === "Stamp").length;
      }, index);
    assert.equal(await savedStamps(0), 2, "saving from one viewer includes the other's");
    console.log(
      "PASS viewers that edit share one session, with ids of their own, and save together",
    );

    // A hidden viewport's annotations stay in the document, and come back once.
    const left = page.locator('[data-viewer="0"]');
    await left.getByRole("button", { name: "Hide viewport" }).click();
    assert.equal(await savedStamps(1), 2, "saving keeps the annotations of a hidden viewer");
    await left.getByRole("button", { name: "Show viewport" }).click();
    await ready(page, 0);
    await page.waitForFunction(
      () => window.__split!.annotations[0]?.store.get().state?.isEmpty === false,
    );
    assert.equal(await page.evaluate(() => window.__split!.annotations[0]!.export().length), 1);
    assert.equal((await editorIds()).length, 2, "shown again, not twice");
    assert.equal(await savedStamps(1), 2);
    console.log("PASS a hidden viewer's annotations are saved, and shown again once");

    await left.getByRole("button", { name: "Close viewer" }).click();
    await page.waitForFunction(() => window.__split!.viewers[0]!.session === null);
    assert.equal((await editorIds()).length, 1, "closing a viewer removes only its annotations");
    assert.equal(await savedStamps(1), 1);
    assert.equal(await page.evaluate(() => window.__split!.annotations[1]!.export().length), 1);
    assert.deepEqual(errors, []);
    console.log("PASS closing one editing viewer leaves the other's annotations");
    if (workerRefusals > 0) {
      console.log(
        `NOTE the browser refused a worker script under COEP ${workerRefusals} times; pdf.js then parsed those bytes on the main thread`,
      );
    }
  } catch (error) {
    await captureFailure(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await context.close();
  }
}

try {
  const server = await preview({
    root: exampleDir,
    configFile,
    logLevel: "warn",
    ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
    preview: { host: "127.0.0.1", port: 4184, strictPort: false, open: false },
  });
  try {
    await checkViews(server.resolvedUrls!.local[0]!);
    await checkSharedEditing(server.resolvedUrls!.local[0]!);
  } finally {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
  const dev = await createServer({
    root: exampleDir,
    configFile,
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 4189, strictPort: false },
  });
  await dev.listen();
  try {
    await checkViews(dev.resolvedUrls!.local[0]!);
  } finally {
    await dev.close();
  }
} finally {
  await launched.close();
}
