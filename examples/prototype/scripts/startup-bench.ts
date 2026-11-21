/**
 * Cold client navigation to page 1 of the production minimal viewer, beside the same PDF
 * drawn directly by the shipped pdf.js loader into one full-resolution canvas. Compares
 * a DIST from this checkout with an optional BEFORE build on the same pdf.js version.
 * Each fresh context first measures its idle frame interval and timer lag. Use files
 * opening at page 1 at fit-width, whose whole first page fits the detail budget, and whose
 * second page (if any) the viewer prefetches at full resolution. Every full-page RGBA digest and size must match.
 * Observe the first completed drawing and first full-DPR drawing becoming visible in the
 * DOM. Attached canvas bytes include in-progress drawings, excluding engine/GPU memory.
 *
 * DIST=<after> BEFORE=<before> BROWSER=chromium RUNS=15 FILES=bill-hr815.pdf
 *   pnpm --filter @parapdf/prototype exec node scripts/startup-bench.ts
 * WIDTH/HEIGHT set the viewport in CSS px (820×900). LATENCY (additional ms) and BANDWIDTH
 * (Mbit/s) use Chromium network emulation. OUTPUT selects the JSON report path.
 * REACT_PDF=1 adds the react-pdf + react-window reader. The discarded warmup
 * compares its RGBA pixels with direct pdf.js; every timed raster is checked against its hash.
 * STARTUP_PORT selects the first preview port. Each round rotates the execution order.
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
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
function setting(key: string, fallback: number, minimum: number, integer = false): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (
    !raw.trim() ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(
      `${key} must be a finite ${integer ? "integer" : "number"} >= ${minimum}, got "${raw}"`,
    );
  }
  return value;
}
const dist = resolve(process.env.DIST ?? join(root, "dist"));
const before = process.env.BEFORE && resolve(process.env.BEFORE);
const files = (process.env.FILES ?? "bill-hr815.pdf,synthetic-text-1000.pdf").split(",");
const runs = setting("RUNS", 15, 1, true);
const browserName = browserFromEnv();
const output = process.env.OUTPUT ?? join(root, "results", `startup-${browserName}.json`);
const viewport = {
  width: setting("WIDTH", 820, 25, true),
  height: setting("HEIGHT", 900, 65, true),
};
const network = { latencyMs: setting("LATENCY", 0, 0), bandwidthMbps: setting("BANDWIDTH", 0, 0) };
const throttled = network.latencyMs > 0 || network.bandwidthMbps > 0;
if (throttled && browserName !== "chromium")
  throw new Error("LATENCY and BANDWIDTH require Chromium");

interface Snapshot {
  ms: number;
  canvasBytes: number;
  nonemptyCanvases: number;
  width: number;
  height: number;
  getPageRequests: number;
  operatorListRequests: number;
}
interface Sample {
  first: Snapshot;
  sharp: Snapshot;
  nextPageMs: number | null;
  nextPageSharpMs: number | null;
  getDocMs: number;
  getPageMs: number;
  getOperatorListMs: number;
  firstSha256: string;
  sha256: string;
}
declare global {
  interface Window {
    startupSample?: Sample;
    startupError?: string;
  }
}

// Installed before navigation in both viewers and the reference. Read the full raster
// only after the last timed milestone. Avoid pixel readback while pdf.js is drawing.
function observeStartup() {
  const messages = new Map<string, number>();
  const counts = new Map<string, number>();
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (
    message,
    options?: Transferable[] | StructuredSerializeOptions,
  ) {
    const action = message?.action;
    if (action === "GetDocRequest" || action === "GetPage" || action === "GetOperatorList") {
      if (!messages.has(action)) messages.set(action, performance.now());
      counts.set(action, (counts.get(action) ?? 0) + 1);
    }
    return Reflect.apply(post, this, [message, options]);
  };
  let first: Snapshot | undefined;
  let firstCanvas: HTMLCanvasElement | undefined;
  let sharp: Snapshot | undefined;
  let nextPageMs: number | null = null;
  let nextPageSharpMs: number | null = null;
  const observer = new MutationObserver(() => {
    const reactPage = document.querySelector<HTMLElement>('.react-pdf__Page[data-page-number="1"]');
    const scroller =
      reactPage?.closest<HTMLElement>(".viewport") ??
      document.querySelector<HTMLElement>(".parapdf-viewport, main");
    if (!scroller) return;
    const ms = performance.now();
    const completed = (canvas: HTMLCanvasElement) =>
      canvas.width > 0 &&
      canvas.height > 0 &&
      canvas.style.visibility !== "hidden" &&
      (!reactPage || canvas.style.width !== "");
    if (!reactPage && nextPageSharpMs === null) {
      const next = scroller.querySelector<HTMLElement>('[data-page="2"]');
      if (next) {
        const canvases = next.querySelectorAll<HTMLCanvasElement>(
          ".parapdf-canvas-wrapper > canvas",
        );
        for (const drawing of canvases) {
          if (!completed(drawing)) continue;
          nextPageMs ??= ms;
          if (
            drawing.style.height === "100%" &&
            Math.abs(drawing.width - next.getBoundingClientRect().width * devicePixelRatio) <= 2
          )
            nextPageSharpMs ??= ms;
        }
      }
    }
    const visible = Array.from(
      scroller.querySelectorAll<HTMLCanvasElement>(
        '[data-page="1"] .parapdf-canvas-wrapper > canvas, [data-page-number="1"] .react-pdf__Page__canvas, main > canvas',
      ),
    ).filter(completed);
    if (!visible.length) return;
    const canvas = visible.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
    const all = Array.from(document.querySelectorAll("canvas")).filter((c) => c.width && c.height);
    const snapshot = {
      ms,
      canvasBytes: all.reduce((sum, c) => sum + c.width * c.height * 4, 0),
      nonemptyCanvases: all.length,
      width: canvas.width,
      height: canvas.height,
      getPageRequests: counts.get("GetPage") ?? 0,
      operatorListRequests: counts.get("GetOperatorList") ?? 0,
    };
    first ??= snapshot;
    firstCanvas ??= canvas;
    if (
      canvas.width !== (scroller.clientWidth - 24) * devicePixelRatio ||
      (!reactPage && scroller.localName !== "main" && canvas.style.height !== "100%")
    )
      return;
    sharp ??= snapshot;
    if (
      !reactPage &&
      nextPageSharpMs === null &&
      scroller.localName !== "main" &&
      scroller.querySelector('[data-page="1"]')?.getAttribute("aria-label") !== "Page 1 of 1"
    )
      return;
    observer.disconnect();
    Worker.prototype.postMessage = post;
    if (firstCanvas.width !== first.width || firstCanvas.height !== first.height) {
      window.startupError = "The first drawing was resized before its pixels could be checked";
      return;
    }
    const digest = async (drawing: HTMLCanvasElement): Promise<string> => {
      const context = drawing.getContext("2d");
      if (!context) throw new Error("Canvas readback is unavailable");
      const pixels = context.getImageData(0, 0, drawing.width, drawing.height).data;
      const hash = await crypto.subtle.digest("SHA-256", pixels);
      return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
    };
    const result = {
      first,
      sharp,
      nextPageMs,
      nextPageSharpMs,
      getDocMs: messages.get("GetDocRequest") ?? -1,
      getPageMs: messages.get("GetPage") ?? -1,
      getOperatorListMs: messages.get("GetOperatorList") ?? -1,
    };
    // At a large zoom the first base stays under the full-resolution page.
    const fullHash = digest(canvas);
    const firstHash = firstCanvas === canvas ? fullHash : digest(firstCanvas);
    void Promise.all([firstHash, fullHash]).then(
      ([firstSha256, sha256]) => {
        window.startupSample = { ...result, firstSha256, sha256 };
      },
      (error: unknown) => {
        window.startupError = String(error);
      },
    );
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
}

interface Variant {
  name: string;
  url: URL;
}
interface RasterComparison {
  reference?: string;
  pixels?: { total: number; different: number; maxChannelDifference: number };
}
async function sample(browser: Browser, variant: Variant, file: string, check?: RasterComparison) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  try {
    const page: Page = await context.newPage();
    const calibration = new URL("calibrate.html", variant.url).href;
    await restoreScaleFactor(page, calibration);
    await page.goto(calibration);
    await page.waitForFunction(() => window.__done);
    const idle = await page.evaluate(() => window.__result as IdleBaseline);
    if (throttled) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      const bytesPerSecond = network.bandwidthMbps ? (network.bandwidthMbps * 1e6) / 8 : -1;
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: network.latencyMs,
        downloadThroughput: bytesPerSecond,
        uploadThroughput: bytesPerSecond,
      });
    }
    await page.addInitScript(observeStartup);
    const url = new URL(variant.url);
    url.searchParams.set("file", file);
    await page.goto(url.href);
    try {
      await page.waitForFunction(() => window.startupSample || window.startupError, undefined, {
        timeout: 60_000,
      });
    } catch (error) {
      const state = await page.evaluate(() =>
        Array.from(document.querySelectorAll("canvas"))
          .filter((canvas) => canvas.width && canvas.height)
          .slice(0, 12)
          .map((canvas) => ({
            page: canvas.closest("[data-page]")?.getAttribute("data-page") ?? 1,
            width: canvas.width,
            height: canvas.height,
            cssHeight: canvas.style.height,
            hidden: canvas.style.visibility === "hidden",
          })),
      );
      throw new Error(
        `${variant.name} ${file} at ${viewport.width}×${viewport.height}: timed out waiting for page 1 at full-page DPR 2, RGBA readback, and page 2 prefetch if present. Use a fit-width fixture opening at page 1 whose detail budget holds the whole first page. Canvases: ${JSON.stringify(state)}`,
        { cause: error },
      );
    }
    const result = await page.evaluate(() => {
      if (window.startupError) throw new Error(window.startupError);
      const result = window.startupSample;
      if (
        !result ||
        devicePixelRatio !== 2 ||
        !crossOriginIsolated ||
        [result.getDocMs, result.getPageMs, result.getOperatorListMs].some((ms) => ms < 0)
      ) {
        throw new Error("Missing measurements, wrong DPR or missing dedicated PDF worker");
      }
      return result;
    });
    // Only the discarded warmup exports and compares pixels, after all timing milestones.
    if (check && variant.name === "direct") {
      check.reference = await page
        .locator("main > canvas")
        .evaluate((c: HTMLCanvasElement) => c.toDataURL());
    }
    if (check && variant.name === "react-pdf") {
      if (!check.reference) throw new Error("Missing direct pdf.js reference drawing");
      check.pixels = await page
        .locator('[data-page-number="1"] .react-pdf__Page__canvas')
        .evaluate(async (canvas: HTMLCanvasElement, reference) => {
          const img = new Image();
          img.src = reference;
          await img.decode();
          const { width, height } = canvas;
          if (img.naturalWidth !== width || img.naturalHeight !== height)
            throw new Error("Reader and reference have different raster dimensions");
          const copy = document.createElement("canvas");
          copy.width = width;
          copy.height = height;
          const ctx = copy.getContext("2d");
          const drawing = canvas.getContext("2d");
          if (!ctx || !drawing) throw new Error("Cannot compare first-page pixels");
          ctx.drawImage(img, 0, 0);
          const a = ctx.getImageData(0, 0, width, height).data;
          const b = drawing.getImageData(0, 0, width, height).data;
          let different = 0;
          let maxChannelDifference = 0;
          for (let i = 0; i < a.length; i += 4) {
            let delta = 0;
            for (let c = i; c < i + 4; c++)
              delta = Math.max(delta, Math.abs((a[c] ?? 0) - (b[c] ?? 0)));
            if (delta) different++;
            maxChannelDifference = Math.max(maxChannelDifference, delta);
          }
          return { total: width * height, different, maxChannelDifference };
        }, check.reference);
    }
    return { ...result, idle };
  } finally {
    await context.close();
  }
}

const power = assertMeasurementPower();
const reference = mkdtempSync(join(tmpdir(), "parapdf-startup-reference-"));
const servers: Awaited<ReturnType<typeof preview>>[] = [];
const jobs = [];
try {
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: reference,
      target: "esnext",
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: {
          reference: join(root, "scripts/startup-reference.ts"),
          calibrate: join(root, "calibrate.html"),
        },
        output: { entryFileNames: "[name].js" },
      },
    },
  });
  writeFileSync(
    join(reference, "index.html"),
    '<!doctype html><meta charset="utf-8"><style>main{position:absolute;inset:40px 0 0;overflow:auto;scrollbar-gutter:stable}canvas{display:block;margin:12px auto}</style><main></main><script type="module" src="/reference.js"></script>',
  );
  symlinkSync(join(dist, "corpus"), join(reference, "corpus"), "dir");
  const variants: Variant[] = [];
  const port = Number(process.env.STARTUP_PORT ?? 4183);
  if (!Number.isInteger(port) || port < 4179 || port > 4187)
    throw new Error("STARTUP_PORT must be 4179–4187");
  for (const [name, directory] of [
    ["viewer", dist],
    ...(before ? [["before", before]] : []),
    ["direct", reference],
  ] as [string, string][]) {
    const server = await preview({
      root,
      configFile: false,
      logLevel: "warn",
      plugins: [crossOriginIsolation()],
      build: { outDir: directory },
      preview: { host: "127.0.0.1", port: port + variants.length, strictPort: true, open: false },
    });
    servers.push(server);
    const origin = server.resolvedUrls?.local[0];
    if (!origin) throw new Error("Missing preview URL");
    variants.push({
      name,
      url: new URL(name === "direct" ? "index.html" : "minimal.html", origin),
    });
  }
  const viewer = variants[0];
  if (process.env.REACT_PDF === "1" && viewer) {
    variants.push({
      name: "react-pdf",
      url: new URL("compare.html?viewer=react-pdf-window&text=1&links=1", viewer.url),
    });
  }
  const launched = await launchBrowser(browserName);
  try {
    const loadStart = loadavg()[0];
    const comparisons = [];
    for (const file of files) {
      let expected: string | undefined;
      let expectedFirst: string | undefined;
      let expectedReact: string | undefined;
      const comparison: RasterComparison = {};
      // Discard one job of each variant to warm process-level caches, then rotate the
      // order so a first-in-round effect cannot systematically favor a single variant.
      for (let round = 0; round <= runs; round++) {
        for (const variant of [
          ...variants.slice(round % variants.length),
          ...variants.slice(0, round % variants.length),
        ]) {
          const result = await measureInTurn(launched, (browser) =>
            sample(
              browser,
              variant,
              file,
              !round && process.env.REACT_PDF === "1" ? comparison : undefined,
            ),
          );
          const key = `${result.sharp.width}x${result.sharp.height}:${result.sha256}`;
          if (variant.name === "react-pdf") {
            expectedReact ??= key;
            if (key !== expectedReact)
              throw new Error(`${file}: react-pdf's raster changed between runs`);
            if (!round) {
              if (!comparison.pixels || (key === expected) !== (comparison.pixels.different === 0))
                throw new Error(`${file}: pixel comparison disagrees with the raster hash`);
              comparisons.push({ file, ...comparison.pixels, direct: expected, reactPdf: key });
              console.log(
                `${file}: ${comparison.pixels.different}/${comparison.pixels.total} react-pdf pixels differ from direct pdf.js`,
              );
              delete comparison.reference;
            }
          } else {
            expected ??= key;
            if (key !== expected)
              throw new Error(`${file} ${variant.name}: raster mismatch ${key} vs ${expected}`);
          }
          if (variant.name === "viewer" || variant.name === "before") {
            const first = `${result.first.width}x${result.first.height}:${result.firstSha256}`;
            expectedFirst ??= first;
            if (first !== expectedFirst)
              throw new Error(
                `${file} ${variant.name}: first drawing differs from ${expectedFirst}`,
              );
          }
          if (!round) continue;
          jobs.push({ file, round, variant: variant.name, ...result });
          console.log(
            `${file} ${round}/${runs} ${variant.name}: ${result.first.ms.toFixed(1)} ms, ${result.first.canvasBytes} canvas bytes`,
          );
        }
      }
    }
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    writeFileSync(
      output,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          machine: `${platform()} ${release()} ${arch()}, ${cpus()[0]?.model}`,
          browser: launched.label,
          pdfjs: pkg.dependencies["pdfjs-dist"],
          ...(comparisons.length
            ? {
                reactPdf: pkg.devDependencies["react-pdf"],
                reactWindow: pkg.devDependencies["react-window"],
                comparisons,
              }
            : {}),
          viewport,
          network,
          deviceScaleFactor: 2,
          runs,
          power,
          loadStart,
          loadEnd: loadavg()[0],
          turnTaking,
          before: process.env.BEFORE_LABEL ?? null,
          jobs,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await launched.close();
  }
} finally {
  await Promise.all(servers.map((server) => server.close()));
  rmSync(reference, { recursive: true, force: true });
}
