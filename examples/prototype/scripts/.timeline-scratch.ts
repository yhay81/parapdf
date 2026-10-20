// Scratch: dumps the hybrid engine's event timeline for one cold load (not committed).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4185, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4185/";
const launched = await launchBrowser();
const file = process.env.FILE ?? "wdl6812-manuscript.pdf";
for (const mode of (process.env.MODES ?? "separate,base-first,once").split(",")) {
  const context = await launched.browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}?engine=hybrid&hwa=1&file=${file}&detail=${mode}&autoscroll=900&duration=1000`,
  );
  await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 60_000,
  });
  const data = await page.evaluate(() => {
    const records = (
      window as unknown as {
        __benchRecords: {
          renders: { pageIndex: number; scale: number; start: number; end: number }[];
          hybrid: Record<string, unknown>[];
        };
      }
    ).__benchRecords;
    const result = (window as { __result?: { firstPaintMs?: number; page1?: unknown } }).__result;
    return {
      renders: records.renders,
      hybrid: records.hybrid,
      firstPaint: result?.firstPaintMs,
      page1: result?.page1,
    };
  });
  console.log(
    `\n== ${file} detail=${mode}: first paint ${data.firstPaint?.toFixed(0)} page1 ${JSON.stringify(data.page1)}`,
  );
  const lines: [number, string][] = [];
  for (const r of data.renders)
    lines.push([
      r.start,
      `request p${r.pageIndex + 1} scale ${r.scale.toFixed(2)} → done at ${r.end.toFixed(0)} (${(r.end - r.start).toFixed(0)} ms)`,
    ]);
  for (const e of data.hybrid) {
    const { type, at, ...rest } = e as { type: string; at: number };
    if (type === "classified") continue;
    lines.push([
      at,
      `${type} ${JSON.stringify(rest, (_k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v))}`,
    ]);
  }
  lines.sort((a, b) => a[0] - b[0]);
  for (const [at, text] of lines)
    if (at < (data.firstPaint ?? 0) + 400) console.log(`${at.toFixed(0).padStart(6)} ${text}`);
  await context.close();
}
await launched.close();
await server.close();
