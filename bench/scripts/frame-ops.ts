/**
 * What the operations behind frame display and the frame cache cost the main
 * thread in each browser, on a canvas the size of a US Letter page at
 * fit-width and devicePixelRatio 2 (about 3.6 MP): a new OffscreenCanvas
 * with its 2D context, against one kept and resized; `transferToImageBitmap()`;
 * `transferFromImageBitmap()` onto a displayed `bitmaprenderer` canvas; and
 * `createImageBitmap()` of that canvas, the copy the frame cache keeps when a
 * page unmounts, both the call itself and until its promise resolves. Then
 * the same copy of a displayed canvas pdf.js draws into, with its 2D
 * context, and `drawImage()` of a kept copy into a new such canvas, which is
 * how a page drawn in place gets its kept drawing back. Each on a GPU-backed
 * and on a CPU-backed (`willReadFrequently`) 2D context, the two pdf.js
 * draws with. Prints a table per browser and writes
 * bench/results/frames-ops-<browser>.json.
 *
 * Usage: BROWSER=firefox node bench/scripts/frame-ops.ts; ROUNDS (20).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
  measureInTurn,
} from "./browsers.ts";

const resultsDir = fileURLToPath(new URL("../results/", import.meta.url));
const rounds = Number(process.env.ROUNDS ?? "20");
const browserName = browserFromEnv();

/** Runs in the page. Times are medians and maxima in ms over `rounds`. */
async function measureOps({ rounds, gpu }: { rounds: number; gpu: boolean }) {
  const width = 1555;
  const height = 2333;
  const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      max: sorted.at(-1) ?? 0,
    };
  };
  const options = { alpha: false, willReadFrequently: !gpu };
  /** Some drawing, so that no browser can skip the pixels. */
  const draw = (context: OffscreenCanvasRenderingContext2D, seed: number) => {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 400; index++) {
      context.fillStyle = `hsl(${(index * 37 + seed) % 360} 60% 50%)`;
      context.fillRect((index * 97) % width, (index * 61) % height, 60, 24);
    }
  };
  const shown = document.createElement("canvas");
  shown.style.cssText = "width:300px;height:450px";
  document.body.append(shown);
  const renderer = shown.getContext("bitmaprenderer");
  if (!renderer) throw new Error("no bitmaprenderer");

  const times: Record<string, number[]> = {
    newCanvasAndContext: [],
    keptCanvasResize: [],
    transferToImageBitmap: [],
    transferFromImageBitmap: [],
    createImageBitmapCall: [],
    createImageBitmapResolved: [],
    copyOf2dCall: [],
    copyOf2dResolved: [],
    drawImageInto2d: [],
  };
  const drawn = document.createElement("canvas");
  drawn.style.cssText = "width:300px;height:450px";
  document.body.append(drawn);
  const kept = new OffscreenCanvas(1, 1);
  const keptContext = kept.getContext("2d", options) as OffscreenCanvasRenderingContext2D;
  for (let round = 0; round < rounds; round++) {
    let start = performance.now();
    const fresh = new OffscreenCanvas(width, height);
    const context = fresh.getContext("2d", options) as OffscreenCanvasRenderingContext2D;
    draw(context, round);
    times.newCanvasAndContext?.push(performance.now() - start);

    start = performance.now();
    kept.width = width;
    kept.height = height;
    draw(keptContext, round);
    times.keptCanvasResize?.push(performance.now() - start);

    start = performance.now();
    const bitmap = fresh.transferToImageBitmap();
    times.transferToImageBitmap?.push(performance.now() - start);
    kept.transferToImageBitmap().close();
    kept.width = 1;
    kept.height = 1;

    start = performance.now();
    shown.width = width;
    shown.height = height;
    renderer.transferFromImageBitmap(bitmap);
    times.transferFromImageBitmap?.push(performance.now() - start);
    await frame();
    await frame();

    start = performance.now();
    const copying = createImageBitmap(shown);
    times.createImageBitmapCall?.push(performance.now() - start);
    const copy = await copying;
    times.createImageBitmapResolved?.push(performance.now() - start);
    if (copy.width !== width) throw new Error(`the copy is ${copy.width} px wide`);
    copy.close();
    await frame();

    // A canvas drawn in place, as pdf.js draws the displayed one.
    drawn.width = width;
    drawn.height = height;
    draw(
      drawn.getContext("2d", options) as unknown as OffscreenCanvasRenderingContext2D,
      round + 1,
    );
    await frame();
    await frame();
    start = performance.now();
    const copyOf2d = createImageBitmap(drawn);
    times.copyOf2dCall?.push(performance.now() - start);
    const kept2d = await copyOf2d;
    times.copyOf2dResolved?.push(performance.now() - start);
    const fresh2d = document.createElement("canvas");
    fresh2d.style.cssText = "width:300px;height:450px";
    document.body.append(fresh2d);
    start = performance.now();
    fresh2d.width = width;
    fresh2d.height = height;
    (fresh2d.getContext("2d", options) as CanvasRenderingContext2D | null)?.drawImage(kept2d, 0, 0);
    times.drawImageInto2d?.push(performance.now() - start);
    kept2d.close();
    await frame();
    await frame();
    fresh2d.remove();
  }
  return Object.fromEntries(Object.entries(times).map(([name, values]) => [name, stats(values)]));
}

const power = assertMeasurementPower();
const launched = await launchBrowser(browserName);
const results: Record<string, unknown> = { browser: launched.label, rounds, power };
try {
  for (const gpu of [true, false]) {
    results[gpu ? "gpu" : "cpu"] = await measureInTurn(launched, async (browser) => {
      const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
      try {
        const page = await context.newPage();
        await page.setContent("<!doctype html><title>frame ops</title><body></body>");
        return await page.evaluate(measureOps, { rounds, gpu });
      } finally {
        await context.close();
      }
    });
  }
} finally {
  await launched.close();
}
console.log(JSON.stringify(results, null, 2));
writeFileSync(
  join(resultsDir, `frames-ops-${browserName}.json`),
  `${JSON.stringify(results, (_key, value) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value), 2)}\n`,
);
