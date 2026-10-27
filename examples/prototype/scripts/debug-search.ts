// Temporary: why search never finishes in Linux WebKit (CI only).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4186, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4186/";
const launched = await launchBrowser();
console.log(launched.label);
const page = await launched.browser.newPage();
page.on("console", (m) => console.log(`console.${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => console.log(`pageerror: ${e.message}\n${e.stack}`));
await page.goto(`${baseUrl}?engine=pdfjs&file=synthetic-features.pdf&forms=1`);
await page.waitForFunction(() => (window as any).__viewer?.hasPixels(0), undefined, { timeout: 30000 });
console.log("painted");
const t0 = Date.now();
const r = await page.evaluate(async () => {
  const w = window as any;
  const s = w.__session;
  const out: string[] = [];
  out.push(`pageCount ${s?.pageCount} keys ${Object.keys(w).filter((k) => k.startsWith("__")).join(",")}`);
  try {
    const t = await Promise.race([
      s.text(0).then((x: unknown) => `text ok ${JSON.stringify(x).slice(0, 120)}`),
      new Promise((r) => setTimeout(() => r("text timeout"), 10000)),
    ]);
    out.push(String(t));
  } catch (e) {
    out.push(`text error ${e}`);
  }
  return out;
});
console.log(r, Date.now() - t0);
await page.evaluate(() => (window as any).__search?.search("rose"));
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  console.log(JSON.stringify(await page.evaluate(() => {
    const st = (window as any).__search?.store.get();
    return { status: st?.status, pagesSearched: st?.pagesSearched, matches: st?.matches?.length };
  })));
}
await launched.browser.close();
await server.close();
