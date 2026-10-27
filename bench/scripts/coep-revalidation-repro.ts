/**
 * Reproduces issue #16: WebKit refuses pdf.js's cached module worker in the
 * cross-origin-isolated demo when the server answers its revalidation with a
 * 304 that lacks the isolation headers, as Vite's servers did before
 * `crossOriginIsolation()` (scripts/isolation.ts). Results:
 * examples/prototype/results/coep-revalidation.md.
 *
 * Serves a demo build (`pnpm --filter @parapdf/prototype build`) with its
 * own static server, opens the demo seven times in a row (reloads, other
 * files, new contexts, two viewers with annotation editing), and prints how
 * many worker refusals each visit logged and which worker requests the
 * server answered.
 *
 * Environment: BROWSER, ENGINE (pdfjs or pdfjs-next; pdfjs), DIST (the demo
 * build; examples/prototype/dist), HEADERS:
 * - `revalidate-bare` (default): COOP and COEP, `Cache-Control: no-cache`,
 *   and 304s without COOP and COEP, as Vite's preview server sent them.
 * - `revalidate`: the same with COOP and COEP on 304s too.
 * - `cached`: COOP and COEP, no Cache-Control (the browser reuses its copy).
 * - `plain-revalidate-bare`: `revalidate-bare` without isolation.
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browsers.ts";

const dist =
  process.env.DIST ?? fileURLToPath(new URL("../../examples/prototype/dist", import.meta.url));
const engine = process.env.ENGINE ?? "pdfjs";
const mode = process.env.HEADERS ?? "revalidate-bare";
const isolated = !mode.startsWith("plain");
const revalidate = mode !== "cached";
const bare304 = mode.endsWith("bare");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

const served: string[] = [];
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://host").pathname);
  const file = join(dist, path.endsWith("/") ? `${path}index.html` : path);
  try {
    const info = await stat(file);
    const headers: Record<string, string> = {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      ETag: `W/"${info.size}-${info.mtime.getTime()}"`,
    };
    if (isolated) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    if (revalidate) headers["Cache-Control"] = "no-cache";
    const worker = /worker/.test(path);
    if (request.headers["if-none-match"] === headers.ETag) {
      response.writeHead(304, bare304 ? { ETag: headers.ETag } : headers);
      response.end();
      if (worker) served.push(`304 ${path}`);
      return;
    }
    if (worker) served.push(`200 ${path}`);
    response.writeHead(200, headers);
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(4188, "127.0.0.1", resolve));
const base = "http://127.0.0.1:4188/";
const launched = await launchBrowser();
console.log(`${launched.label}, engine ${engine}, headers ${mode}`);

let refusals = 0;
let page = await launched.browser.newPage({ viewport: { width: 1280, height: 900 } });
const listen = () => {
  page.on("console", (message) => {
    if (/Cross-Origin-Embedder-Policy|due to access control checks/.test(message.text())) {
      refusals++;
    }
  });
};
listen();
const freshContext = async () => {
  await page.context().close();
  page = await launched.browser.newPage({ viewport: { width: 1280, height: 900 } });
  listen();
};
const demo = (query: string) => page.goto(`${base}?engine=${engine}&count=1&${query}`);
const visits: [string, () => Promise<unknown>][] = [
  ["first visit", () => demo("file=bill-hr815.pdf")],
  ["reload", () => page.reload()],
  ["another file", () => demo("file=f1040.pdf")],
  [
    "another page, then the demo",
    async () => {
      await page.goto(`${base}calibrate.html`);
      await demo("file=usrguide.pdf");
    },
  ],
  ["new context", () => freshContext().then(() => demo("file=bill-hr815.pdf"))],
  [
    "new context, two editing viewers",
    () => freshContext().then(() => demo("split=1&annotations=1&file=synthetic-text-1000.pdf")),
  ],
  ["reload, two editing viewers", () => page.reload()],
];
try {
  for (const [name, visit] of visits) {
    served.length = 0;
    const before = refusals;
    await visit();
    await page.waitForFunction(
      () => {
        type Shown = { store: { get(): { layout: unknown } }; sharpness(): number };
        const w = window as unknown as { __viewer?: Shown; __split?: { viewers: Shown[] } };
        const viewer = w.__split?.viewers[1] ?? w.__viewer;
        return viewer?.store.get().layout != null && viewer.sharpness() > 0.99;
      },
      undefined,
      { timeout: 60_000 },
    );
    const crossOriginIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(
      `${name}: crossOriginIsolated ${crossOriginIsolated}, refusals ${refusals - before}, worker requests [${served.join(", ")}]`,
    );
  }
} finally {
  await launched.close();
  server.close();
}
