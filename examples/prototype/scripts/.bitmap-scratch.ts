// Scratch (not committed): createImageBitmap(ImageData) cost in a worker per option set.
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const launched = await launchBrowser();
const context = await launched.browser.newContext();
const page = await context.newPage();
await page.setContent("<html><body>bitmap</body></html>");
const result = await page.evaluate(async () => {
  const code = `
    onmessage = async (event) => {
      const { width, height, runs } = event.data;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = i & 255; pixels[i + 1] = (i >> 8) & 255; pixels[i + 2] = 128; pixels[i + 3] = 255; }
      const data = new ImageData(pixels, width, height);
      const out = {};
      const sets = { default: undefined, premultiplyNone: { premultiplyAlpha: "none" }, colorNone: { colorSpaceConversion: "none" }, both: { premultiplyAlpha: "none", colorSpaceConversion: "none" } };
      for (const [name, options] of Object.entries(sets)) {
        const times = [];
        for (let r = 0; r < runs; r++) {
          const t = performance.now();
          const bitmap = await createImageBitmap(data, options);
          times.push(performance.now() - t);
          bitmap.close();
        }
        times.sort((a, b) => a - b);
        out[name] = times[times.length >> 1].toFixed(1);
      }
      // OffscreenCanvas path.
      const times = [];
      for (let r = 0; r < runs; r++) {
        const t = performance.now();
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d").putImageData(data, 0, 0);
        const bitmap = canvas.transferToImageBitmap();
        times.push(performance.now() - t);
        bitmap.close();
      }
      times.sort((a, b) => a - b);
      out.offscreenPut = times[times.length >> 1].toFixed(1);
      postMessage(out);
    };`;
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  const answer = new Promise((resolve) => (worker.onmessage = (event) => resolve(event.data)));
  worker.postMessage({ width: 2512, height: 3690, runs: 9 });
  return answer;
});
console.log(launched.label, JSON.stringify(result));
await launched.close();
