// biome-ignore-all lint/style/noNonNullAssertion: the probes await both viewers before asserting their state.
/**
 * M3: independent viewports of one document session, including viewport-only
 * teardown and StrictMode. Run after build; BROWSER, ENGINE, and DIST apply.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { createServer, preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const configFile = join(exampleDir, "vite.config.ts");
const engine = process.env.ENGINE ?? "pdfjs-next";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}`);

async function ready(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const viewer = window.__split?.viewers[i];
      return viewer?.store.get().status === "ready" && viewer.sharpness() > 0.99;
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
        same: left!.store.get().document === right!.store.get().document,
        opens: window.__lifecycle!.stats.opens,
      };
    });
    assert.deepEqual(shared, { same: true, opens: 1 });
    console.log("PASS two viewers open one shared session");

    const rightBefore = await page.evaluate(() => window.__split!.viewers[1]!.getViewState());
    await page.evaluate(() => {
      const left = window.__split!.viewers[0]!;
      left.goToPage(8);
      left.setScale(1.5);
      left.rotate(90);
      left.setTool("hand");
    });
    await ready(page, 0);
    assert.deepEqual(
      await page.evaluate(() => window.__split!.viewers[1]!.getViewState()),
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
    const saved = await page.evaluate(() => window.__split!.viewers[0]!.getViewState());
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Hide viewport" }).click();
    assert.equal(await page.evaluate(() => window.__split!.viewers[0]!.signal.aborted), true);
    assert.equal(await page.evaluate(() => window.__split!.viewers[1]!.signal.aborted), false);
    assert.equal(await page.evaluate(() => window.__split!.viewers[0]!.keptPixels), 0);
    assert.equal(
      await page.evaluate(() => {
        const viewer = window.__split!.viewers[0]!;
        viewer.search("lorem");
        return viewer.store.get().search.status;
      }),
      "idle",
      "searching a detached viewport does not leave it searching forever",
    );
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Show viewport" }).click();
    await ready(page, 0);
    const restored = await page.evaluate(() => window.__split!.viewers[0]!.getViewState());
    assert.equal(restored!.page, saved!.page);
    assert.equal(restored!.rotation, saved!.rotation);
    assert.equal(restored!.scale, saved!.scale);
    assert.ok(Math.abs(restored!.x - saved!.x) < 3 && Math.abs(restored!.y - saved!.y) < 3);
    assert.equal(await page.evaluate(() => window.__lifecycle!.stats.opens), 1);
    console.log("PASS viewport detach aborts its lifetime and reattach restores the view");

    // Start long work in both viewers, then remove only the first provider.
    await page.evaluate(() => {
      for (const viewer of window.__split!.viewers) viewer!.search("lorem");
    });
    await page.locator('[data-viewer="0"]').getByRole("button", { name: "Close viewer" }).click();
    await page.waitForFunction(
      () => window.__split!.viewers[1]!.store.get().search.status === "done",
      undefined,
      { timeout: 60_000 },
    );
    const closed = await page.evaluate(() => {
      const [left, right] = window.__split!.viewers;
      return {
        left: left!.store.get().status,
        right: right!.store.get().status,
        leftAborted: left!.signal.aborted,
        rightAborted: right!.signal.aborted,
        matches: right!.store.get().search.matches.length,
        destroys: window.__lifecycle!.stats.destroys,
      };
    });
    assert.equal(closed.left, "idle");
    assert.equal(closed.right, "ready");
    assert.equal(closed.leftAborted, true);
    assert.equal(closed.rightAborted, false);
    assert.ok(closed.matches > 0);
    assert.equal(closed.destroys, 0);
    await page.evaluate(() => window.__split!.viewers[1]!.goToPage(15));
    await ready(page, 1);
    console.log("PASS closing one viewer stops its work while the other searches and draws");

    await page.locator('[data-viewer="1"]').getByRole("button", { name: "Close viewer" }).click();
    await page.waitForFunction(() => window.__lifecycle!.stats.destroys === 1);
    assert.deepEqual(await page.evaluate(() => window.__lifecycle!.unhandled), []);
    assert.deepEqual(errors, []);
    console.log("PASS the last viewer releases the session without errors");
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
  await launched.browser.close();
}
