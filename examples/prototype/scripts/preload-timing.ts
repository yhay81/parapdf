/**
 * Whether a `fetch()` takes the response of a `<link rel="preload" as="fetch">`
 * still downloading (issue #14), without ParaPDF or pdf.js: a page preloads a
 * file its server sends in ten chunks over a second, and fetches it after a
 * delay, with the options pdf.js's fetch stream uses. The server counts the
 * requests for the file; a fresh URL each job keeps the HTTP cache out of it,
 * since Safari's windows, which the WebDriver harness opens for contexts,
 * share one.
 *
 * Usage: node scripts/preload-timing.ts
 * Environment: BROWSER (chromium, webkit, firefox, or safari).
 */
import { createServer } from "node:http";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const delays = [0, 50, 300, 700, 1500];
const body = Buffer.alloc(300_000, 65);
let requests = 0;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  // The demo is cross-origin isolated, and so is this page.
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (url.pathname === "/file.bin") {
    requests++;
    response.setHeader("Cache-Control", "max-age=3600");
    response.setHeader("Content-Length", body.length);
    response.flushHeaders();
    let chunk = 0;
    const timer = setInterval(() => {
      response.write(body.subarray(chunk * 30_000, (chunk + 1) * 30_000));
      if (++chunk === 10) {
        clearInterval(timer);
        response.end();
      }
    }, 100);
    return;
  }
  const file = `/file.bin?job=${url.searchParams.get("job")}`;
  const options = `{ method: "GET", headers: new Headers(), signal: new AbortController().signal, mode: "cors", credentials: "same-origin", redirect: "follow" }`;
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html>
<link rel="preload" as="fetch" crossorigin="anonymous" href="${file}">
<script>
setTimeout(() => fetch("${file}", ${options})
  .then((response) => response.arrayBuffer())
  .then((bytes) => { document.title = "done " + bytes.byteLength; }), ${url.searchParams.get("delay")});
</script>`);
});
await new Promise<void>((resolve) => server.listen(4188, "127.0.0.1", resolve));
const launched = await launchBrowser();
console.log(launched.label);

try {
  for (const delay of delays) {
    const page = await (await launched.browser.newContext()).newPage();
    requests = 0;
    await page.goto(`http://127.0.0.1:4188/?delay=${delay}&job=${Math.random()}`);
    await page.waitForFunction(() => document.title.startsWith("done"), undefined, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    console.log(`fetch after ${String(delay).padStart(4)} ms: ${requests} request(s)`);
    await page.context().close();
  }
} finally {
  await launched.close();
  server.close();
}
