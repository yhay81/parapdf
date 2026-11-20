/**
 * Click Next on the first completed page-1 drawing, or 100 ms later. Measure how long until
 * page 2 occupies the viewport with ink and with full-resolution detail. After each frame's
 * callbacks, count blank presentation opportunities and retain the individual samples.
 * Use portrait PDFs that open at fit-width with a second page taller than the viewport.
 * The full page-2 RGBA digest must match across builds, delays, and rounds.
 *
 * DIST=<after> BEFORE=<before> BROWSER=chromium RUNS=7
 *   pnpm --filter @parapdf/prototype exec node scripts/startup-flip-bench.ts
 * DIST defaults to the built prototype. BEFORE adds a paired build. FILES defaults to
 * bill-hr815.pdf,patent-us223898.pdf. OUTPUT selects the JSON report path.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTaking,
} from "../../../bench/scripts/browsers.ts";
import { crossOriginIsolation } from "../../../bench/scripts/isolation.ts";
import type { IdleBaseline } from "../src/metrics.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const browserName = browserFromEnv();
const output = process.env.OUTPUT ?? join(root, "results", `startup-flip-${browserName}.json`);
const runs = Number(process.env.RUNS ?? 7);
assert.ok(Number.isSafeInteger(runs) && runs > 0, "RUNS must be a positive integer");
const files = (process.env.FILES ?? "bill-hr815.pdf,patent-us223898.pdf").split(",");
const viewport = { width: 820, height: 900 };
const delays = [0, 100];

interface Frame {
  frameStartMs: number;
  afterFrameMs: number;
  position: boolean;
  hasPixels: boolean;
  sharp: boolean;
}

interface Flip {
  firstMs: number;
  clickMs: number;
  actualDelayMs: number;
  readyAtClick: boolean;
  sharpAtClick: boolean;
  toInkMs: number;
  toSharpMs: number;
  clickFrameBlank: boolean | null;
  sampledBlankFrames: number;
  sampledUnpositionedFrames: number;
  frameSamples: Frame[];
  firstViewportCommitMs: number;
  width: number;
  height: number;
  sha256: string;
}

declare global {
  interface Window {
    startupFlip?: Flip;
    startupFlipError?: string;
  }
}

// Installed before navigation. Click the actual toolbar button from the page-1 mutation
// callback, avoiding a driver round trip between the first ink and the immediate click.
function observe(delay: number) {
  let firstMs: number | undefined;
  let clickMs: number | undefined;
  let inkMs: number | undefined;
  let sharpMs: number | undefined;
  let readyAtClick = false;
  let sharpAtClick = false;
  let clickFrameBlank: boolean | null = null;
  let nextFrame: number;
  const frameSamples: Frame[] = [];
  const complete = (canvas: HTMLCanvasElement) =>
    canvas.width > 0 && canvas.height > 0 && canvas.style.visibility !== "hidden";
  function read() {
    const view = document.querySelector<HTMLElement>(".parapdf-viewport");
    const host = view?.querySelector<HTMLElement>('[data-page="2"]');
    if (!view || !host) return { position: false, canvas: undefined, sharp: false };
    const rect = host.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    // A Next jump puts the top of page 2 at the 12 CSS px gap and fills the reading area.
    const position =
      Math.abs(rect.top - box.top - 12) <= 2 &&
      rect.bottom >= box.bottom - 1 &&
      rect.width > view.clientWidth - 28 &&
      rect.left >= box.left - 1;
    const canvases = [
      ...host.querySelectorAll<HTMLCanvasElement>(".parapdf-canvas-wrapper > canvas"),
    ];
    const canvas = canvases
      .filter(complete)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const sharp =
      !!canvas &&
      canvas.style.height === "100%" &&
      Math.abs(canvas.width - rect.width * devicePixelRatio) <= 2 &&
      Math.abs(canvas.height - rect.height * devicePixelRatio) <= 2;
    return { position, canvas, sharp };
  }
  function record(state: ReturnType<typeof read>) {
    if (!state.position || !state.canvas) return;
    inkMs ??= performance.now();
    if (state.sharp) sharpMs ??= performance.now();
  }
  function click() {
    const state = read();
    readyAtClick = !!state.canvas;
    sharpAtClick = state.sharp;
    const button = [...document.querySelectorAll<HTMLButtonElement>(".toolbar button")].find(
      (button) => button.textContent.trim() === "Next",
    );
    if (!button || button.disabled) {
      window.startupFlipError = "Next button unavailable at first paint";
      return;
    }
    clickMs = performance.now();
    button.click();
    record(read());
  }
  const mutations = new MutationObserver(() => {
    if (firstMs === undefined) {
      const firstPage = document.querySelectorAll<HTMLCanvasElement>(
        '[data-page="1"] .parapdf-canvas-wrapper > canvas',
      );
      if (![...firstPage].some(complete)) return;
      firstMs = performance.now();
      if (delay) setTimeout(click, delay);
      else click();
    }
    if (clickMs !== undefined) record(read());
  });
  mutations.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });

  // The posted task observes state after this frame's animation callbacks have run.
  const channel = new MessageChannel();
  const frame = () => {
    channel.port2.postMessage(performance.now());
    nextFrame = requestAnimationFrame(frame);
  };
  channel.port1.onmessage = async ({ data: start }: MessageEvent<number>) => {
    if (firstMs === undefined || clickMs === undefined) return;
    const state = read();
    const afterFrameMs = performance.now() - clickMs;
    // A click between a frame callback and its posted task belongs to that partial frame.
    if (start < clickMs) clickFrameBlank = state.position && !state.canvas;
    else
      frameSamples.push({
        frameStartMs: start - clickMs,
        afterFrameMs,
        position: state.position,
        hasPixels: !!state.canvas,
        sharp: state.sharp,
      });
    record(state);
    if (
      !state.position ||
      !state.sharp ||
      !state.canvas ||
      inkMs === undefined ||
      sharpMs === undefined
    )
      return;
    const presented = frameSamples.find((sample) => sample.position && sample.hasPixels);
    if (!presented) return;
    mutations.disconnect();
    cancelAnimationFrame(nextFrame);
    channel.port1.close();
    channel.port2.close();
    // Read back only after the final timed milestone.
    try {
      const { canvas } = state;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas readback is unavailable");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = await crypto.subtle.digest("SHA-256", pixels);
      window.startupFlip = {
        firstMs,
        clickMs,
        actualDelayMs: clickMs - firstMs,
        readyAtClick,
        sharpAtClick,
        toInkMs: inkMs - clickMs,
        toSharpMs: sharpMs - clickMs,
        clickFrameBlank,
        sampledBlankFrames: frameSamples.filter((f) => f.position && !f.hasPixels).length,
        sampledUnpositionedFrames: frameSamples.filter((f) => !f.position).length,
        firstViewportCommitMs: presented.afterFrameMs,
        frameSamples,
        width: canvas.width,
        height: canvas.height,
        sha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""),
      };
    } catch (error) {
      window.startupFlipError = String(error);
    }
  };
  nextFrame = requestAnimationFrame(frame);
}

async function sample(browser: Browser, origin: string, file: string, delay: number) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    const calibration = new URL("calibrate.html", origin).href;
    await restoreScaleFactor(page, calibration);
    await page.goto(calibration);
    await page.waitForFunction(() => window.__done);
    const idle = await page.evaluate(() => window.__result as IdleBaseline);
    await page.addInitScript(observe, delay);
    const url = new URL("minimal.html", origin);
    url.searchParams.set("file", file);
    await page.goto(url.href);
    await page.waitForFunction(() => window.startupFlip || window.startupFlipError, undefined, {
      timeout: 60_000,
    });
    const result = await page.evaluate(() => {
      if (!window.startupFlip)
        throw new Error(window.startupFlipError ?? "Missing flip measurements");
      return {
        ...window.startupFlip,
        toolbar: document.querySelector(".toolbar span")?.textContent.trim(),
        dpr: devicePixelRatio,
        isolated: crossOriginIsolated,
      };
    });
    assert.equal(result.dpr, 2);
    assert.equal(result.isolated, true);
    assert.match(result.toolbar ?? "", /^2\s*\//);
    return { ...result, idle };
  } finally {
    await context.close();
  }
}

const power = assertMeasurementPower();
const servers: Awaited<ReturnType<typeof preview>>[] = [];
const variants: { name: string; origin: string }[] = [];
const jobs = [];
try {
  const directories = { before: process.env.BEFORE, final: process.env.DIST ?? join(root, "dist") };
  for (const [name, directory] of Object.entries(directories)) {
    if (!directory) continue;
    const server = await preview({
      root,
      configFile: false,
      logLevel: "warn",
      plugins: [crossOriginIsolation()],
      build: { outDir: resolve(directory) },
      preview: { host: "127.0.0.1", port: 4186 + servers.length, open: false, strictPort: true },
    });
    servers.push(server);
    const origin = server.resolvedUrls?.local[0];
    if (!origin) throw new Error("Missing preview URL");
    variants.push({ name, origin });
  }
  const launched = await launchBrowser(browserName);
  try {
    const loadStart = loadavg()[0];
    for (const file of files) {
      let expected: string | undefined;
      // Discard one round for warmup. Alternate both delay order and build order.
      for (let round = 0; round <= runs; round++) {
        for (const delay of round % 2 ? delays : delays.toReversed()) {
          for (const variant of (round + Number(delay > 0)) % 2
            ? variants.toReversed()
            : variants) {
            const result = await measureInTurn(launched, (browser) =>
              sample(browser, variant.origin, file, delay),
            );
            const key = `${result.width}×${result.height}:${result.sha256}`;
            expected ??= key;
            assert.equal(key, expected, `Page 2 raster mismatch for ${file}, ${variant.name}`);
            if (!round) continue;
            jobs.push({ file, round, variant: variant.name, delay, ...result });
            console.log(
              `${file} ${round}/${runs} ${variant.name} +${delay} ms: ink ${result.toInkMs.toFixed(1)} ms, sharp ${result.toSharpMs.toFixed(1)} ms, ${result.sampledBlankFrames} blank frames`,
            );
          }
        }
      }
    }
    const { dependencies } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const report = {
      date: new Date().toISOString(),
      browser: launched.label,
      cpu: cpus()[0]?.model,
      pdfjs: dependencies["pdfjs-dist"],
      viewport,
      deviceScaleFactor: 2,
      power,
      runs,
      files,
      delays,
      before: process.env.BEFORE_LABEL ?? null,
      loadStart,
      loadEnd: loadavg()[0],
      turnTaking,
      jobs,
    };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await launched.close();
  }
} finally {
  await Promise.all(servers.map((server) => server.close()));
}
