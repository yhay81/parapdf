/**
 * Attributes the main thread's long tasks while the engine benchmark renders
 * a document (issue #17): runs one benchmark job per engine and file in
 * Chromium with a performance trace, and lists, for the renderer's main
 * thread, the tasks longer than a threshold and the trace events that took
 * their time (self time, children excluded).
 *
 * Usage: pnpm bench:build && node bench/scripts/trace-main-thread.ts
 * Environment: ENGINES (pdfjs-hwa,pdfjs-next-hwa), FILES
 * (patent-us223898.pdf,bunka-kokugo-series-019-p4.pdf), PAGES (10), SCALE
 * (2.6667), LONG (ms; 8), TOP (event names listed per job; 8), RUNS (1),
 * OUTPUT (directory for the raw traces; bench/results/raw/traces).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launchBrowser } from "./browsers.ts";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const list = (name: string, fallback: string) => (process.env[name] ?? fallback).split(",");
const engines = list("ENGINES", "pdfjs-hwa,pdfjs-next-hwa");
const files = list("FILES", "patent-us223898.pdf,bunka-kokugo-series-019-p4.pdf");
const pages = process.env.PAGES ?? "10";
const scale = process.env.SCALE ?? "2.6667";
const long = Number(process.env.LONG ?? "8");
const top = Number(process.env.TOP ?? "8");
const runs = Number(process.env.RUNS ?? "1");
const output = process.env.OUTPUT ?? join(benchDir, "results/raw/traces");
mkdirSync(output, { recursive: true });

type TraceEvent = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string; data?: { url?: string; functionName?: string } };
};

const server = await preview({
  root: benchDir,
  configFile: join(benchDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4181, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4181/";
const launched = await launchBrowser("chromium");

/** Self time of complete events on one thread, children subtracted. */
function selfTimes(events: TraceEvent[]): Map<TraceEvent, number> {
  const sorted = events
    .filter((event) => event.ph === "X" && event.dur !== undefined)
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const self = new Map<TraceEvent, number>();
  const stack: TraceEvent[] = [];
  for (const event of sorted) {
    while (stack.length > 0) {
      const open = stack.at(-1) as TraceEvent;
      if (event.ts >= open.ts + (open.dur ?? 0)) stack.pop();
      else break;
    }
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? 0) - (event.dur ?? 0));
    self.set(event, (self.get(event) ?? 0) + (event.dur ?? 0));
    stack.push(event);
  }
  return self;
}

const label = (event: TraceEvent) => {
  const data = event.args?.data;
  if (event.name === "FunctionCall" && data) {
    const file = data.url?.split("/").at(-1) ?? "";
    return `FunctionCall ${data.functionName || "(anonymous)"} ${file}`.trim();
  }
  return event.name;
};

const lines: string[] = [];
try {
  for (const file of files) {
    for (const engine of engines) {
      for (let run = 0; run < runs; run++) {
        const context = await launched.browser.newContext({
          viewport: { width: 1280, height: 1000 },
        });
        const page = await context.newPage();
        const query = new URLSearchParams({ engine, file, scale, pages });
        // A warm-up job in the same context, as the benchmark's runner does
        // per browser, so that the HTTP cache and compiled code are warm.
        await page.goto(`${baseUrl}?${query}`);
        await page.waitForFunction(() => (window as { __done?: boolean }).__done === true);
        await launched.browser.startTracing(page, {
          categories: [
            "devtools.timeline",
            "disabled-by-default-devtools.timeline",
            "v8.execute",
            "blink",
            "cc",
            "gpu",
            "toplevel",
          ],
        });
        await page.goto(`${baseUrl}?${query}`);
        await page.waitForFunction(() => (window as { __done?: boolean }).__done === true);
        const buffer = await launched.browser.stopTracing();
        const result = (await page.evaluate(() => (window as { __result?: unknown }).__result)) as {
          lag?: { blockedMs: number; maxMs: number };
        };
        await context.close();
        const name = `${file}-${engine}-${run + 1}.json`;
        writeFileSync(join(output, name), buffer);

        const trace = JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] };
        const threads = trace.traceEvents.filter(
          (event) => event.ph === "M" && event.name === "thread_name",
        );
        // The page's main thread: the CrRendererMain whose process ran the
        // most work (the benchmark page, not an earlier navigation's).
        const mains = threads.filter((event) => event.args?.name === "CrRendererMain");
        const busiest = mains
          .map((main) => {
            const events = trace.traceEvents.filter(
              (event) => event.pid === main.pid && event.tid === main.tid,
            );
            const tasks = events.filter(
              (event) => event.ph === "X" && event.name === "RunTask" && event.dur !== undefined,
            );
            return { events, tasks, total: tasks.reduce((sum, task) => sum + (task.dur ?? 0), 0) };
          })
          .sort((a, b) => b.total - a.total)[0];
        if (!busiest) throw new Error(`${name}: no renderer main thread in the trace`);
        const longTasks = busiest.tasks.filter((task) => (task.dur ?? 0) >= long * 1000);
        const self = selfTimes(busiest.events);
        const byName = new Map<string, number>();
        for (const task of longTasks) {
          const end = task.ts + (task.dur ?? 0);
          for (const [event, time] of self) {
            if (event.ts >= task.ts && event.ts < end) {
              byName.set(label(event), (byName.get(label(event)) ?? 0) + time);
            }
          }
        }
        const ms = (us: number) => (us / 1000).toFixed(1);
        const longest = Math.max(0, ...longTasks.map((task) => task.dur ?? 0));
        lines.push(
          `${file} · ${engine} · run ${run + 1}: ${longTasks.length} tasks ≥ ${long} ms, ` +
            `${ms(longTasks.reduce((sum, task) => sum + (task.dur ?? 0), 0))} ms in all, longest ${ms(longest)} ms; ` +
            `the benchmark's blocked time ${result.lag?.blockedMs.toFixed(0)} ms, lag max ${result.lag?.maxMs.toFixed(1)} ms`,
        );
        for (const [event, time] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, top)) {
          lines.push(`  ${ms(time).padStart(7)} ms  ${event}`);
        }
        console.log(lines.slice(-1 - Math.min(top, byName.size)).join("\n"));
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}
console.log(`\n${launched.label}\n${lines.join("\n")}\n\nTraces in ${output}`);
