/**
 * Minimal reproduction, for an upstream pdf.js issue, of the cost of knockout
 * transparency groups: page 1 of bill-hr815.pdf has a signature widget whose
 * appearance is a non-isolated knockout group of 42 fills, and for each fill
 * pdf.js's `#beginKnockoutElement` and `#compositeKnockoutSurface` clear and
 * draw canvases as large as the whole group, including a copy of the group's
 * backdrop out of the canvas being rendered.
 *
 * knockout-repro.html renders the page with pdf.js's display API only
 * (`getDocument` and `PDFPageProxy.render`) and times every `drawImage` call.
 * This script serves it with cross-origin isolation (precise timers) and runs
 * it for released pdfjs-dist and, once bench/scripts/build-pdfjs-next.sh has
 * built it, pdf.js master on the main thread and in its renderer worker, with
 * and without `enableHWA`, on canvases of several sizes. Each job opens the
 * document in a fresh browser context, renders once to warm up, and then
 * RUNS times. In Chromium, main-thread task time per render comes from the
 * DevTools protocol's Performance.getMetrics.
 *
 * Usage: node bench/scripts/knockout-repro.ts
 * Environment: BROWSER (chromium, webkit, or firefox), BUILDS
 * (pdfjs-dist,master,master-worker), HWA (1,0), VIEWS
 * (detail,detail-small,page-4,page-2), ANNOTATIONS (1,0), PROBE (1 to time
 * reading one pixel of the canvas right after each render), RUNS (5), FILE
 * (bill-hr815.pdf), PAGE (1), PDFJS_DIST (a pdfjs-dist package directory to
 * measure instead of bench's dependency, such as a patched copy), OUTPUT (JSON
 * path; default bench/results/raw/knockout-<browser>.json), and SERVE=1 to only
 * serve the page and print its URLs, for browsers outside Playwright.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession } from "playwright";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTakingSummary,
} from "./browsers.ts";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const masterDir = join(benchDir, "vendor/pdf.js/build/generic");
const hasMaster = existsSync(join(masterDir, "build/pdf.renderer.mjs"));

const list = (name: string, fallback: string) =>
  (process.env[name] ?? fallback).split(",").filter(Boolean);

interface Build {
  lib: string;
  renderer?: string;
  /** Directory of cmaps/, standard_fonts/, wasm/, and iccs/. */
  assets: string;
}
const allBuilds: Record<string, Build> = {
  "pdfjs-dist": { lib: "/pdfjs-dist/build/pdf.mjs", assets: "/pdfjs-dist/" },
  master: { lib: "/master/build/pdf.mjs", assets: "/master/web/" },
  "master-worker": {
    lib: "/master/build/pdf.mjs",
    renderer: "/master/build/pdf.renderer.mjs",
    assets: "/master/web/",
  },
};

interface View {
  description: string;
  /** Device pixels per PDF point. */
  scale: number;
  /** x, y, width, height in device pixels; the whole page when absent. */
  region?: [number, number, number, number];
}
// The page is 720×1080 pt; the signature widget lies at 160–920 × 184–464
// device pixels at 8 pixels per point, inside both regions.
const allViews: Record<string, View> = {
  detail: {
    description: "5000×3360 region at 8 px/pt",
    scale: 8,
    region: [0, 0, 5000, 3360],
  },
  "detail-small": {
    description: "1000×600 region at 8 px/pt",
    scale: 8,
    region: [0, 0, 1000, 600],
  },
  "page-4": { description: "whole page at 4 px/pt (2880×4320)", scale: 4 },
  "page-2": { description: "whole page at 2 px/pt (1440×2160)", scale: 2 },
};

const pick = <T>(all: Record<string, T>, names: string[], kind: string) =>
  names.map((name) => {
    const value = all[name];
    if (!value) throw new Error(`Unknown ${kind} "${name}"; use ${Object.keys(all).join(", ")}`);
    return [name, value] as const;
  });
const builds = pick(
  allBuilds,
  list("BUILDS", hasMaster ? "pdfjs-dist,master,master-worker" : "pdfjs-dist"),
  "build",
);
if (!hasMaster && builds.some(([name]) => name.startsWith("master"))) {
  throw new Error("pdf.js master is not built; run bench/scripts/build-pdfjs-next.sh");
}
const views = pick(allViews, list("VIEWS", "detail,detail-small,page-4,page-2"), "view");
const hwaModes = list("HWA", "1,0").map((mode) => mode === "1");
const annotationModes = list("ANNOTATIONS", "1,0").map((mode) => mode === "1");
const probe = process.env.PROBE === "1";
const runs = Number(process.env.RUNS ?? "5");
const file = process.env.FILE ?? "bill-hr815.pdf";
const pageNumber = Number(process.env.PAGE ?? "1");
const browserName = browserFromEnv();
const output = process.env.OUTPUT ?? join(benchDir, "results/raw", `knockout-${browserName}.json`);

// Static files with cross-origin isolation, which gives every browser precise
// timers; WebKit refuses some ports, so the server takes one the system picks.
const pdfjsDist = process.env.PDFJS_DIST ?? join(benchDir, "node_modules/pdfjs-dist");
const roots: Record<string, string> = {
  "/pdfjs-dist/": pdfjsDist,
  "/master/": masterDir,
  "/pdf/": join(benchDir, "corpus"),
};
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  let source: string | undefined;
  if (path === "/") source = join(benchDir, "scripts/knockout-repro.html");
  else if (path === "/blank") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" }).end("<!doctype html>");
    return;
  } else {
    const root = Object.keys(roots).find((prefix) => path.startsWith(prefix));
    const relative = root ? normalize(path.slice(root.length)) : "";
    if (root && !relative.startsWith("..")) source = join(roots[root] ?? "", relative);
  }
  try {
    if (!source || !(await stat(source)).isFile()) throw new Error("not found");
    const body = await readFile(source);
    const type = types[extname(source)] ?? "application/octet-stream";
    response.writeHead(200, { ...headers, "Content-Type": type }).end(body);
  } catch {
    response.writeHead(404, headers).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

interface CallSummary {
  drawImageCalls: number;
  drawImageMs: number;
  backdropCalls: number;
  backdropMs: number;
  backdropFirstMs: number | null;
  backdropRestMedianMs: number | null;
  backdropCopy: [number, number] | null;
  backdropCallMs: number[];
  bySize: { key: string; calls: number; ms: number; maxMs: number }[];
}
interface RenderResult {
  /** Until the render task's promise resolves. */
  renderMs: number;
  /** Until two animation frames later. */
  settledMs: number;
  /** With PROBE=1: reading one pixel of the canvas right after the render. */
  probeMs: number | null;
  workerRendering: boolean;
  main: CallSummary;
  worker?: CallSummary;
  /** Main-thread task and script time from Chromium's DevTools protocol. */
  taskMs?: number;
  scriptMs?: number;
}
interface Repro {
  environment: Record<string, unknown>;
  render(): Promise<RenderResult>;
}

async function chromiumMetrics(session: CDPSession): Promise<{ task: number; script: number }> {
  const { metrics } = (await session.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  const value = (name: string) =>
    (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
  return { task: value("TaskDuration"), script: value("ScriptDuration") };
}

interface Job {
  build: string;
  hwa: boolean;
  view: string;
  annotations: boolean;
}

function jobUrl(job: Job): string {
  const build = allBuilds[job.build] as Build;
  const view = allViews[job.view] as View;
  const query = new URLSearchParams({
    lib: build.lib,
    assets: build.assets,
    file: `/pdf/${file}`,
    page: String(pageNumber),
    hwa: job.hwa ? "1" : "0",
    scale: String(view.scale),
    annotations: job.annotations ? "1" : "0",
  });
  if (build.renderer) query.set("renderer", build.renderer);
  if (probe) query.set("probe", "1");
  if (view.region) query.set("region", view.region.join(","));
  return `${baseUrl}?${query}`;
}

async function runJob(browser: Browser, job: Job) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
    });
    await restoreScaleFactor(page, `${baseUrl}blank`);
    await page.goto(jobUrl(job));
    await page.waitForFunction(() => "repro" in window, undefined, { timeout: 60_000 });
    const environment = await page.evaluate(
      () => (window as unknown as { repro: Repro }).repro.environment,
    );
    const session = browserName === "chromium" ? await context.newCDPSession(page) : null;
    await session?.send("Performance.enable");
    const render = () =>
      page.evaluate(() => (window as unknown as { repro: Repro }).repro.render());
    await render();
    const results: RenderResult[] = [];
    for (let run = 0; run < runs; run++) {
      const before = session ? await chromiumMetrics(session) : null;
      const result = await render();
      if (session && before) {
        const after = await chromiumMetrics(session);
        result.taskMs = after.task - before.task;
        result.scriptMs = after.script - before.script;
      }
      results.push(result);
    }
    return { ...job, environment, errors: [...new Set(errors)], results };
  } finally {
    await context.close();
  }
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const jobList = builds.flatMap(([build]) =>
  hwaModes.flatMap((hwa) =>
    views.flatMap(([view]) =>
      annotationModes.map((annotations) => ({ build, hwa, view, annotations })),
    ),
  ),
);
if (process.env.SERVE) {
  // For browsers outside Playwright: opened by hand, the page renders and prints its results.
  for (const job of jobList) {
    console.log(
      `${job.build}, enableHWA ${job.hwa}, ${job.view}, annotations ${job.annotations ? "on" : "off"}:\n  ${jobUrl(job)}`,
    );
  }
  console.log("\nServing until interrupted.");
  await new Promise<never>(() => {});
}

const power = assertMeasurementPower();
const launched = await launchBrowser(browserName);
const jobs: Awaited<ReturnType<typeof runJob>>[] = [];
const loads: number[] = [];
try {
  for (const job of jobList) {
    const result = await measureInTurn(launched, (browser) => {
      loads.push(loadavg()[0] ?? Number.NaN);
      return runJob(browser, job);
    });
    jobs.push(result);
    const busy = (run: RenderResult) => run.worker ?? run.main;
    console.log(
      `${job.build} · HWA ${job.hwa ? "on" : "off"} · ${job.view} · annotations ${job.annotations ? "on" : "off"}: render ${median(result.results.map((run) => run.renderMs)).toFixed(1)} ms, drawImage ${median(result.results.map((run) => busy(run).drawImageMs)).toFixed(1)} ms, first backdrop copy ${median(result.results.map((run) => busy(run).backdropFirstMs ?? Number.NaN)).toFixed(1)} ms${result.errors.length ? ` (${result.errors.length} console messages)` : ""}`,
    );
  }
} finally {
  await launched.close();
  server.close();
}

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: launched.label,
  headless: launched.headless,
  power,
  loadAverage: { min: Math.min(...loads), max: Math.max(...loads) },
  turnTaking: turnTakingSummary(),
  gpu: jobs[0]?.environment.gpu,
  crossOriginIsolated: jobs[0]?.environment.crossOriginIsolated,
  file,
  page: pageNumber,
  runs,
  pdfjsDist,
};
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify({ environment, jobs }, null, 1)}\n`);

const ms = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : "–");
const medianOf = (values: (number | null | undefined)[]) =>
  median(values.map((value) => value ?? Number.NaN));
const lines = [
  `${launched.label}${launched.headless ? " (headless)" : ""}, ${environment.os}, ${environment.cpu}, GPU ${environment.gpu}; ${file} page ${pageNumber}; median of ${runs} renders after a warm-up; load average ${environment.loadAverage.min.toFixed(1)}–${environment.loadAverage.max.toFixed(1)}; ${environment.turnTaking}.`,
  "",
  "Render: until the render task's promise resolves; settled: two animation frames later. Main-thread tasks: Chromium's TaskDuration over the settled time. drawImage and backdrop copies: on the main thread, or in the renderer worker when the page is drawn there. The other copies are the median of the remaining calls.",
  "",
  `| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |${probe ? " Read after render (ms) |" : ""}`,
  `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |${probe ? " --- |" : ""}`,
];
for (const job of jobs) {
  const runsOf = job.results;
  const inWorker = runsOf.every((run) => run.worker);
  const busy = (run: RenderResult) => (inWorker ? run.worker : run.main) as CallSummary;
  const version = `${job.environment.pdfjs ?? job.build}${job.build === "pdfjs-dist" && process.env.PDFJS_DIST ? `, ${basename(process.env.PDFJS_DIST)}` : ""}`;
  const copy = runsOf[0] ? busy(runsOf[0]).backdropCopy : null;
  const rest = medianOf(runsOf.map((run) => busy(run).backdropRestMedianMs));
  lines.push(
    `| ${version} | ${job.hwa ? "true" : "false"} | ${allViews[job.view]?.description} | ${job.annotations ? "on" : "off"} | ${ms(medianOf(runsOf.map((run) => run.renderMs)))} | ${ms(medianOf(runsOf.map((run) => run.settledMs)))} | ${ms(medianOf(runsOf.map((run) => run.taskMs)))} | ${inWorker ? "renderer worker" : "main thread"} | ${medianOf(runsOf.map((run) => busy(run).drawImageCalls))} | ${ms(medianOf(runsOf.map((run) => busy(run).drawImageMs)))} | ${medianOf(runsOf.map((run) => busy(run).backdropCalls))} | ${ms(medianOf(runsOf.map((run) => busy(run).backdropFirstMs)))} | ${Number.isFinite(rest) ? rest.toFixed(3) : "–"} | ${copy ? copy.join("×") : "–"} |${probe ? ` ${ms(medianOf(runsOf.map((run) => run.probeMs)))} |` : ""}`,
  );
}
const messages = jobs.filter((job) => job.errors.length);
if (messages.length) {
  lines.push("", "Console messages:");
  for (const job of messages) {
    lines.push(`- ${job.build}, HWA ${job.hwa}, ${job.view}: ${job.errors.join(" / ")}`);
  }
}
console.log(`\n${lines.join("\n")}\n\nWrote ${output}`);
