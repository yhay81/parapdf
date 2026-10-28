/**
 * Counts how often the browser downloads the PDF a `PdfDocument` preloads
 * (issue #14), on the server, so that it needs none of Playwright's network
 * events and runs in Safari too: React preloads the PDF as `fetch`, and pdf.js
 * should take that response instead of downloading the file again.
 *
 * Each job opens the demo in a fresh context, waits for the first page's
 * pixels, and then reloads it (a warm load), once with the preview server's
 * `Cache-Control: no-cache` and once with `max-age=3600` on the PDF. It
 * prints the requests for the PDF the server answered, with their status
 * and the bytes sent, and the time to the first page's pixels.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node scripts/preload-reuse.ts
 * Environment: BROWSER (chromium, webkit, firefox, or safari), ENGINE
 * (pdfjs-next), DIST, FILE (bill-hr815.pdf), RATE (the bytes per second
 * the responses of the PDF share; unlimited by default).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { type Connect, preview } from "vite";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs-next";
const file = process.env.FILE ?? "bill-hr815.pdf";

interface Served {
  method: string;
  status: number;
  bytes: number;
  range: string | null;
}

const rate = Number(process.env.RATE ?? 0);
/** The responses still sending, which share the rate. */
const sending = new Set<(share: number) => void>();
if (rate)
  setInterval(() => {
    for (const drain of sending) drain(Math.floor(rate / 10 / sending.size));
  }, 100).unref();
let cache = "no-cache";
const served: Served[] = [];
const count: Connect.NextHandleFunction = (request, response, next) => {
  if (!request.url?.split("?")[0]?.endsWith(`/${file}`)) return next();
  const entry: Served = {
    method: request.method ?? "",
    status: 0,
    bytes: 0,
    range: request.headers.range ?? null,
  };
  served.push(entry);
  const write = response.write.bind(response);
  const end = response.end.bind(response);
  // With RATE, the responses share that many bytes a second, sent a tenth
  // each 100 ms, as downloads share a network.
  const queue: Buffer[] = [];
  let ending = false;
  const drain = (share: number) => {
    let budget = share;
    while (budget > 0 && queue.length > 0) {
      const chunk = queue[0] as Buffer;
      const part = chunk.subarray(0, budget);
      if (part.length === chunk.length) queue.shift();
      else queue[0] = chunk.subarray(part.length);
      budget -= part.length;
      if (!response.destroyed) write(part);
    }
    if (ending && queue.length === 0) {
      sending.delete(drain);
      end();
    }
  };
  const add = (chunk: unknown) => {
    if (!chunk || typeof chunk === "function") return;
    const bytes = Buffer.from(chunk as Buffer);
    entry.bytes += bytes.length;
    if (rate) queue.push(bytes);
    else write(bytes);
  };
  if (rate) sending.add(drain);
  response.write = ((chunk: unknown) => {
    add(chunk);
    return true;
  }) as typeof response.write;
  response.end = ((chunk: unknown) => {
    add(chunk);
    entry.status = response.statusCode;
    if (!rate) return end();
    ending = true;
    return response;
  }) as typeof response.end;
  response.on("close", () => sending.delete(drain));
  // Sirv, which serves the preview, sets its own Cache-Control first.
  const setHeader = response.setHeader.bind(response);
  response.setHeader = ((name: string, value: string) =>
    setHeader(name, name.toLowerCase() === "cache-control" ? cache : value)) as never;
  next();
};

const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { port: 4185, host: "127.0.0.1", strictPort: false, open: false },
  plugins: [
    { name: "count-pdf", configurePreviewServer: (preview) => void preview.middlewares.use(count) },
  ],
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4185/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}, ${file}${rate ? `, ${rate} B/s` : ""}`);

async function job(browser: Browser, header: string): Promise<void> {
  cache = header;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const url = `${baseUrl}?engine=${engine}&file=${file}`;
  for (const load of ["cold", "warm"]) {
    served.length = 0;
    const start = Date.now();
    if (load === "cold") await page.goto(url);
    else await page.reload();
    await page.waitForFunction(
      () => (window as { __viewer?: { hasPixels(index: number): boolean } }).__viewer?.hasPixels(0),
      undefined,
      { timeout: 60_000 },
    );
    const painted = Date.now() - start;
    // Lets pdf.js finish the requests it started for the rest of the file.
    await page.waitForTimeout(1500);
    const lines = served.map(
      ({ method, status, bytes, range }) =>
        `${method} ${status} ${bytes} B${range ? ` (${range})` : ""}`,
    );
    console.log(
      `${header.padEnd(13)} ${load}: ${served.length} request(s), first page in ${painted} ms — ${lines.join("; ")}`,
    );
  }
  await context.close();
}

try {
  await job(launched.browser, "no-cache");
  await job(launched.browser, "max-age=3600");
} finally {
  await launched.close();
  await server.close();
}
