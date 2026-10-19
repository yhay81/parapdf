/**
 * Hybrid engine benchmark. Runs the scripted scroll of scroll-bench.ts with
 * pdf.js master and its renderer worker (`pdfjs-next-hwa`) and with the
 * hybrid engine in each of its ways to draw a hayro page's two canvas layers
 * (`hybrid-once-hwa`, `hybrid-basefirst-hwa`, and `hybrid-twice-hwa`, the
 * engine's earlier behavior; see `detailRender` in engine/hybrid.ts),
 * alternating their order run by run. Text documents (TEXT_FILES,
 * bill-hr815.pdf) run only with pdf.js and `hybrid-once-hwa`: every hybrid
 * variant leaves their pages to pdf.js. It records what the hybrid engine
 * changes: when page 1 got its first and its full-resolution pixels,
 * the main thread's longest stall from startup on, render times per canvas
 * layer and engine, hayro's time per pass in its worker, the full-resolution
 * bitmaps kept between a page's two layers, the classifier's cost, hayro's
 * load time, WebAssembly memory, and the payload in dist/.
 *
 * Usage: pnpm bench:build && pnpm --filter @parapdf/prototype build &&
 * pnpm --filter @parapdf/prototype bench:hybrid
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS, FILES, SPEEDS
 * (CSS px per second, 900,3600), RUNS (5), DURATION (ms, 4000), OUTPUT
 * (hybrid-<browser>), MAX_LOAD (half the logical cores). Before each job the
 * run waits while Playwright browsers started by other processes are open or
 * the 1-minute load average exceeds MAX_LOAD, and it repeats jobs another
 * Playwright browser overlapped; ALLOW_PARALLEL=1 skips both waits.
 * IGNORE_PIDS lists processes whose Playwright browsers do not count, such as
 * an idle runner stuck holding its browser; the report names them. Results are
 * saved after every job, and RESUME=1 continues an interrupted run with the
 * same settings instead of starting over. REPORT_ONLY=1 rewrites
 * results/hybrid.md from the stored hybrid-<browser>.json files and exits.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  browserFromEnv,
  browserNames,
  launchBrowser,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const distDir = join(exampleDir, "dist");

// `scansOnly` variants differ from `hybrid-once-hwa` only on hayro pages.
const variants: {
  name: string;
  engine: string;
  query?: Record<string, string>;
  scansOnly?: boolean;
}[] = [
  { name: "hybrid-twice-hwa", engine: "hybrid", query: { detail: "separate" }, scansOnly: true },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next" },
  {
    name: "hybrid-basefirst-hwa",
    engine: "hybrid",
    query: { detail: "base-first" },
    scansOnly: true,
  },
  { name: "hybrid-once-hwa", engine: "hybrid", query: { detail: "once" } },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
// synthetic-scan-40.pdf (pnpm --filter @parapdf/bench corpus) is the only scan
// long enough for the scroll to reach pages that were not rendered at startup.
const files = (
  process.env.FILES ??
  "bunka-kokugo-series-019-p4.pdf,patent-us223898.pdf,wdl6812-manuscript.pdf,synthetic-scan-40.pdf,bill-hr815.pdf"
).split(",");
const textFiles = new Set((process.env.TEXT_FILES ?? "bill-hr815.pdf").split(","));
const variantsFor = (file: string) =>
  variants.filter((variant) => !(variant.scansOnly && textFiles.has(file)));
const speeds = (process.env.SPEEDS ?? "900,3600").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "5");
const durationMs = Number(process.env.DURATION ?? "4000");
const browserName = browserFromEnv();
const output = process.env.OUTPUT ?? `hybrid-${browserName}`;
const maxLoad = Number(process.env.MAX_LOAD ?? String(cpus().length / 2));
if (process.env.REPORT_ONLY) {
  writeFileSync(join(resultsDir, "hybrid.md"), `${renderComparison()}\n`);
  console.log(`Wrote ${join(resultsDir, "hybrid.md")}`);
  process.exit(0);
}
const ignoredRoots = new Set(
  (process.env.IGNORE_PIDS ?? "").split(",").filter(Boolean).map(Number),
);

interface Lag {
  p95Ms: number;
  maxMs: number;
  blockedMs: number;
}

interface TimeSummary {
  count: number;
  p50Ms: number;
  maxMs: number;
}

/** hayro's time in the worker for one kind of pass: `base`, `detail`, or `once` (both layers). */
interface HayroPass {
  raster: TimeSummary;
  reduce: TimeSummary;
  bitmap: TimeSummary;
  fullBitmap?: TimeSummary;
}

interface JobResult {
  variant: string;
  file: string;
  speed: number;
  run: number;
  /** 1-minute load average when the job started. */
  load?: number;
  error?: string;
  idle?: { timerLagP50Ms: number; timerLagP95Ms: number; frameIntervalMs: number };
  firstPaintMs?: number | null;
  page1?: { baseAt: number | null; detailAt: number | null };
  startupLag?: Lag;
  lag?: Lag;
  frames?: { frames: number; dropped: number };
  blankMeanPct?: number;
  pagesCrossed?: number;
  renderTimes?: Record<string, TimeSummary>;
  hybrid?: {
    opened: {
      at: number;
      fetchMs: number;
      classifierWaitMs: number;
      parseMs: number;
      roundTripMs: number;
    } | null;
    pagesHayro: number;
    pagesBase: number;
    firstClassifiedAt: number | null;
    classifyWorker: TimeSummary;
    classifyRoundTrip: TimeSummary;
    rendererLoad: { at: number; loadMs: number; parseMs: number } | null;
    fallbacks: string[];
    classifierMiB: number | null;
    rendererMiB: number | null;
    hayroPasses?: Record<string, HayroPass>;
    kept?: { used: number; dropped: Record<string, number>; peakMiB: number };
  } | null;
}

const median = (values: (number | null | undefined)[]): number => {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The process table; a busy machine's full command lines exceed execFileSync's default buffer. */
const processTable = (columns: string) =>
  execFileSync("ps", ["-axo", columns], { encoding: "utf8", maxBuffer: 64 * 2 ** 20 });

/**
 * Playwright browsers and test runners that another process started. Browser
 * main processes are children of their driver, so ancestry tells ours apart;
 * WebKit's helper processes belong to launchd and are skipped.
 */
function foreignBrowsers(): string[] {
  const rows = processTable("pid=,ppid=,command=")
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const descendsFrom = (pid: number, roots: Set<number>) => {
    for (let at = pid, depth = 0; at > 1 && depth < 50; at = parent.get(at) ?? 0, depth++) {
      if (roots.has(at)) return true;
    }
    return false;
  };
  const ours = (pid: number) =>
    descendsFrom(pid, new Set([process.pid])) || descendsFrom(pid, ignoredRoots);
  const browserMain = (command = "") =>
    (/ms-playwright\/chromium/.test(command) && !command.includes("--type=")) ||
    (/ms-playwright\/firefox/.test(command) && !command.includes("-contentproc")) ||
    (/ms-playwright\/webkit/.test(command) && !command.includes("com.apple.WebKit."));
  const driver = (command = "") => /@playwright\/test|playwright(-core)?\/cli\.js/.test(command);
  return rows
    .filter((row) => (browserMain(row.command) || driver(row.command)) && !ours(row.pid))
    .map((row) => `${row.pid} ${row.command?.slice(0, 140)}`);
}

/** CPU seconds of the IGNORE_PIDS processes and their descendants. */
function ignoredProcesses(): { pid: number; cpuSeconds: number; command: string }[] {
  if (ignoredRoots.size === 0) return [];
  const rows = processTable("pid=,ppid=,time=,command=")
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, time = "0", command = ""]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      cpuSeconds: time.split(":").reduce((sum, part) => sum * 60 + Number(part), 0),
      command: command.slice(0, 100),
    }));
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const ignored = (pid: number) => {
    for (let at = pid, depth = 0; at > 1 && depth < 50; at = parent.get(at) ?? 0, depth++) {
      if (ignoredRoots.has(at)) return true;
    }
    return false;
  };
  return rows
    .filter((row) => ignored(row.pid))
    .map(({ pid, cpuSeconds, command }) => ({ pid, cpuSeconds, command }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until no other Playwright browser is open and the load average is at
 * most MAX_LOAD: other work on the machine moves every number here.
 */
async function waitForQuietMachine(): Promise<void> {
  if (process.env.ALLOW_PARALLEL) return;
  const start = Date.now();
  let reported = "";
  for (;;) {
    const foreign = foreignBrowsers();
    const [load = 0] = loadavg();
    if (foreign.length === 0 && load <= maxLoad) return;
    const reason = foreign.length
      ? `other Playwright browsers are open:\n  ${foreign.join("\n  ")}`
      : `the load average is ${load.toFixed(1)}, above ${maxLoad}`;
    if (Date.now() - start > 2 * 60 * 60_000) throw new Error(`gave up after two hours: ${reason}`);
    // Report each reason once, then once a minute while it lasts.
    const minute = Math.floor((Date.now() - start) / 60_000);
    if (`${reason.split(":")[0]}${minute}` !== reported) {
      reported = `${reason.split(":")[0]}${minute}`;
      console.log(`Waiting: ${reason}`);
    }
    await sleep(15_000);
  }
}

/** Brotli sizes of the hybrid engine's assets in dist/, split by when they load. */
function measurePayload() {
  const assets = join(distDir, "assets");
  const names = existsSync(assets) ? readdirSync(assets) : [];
  // Both pdf.js builds emit a pdf-<hash>.js chunk; only master's has a renderer worker.
  const size = (pattern: RegExp, containing?: string) =>
    names
      .filter((name) => pattern.test(name))
      .filter(
        (name) => !containing || readFileSync(join(assets, name), "utf8").includes(containing),
      )
      .map((name) => {
        const bytes = readFileSync(join(assets, name));
        const brotli = brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length;
        return { name, raw: bytes.length, brotli };
      });
  return {
    withEveryDocument: [
      ...size(/^hybrid\.worker-.*\.js$/),
      ...size(/^hayro_classify_bg-.*\.wasm$/),
    ],
    withFirstScan: [
      ...size(/^hayro_wasm_bench-.*\.js$/),
      ...size(/^hayro_wasm_bench_bg-.*\.wasm$/),
    ],
    pdfjsNext: [
      ...size(/^pdf-.*\.js$/, "Renderer worker"),
      ...size(/^pdf\.worker-.*\.mjs$/),
      ...size(/^pdf\.renderer-.*\.mjs$/),
    ],
  };
}

assertMeasurementPower();
await waitForQuietMachine();
const power = assertMeasurementPower();
const ignoredBefore = ignoredProcesses();
if (ignoredBefore.length) {
  console.log(
    `Not waiting for these processes (IGNORE_PIDS):\n  ${ignoredBefore.map((row) => `${row.pid} ${row.command}`).join("\n  ")}`,
  );
}
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4182, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4182/";
const launched = await launchBrowser(browserName, { deviceScaleFactor: 2 });
const { browser } = launched;

const waitForDone = (page: Page) =>
  page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 120_000,
  });

async function runJob(
  variant: (typeof variants)[number],
  file: string,
  speed: number,
  run: number,
): Promise<JobResult> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const job = { variant: variant.name, file, speed, run, load: loadavg()[0] };
  try {
    // The idle baseline comes from a page without the viewer, in the same
    // context, right before the job.
    await page.goto(`${baseUrl}calibrate.html`);
    await waitForDone(page);
    const idle = (await page.evaluate(
      () => (window as { __result?: unknown }).__result,
    )) as JobResult["idle"] & {};
    const query = new URLSearchParams({
      ...variant.query,
      engine: variant.engine,
      hwa: "1",
      file,
      autoscroll: String(speed),
      duration: String(durationMs),
      idleLag: String(idle.timerLagP95Ms),
      idleFrame: String(idle.frameIntervalMs),
    });
    await page.goto(`${baseUrl}?${query}`);
    await waitForDone(page);
    const payload = (await page.evaluate(
      () => (window as { __result?: unknown }).__result,
    )) as Omit<JobResult, "variant" | "run">;
    const result: JobResult = { ...payload, ...job, idle };
    const ratio = (payload as { devicePixelRatio?: number }).devicePixelRatio;
    if (ratio !== 2) result.error = `devicePixelRatio ${ratio}, expected 2`;
    return result;
  } catch (error) {
    return { ...job, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close();
  }
}

// Saved after every job so an interrupted run can continue (RESUME=1).
const partialPath = join(resultsDir, "raw", `${output}-partial.json`);
const settingsKey = JSON.stringify({
  variants,
  files,
  textFiles: [...textFiles],
  speeds,
  runs,
  durationMs,
});
const resumed: JobResult[] = [];
if (process.env.RESUME && existsSync(partialPath)) {
  const saved = JSON.parse(readFileSync(partialPath, "utf8")) as {
    settingsKey: string;
    results: JobResult[];
  };
  if (saved.settingsKey !== settingsKey) throw new Error(`${partialPath} has other settings`);
  resumed.push(...saved.results.filter((result) => !result.error));
  console.log(`Resuming with ${resumed.length} finished jobs from ${partialPath}`);
}
const results: JobResult[] = [...resumed];
const finished = (variant: string, file: string, speed: number, run: number) =>
  results.some(
    (result) =>
      result.variant === variant &&
      result.file === file &&
      result.speed === speed &&
      result.run === run &&
      !result.error,
  );
mkdirSync(join(resultsDir, "raw"), { recursive: true });
try {
  // Discarded jobs warm the GPU process and the server for each variant.
  for (const variant of variants) await runJob(variant, files[0] ?? "", speeds[0] ?? 900, -1);
  for (const file of files) {
    for (const speed of speeds) {
      for (let run = 0; run < runs; run++) {
        // Alternate the order so drift affects every variant alike.
        const ordered = run % 2 ? [...variantsFor(file)].reverse() : variantsFor(file);
        for (const variant of ordered) {
          if (finished(variant.name, file, speed, run)) continue;
          let result: JobResult | undefined;
          for (let attempt = 0; attempt < 10 && !result; attempt++) {
            await waitForQuietMachine();
            // Stop without writing results if the machine lost AC power mid-run.
            assertMeasurementPower();
            const candidate = await runJob(variant, file, speed, run);
            if (process.env.ALLOW_PARALLEL || foreignBrowsers().length === 0) result = candidate;
            else console.log("Another Playwright browser started during the job; repeating it.");
          }
          if (!result) throw new Error("other Playwright browsers kept overlapping the jobs");
          results.push(result);
          writeFileSync(partialPath, JSON.stringify({ settingsKey, results }));
          const hybrid = result.hybrid;
          console.log(
            `${file} · ${speed} px/s · ${variant.name} · run ${run + 1}/${runs}: ${
              result.error
                ? `ERROR ${result.error.split("\n")[0]}`
                : `first paint ${result.firstPaintMs?.toFixed(0)} ms, page 1 detail ${result.page1?.detailAt?.toFixed(0)} ms, startup stall ${result.startupLag?.maxMs.toFixed(0)} ms, scroll stall ${result.lag?.maxMs.toFixed(0)} ms${
                    hybrid
                      ? `, hayro pages ${hybrid.pagesHayro}/${hybrid.pagesHayro + hybrid.pagesBase}`
                      : ""
                  }`
            }`,
          );
        }
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}

const ok = results.filter((result) => !result.error);
const baseRenders = (result: JobResult) =>
  result.renderTimes?.["base hayro"] ?? result.renderTimes?.["base pdfjs"];
const pick = (subset: JobResult[], read: (result: JobResult) => number | null | undefined) =>
  median(subset.map(read));
const renderKeys = [...new Set(ok.flatMap((result) => Object.keys(result.renderTimes ?? {})))];

// Startup does not depend on the scroll speed, so it pools every job of a variant.
const startup = files.flatMap((file) =>
  variantsFor(file).map((variant) => {
    const jobs = ok.filter((result) => result.file === file && result.variant === variant.name);
    const hybrid = (read: (h: NonNullable<JobResult["hybrid"]>) => number | null | undefined) =>
      pick(jobs, (result) => (result.hybrid ? read(result.hybrid) : undefined));
    return {
      file,
      variant: variant.name,
      jobs: jobs.length,
      firstPaintMs: pick(jobs, (result) => result.firstPaintMs),
      page1DetailMs: pick(jobs, (result) => result.page1?.detailAt),
      startupStallMs: pick(jobs, (result) => result.startupLag?.maxMs),
      startupBlockedMs: pick(jobs, (result) => result.startupLag?.blockedMs),
      renders: Object.fromEntries(
        renderKeys.map((key) => [
          key,
          {
            p50Ms: pick(jobs, (result) => result.renderTimes?.[key]?.p50Ms),
            count: pick(jobs, (result) => result.renderTimes?.[key]?.count),
          },
        ]),
      ),
      hybrid: jobs.some((result) => result.hybrid)
        ? {
            classifierReadyAt: hybrid((h) => h.opened?.at),
            fetchMs: hybrid((h) => h.opened?.fetchMs),
            classifierWaitMs: hybrid((h) => h.opened?.classifierWaitMs),
            parseMs: hybrid((h) => h.opened?.parseMs),
            classifyWorkerP50Ms: hybrid((h) => h.classifyWorker.p50Ms),
            classifyWorkerMaxMs: hybrid((h) => h.classifyWorker.maxMs),
            classifyRoundTripP50Ms: hybrid((h) => h.classifyRoundTrip.p50Ms),
            firstClassifiedAt: hybrid((h) => h.firstClassifiedAt),
            pagesHayro: hybrid((h) => h.pagesHayro),
            pagesBase: hybrid((h) => h.pagesBase),
            hayroLoadedAt: hybrid((h) => h.rendererLoad?.at),
            hayroLoadMs: hybrid((h) => h.rendererLoad?.loadMs),
            hayroParseMs: hybrid((h) => h.rendererLoad?.parseMs),
            classifierMiB: hybrid((h) => h.classifierMiB),
            hayroMiB: hybrid((h) => h.rendererMiB),
            passes: Object.fromEntries(
              ["base", "detail", "once"].map((pass) => [
                pass,
                {
                  rasterMs: hybrid((h) => h.hayroPasses?.[pass]?.raster.p50Ms),
                  reduceMs: hybrid((h) => h.hayroPasses?.[pass]?.reduce.p50Ms),
                  bitmapMs: hybrid((h) => h.hayroPasses?.[pass]?.bitmap.p50Ms),
                  fullBitmapMs: hybrid((h) => h.hayroPasses?.[pass]?.fullBitmap?.p50Ms),
                  count: hybrid((h) => h.hayroPasses?.[pass]?.raster.count),
                },
              ]),
            ),
            keptUsed: hybrid((h) => h.kept?.used),
            keptDropped: hybrid((h) =>
              h.kept
                ? Object.values(h.kept.dropped).reduce((sum, count) => sum + count, 0)
                : undefined,
            ),
            keptDropReasons: [
              ...new Set(jobs.flatMap((result) => Object.keys(result.hybrid?.kept?.dropped ?? {}))),
            ],
            keptPeakMiB: hybrid((h) => h.kept?.peakMiB),
            fallbacks: [...new Set(jobs.flatMap((result) => result.hybrid?.fallbacks ?? []))],
          }
        : null,
    };
  }),
);

const scrolling = files.flatMap((file) =>
  speeds.flatMap((speed) =>
    variantsFor(file).map((variant) => {
      const jobs = ok.filter(
        (result) =>
          result.file === file && result.speed === speed && result.variant === variant.name,
      );
      return {
        file,
        speed,
        variant: variant.name,
        jobs: jobs.length,
        pagesCrossed: pick(jobs, (result) => result.pagesCrossed),
        blankMeanPct: pick(jobs, (result) => result.blankMeanPct),
        blockedMs: pick(jobs, (result) => result.lag?.blockedMs),
        stallMs: pick(jobs, (result) => result.lag?.maxMs),
        droppedFrames: pick(jobs, (result) => result.frames?.dropped),
        frames: pick(jobs, (result) => result.frames?.frames),
        // Every base render of the job, startup and scroll; hayro's when it drew any.
        baseRenderMs: pick(jobs, (result) => baseRenders(result)?.p50Ms),
        baseRenderMaxMs: pick(jobs, (result) => baseRenders(result)?.maxMs),
        keptDropped: pick(jobs, (result) =>
          result.hybrid?.kept
            ? Object.values(result.hybrid.kept.dropped).reduce((sum, count) => sum + count, 0)
            : undefined,
        ),
        keptPeakMiB: pick(jobs, (result) => result.hybrid?.kept?.peakMiB),
      };
    }),
  ),
);

const payload = measurePayload();
const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browserName,
  browser: launched.label,
  headless: launched.headless,
  power,
  idle: {
    timerLagP50Ms: median(ok.map((result) => result.idle?.timerLagP50Ms)),
    timerLagP95Ms: median(ok.map((result) => result.idle?.timerLagP95Ms)),
    frameIntervalMs: median(ok.map((result) => result.idle?.frameIntervalMs)),
  },
  settings: { runs, speeds, durationMs, viewport: "1280x900", devicePixelRatio: 2, maxLoad },
  /** Jobs carried over from an interrupted run of the same settings. */
  resumedJobs: resumed.length,
  load: {
    median: median(results.map((result) => result.load)),
    max: Math.max(...results.map((result) => result.load ?? 0)),
  },
  // Ignored processes and the CPU time they used while the run lasted.
  ignored: ignoredBefore.map((row) => ({
    ...row,
    cpuSecondsDuringRun:
      (ignoredProcesses().find((after) => after.pid === row.pid)?.cpuSeconds ?? row.cpuSeconds) -
      row.cpuSeconds,
  })),
  errors: results.filter((result) => result.error).map((r) => `${r.file} ${r.variant}: ${r.error}`),
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
mkdirSync(join(resultsDir, "raw"), { recursive: true });
writeFileSync(
  join(resultsDir, "raw", `${output}-${environment.runAt.replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ environment, results }, round, 2),
);
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, payload, startup, scrolling }, round, 2)}\n`,
);
writeFileSync(join(resultsDir, `${output}.md`), `${renderReport()}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
// Only the standard outputs feed the cross-browser summary.
if (output === `hybrid-${browserName}`) {
  writeFileSync(join(resultsDir, "hybrid.md"), `${renderComparison()}\n`);
  console.log(`Wrote ${join(resultsDir, "hybrid.md")}`);
}

function fmt(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(digits);
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function payloadTable(): string[] {
  const rows = (label: string, list: { name: string; raw: number; brotli: number }[]) =>
    list.map(
      (asset) => `| ${label} | \`${asset.name}\` | ${kib(asset.raw)} | ${kib(asset.brotli)} |`,
    );
  const total = (list: { brotli: number }[]) =>
    kib(list.reduce((sum, asset) => sum + asset.brotli, 0));
  return [
    "## Payload",
    "",
    "Brotli quality 11 of the built assets. The hybrid engine's main-thread code is part of the app bundle and is not counted.",
    "",
    "| Loads | Asset | Raw | Brotli |",
    "|---|---|---:|---:|",
    ...rows("with every document", payload.withEveryDocument),
    ...rows("with the first image-only page", payload.withFirstScan),
    ...rows("pdf.js master (reference)", payload.pdfjsNext),
    "",
    `Added by the hybrid engine: ${total(payload.withEveryDocument)} with every document, ${total(payload.withFirstScan)} more once a document has an image-only page. pdf.js master itself: ${total(payload.pdfjsNext)}.`,
    "",
  ];
}

function renderReport(): string {
  const renderColumns = renderKeys.sort();
  return [
    `# ParaPDF hybrid engine: ${environment.browser}`,
    "",
    `- Run at: ${environment.runAt}`,
    `- Machine: ${environment.os}, ${environment.cpu}; ${environment.browser} (Playwright build, ${environment.headless ? "headless" : "headed"}); power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}${power.lowPowerMode ? ", Low Power Mode" : ""}; not comparable with AC runs**`}`,
    `- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by ${fmt(environment.idle.timerLagP50Ms, 1)} ms (median) / ${fmt(environment.idle.timerLagP95Ms, 1)} ms (p95); animation frames every ${fmt(environment.idle.frameIntervalMs, 1)} ms.`,
    `- Load: jobs started only while no other Playwright browser was open and the 1-minute load average was at most ${maxLoad}; at job start it was ${fmt(environment.load.median, 1)} (median), ${fmt(environment.load.max, 1)} at most, on ${cpus().length} logical cores.`,
    ...(environment.ignored.length
      ? [
          `- Not waited for (IGNORE_PIDS), with the CPU time each used during the run: ${environment.ignored
            .map(
              (row) =>
                `pid ${row.pid} \`${row.command.split(" ")[0]?.split("/").at(-1)}\` ${fmt(row.cpuSecondsDuringRun, 2)} s`,
            )
            .join(", ")}.`,
        ]
      : []),
    `- Variants: \`pdfjs-next-hwa\` is pdf.js master with its renderer worker on a GPU-backed canvas. The \`hybrid-*\` variants are the same engine with image-only pages rendered by hayro (wasm, simd128) in the hybrid worker, and differ in how a hayro page gets its two canvas layers: \`hybrid-once-hwa\` renders it once at full resolution, sends a reduced copy as the base layer and the full bitmap right after it for the detail layer; \`hybrid-basefirst-hwa\` renders the base layer, then the detail layer right away, ahead of other queued renders; \`hybrid-twice-hwa\` renders each layer when the scheduler asks for it, as the hybrid engine did before. Text, links, and search come from pdf.js in all of them. ${[...textFiles].join(", ")} ran only with \`pdfjs-next-hwa\` and \`hybrid-once-hwa\`: every hybrid variant leaves its pages to pdf.js.`,
    `- Method: fresh browser context per job, 1280×900 viewport at devicePixelRatio 2, fit-width zoom; ${runs} runs per file, speed, and variant, alternating which variant goes first; startup numbers pool both speeds (${runs * speeds.length} jobs per cell). Medians throughout.${environment.resumedJobs ? ` ${environment.resumedJobs} jobs come from an interrupted run of the same build and settings.` : ""}`,
    ...(browserName === "firefox"
      ? [
          "- Firefox renders at devicePixelRatio 2 through the `layout.css.devPixelsPerPx` pref, which the launcher sets: Playwright's `deviceScaleFactor` alone only overrides the ratio that pages report, and cross-origin-isolated pages such as the demo lose even that. The launcher change is commit 0451e04 of the firefox-dpr branch, cherry-picked onto this branch. Firefox results of this benchmark committed before it ran at ratio 1 and do not compare with these.",
        ]
      : []),
    "- First paint: navigation start until page 1 shows pixels (its low-resolution base layer). Page 1 sharp: until page 1's full-resolution layer is on the canvas.",
    "- Longest stall: the largest lateness of a 4 ms timer on the main thread, from startup until the scroll begins (startup) or during the scroll. Blocked: summed lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger.",
    "- Render: from the scheduler's request until the pixels are on the canvas, per canvas layer (base at half a device pixel per CSS pixel, detail at full resolution) and per engine; median of each job's median. Renders overlap (two at a time), so this is latency, not CPU time. With `hybrid-once-hwa` and `hybrid-basefirst-hwa`, a hayro page's detail render waits only for the bitmap the worker sends with the base layer.",
    `- Reproduce: \`pnpm bench:build && pnpm --filter @parapdf/prototype build && BROWSER=${browserName} pnpm --filter @parapdf/prototype bench:hybrid\``,
    ...(environment.errors.length
      ? ["", "Errors:", ...environment.errors.map((e) => `- ${e}`)]
      : []),
    "",
    "## Startup",
    "",
    `| File | Variant | First paint (ms) | Page 1 sharp (ms) | Longest stall (ms) | Blocked (ms) | ${renderColumns.map((key) => `Render ${key} (ms)`).join(" | ")} |`,
    `|---|---|---:|---:|---:|---:|${renderColumns.map(() => "---:").join("|")}|`,
    ...startup.map(
      (row) =>
        `| ${row.file} | ${row.variant} | ${fmt(row.firstPaintMs)} | ${fmt(row.page1DetailMs)} | ${fmt(row.startupStallMs, 1)} | ${fmt(row.startupBlockedMs)} | ${renderColumns
          .map((key) => {
            const cell = row.renders[key];
            return cell && Number.isFinite(cell.p50Ms) ? fmt(cell.p50Ms) : "—";
          })
          .join(" | ")} |`,
    ),
    "",
    "## Hybrid engine internals",
    "",
    "Times are medians across jobs. Classifier ready: navigation start until the worker had fetched the PDF and parsed it. Classify: time inside the worker per page, and the round trip from the main thread. hayro load: fetching and compiling the module, then parsing the PDF a second time.",
    "",
    "| File | Pages to hayro / pdf.js | Classifier ready (ms) | Fetch / wait for module / parse (ms) | Classify p50 / max (ms) | Round trip p50 (ms) | hayro load / parse (ms) | hayro ready (ms) | Classifier / hayro memory (MiB) | Fallbacks |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...startup
      .filter((row) => row.hybrid)
      .map((row) => {
        const h = row.hybrid as NonNullable<(typeof row)["hybrid"]>;
        return `| ${row.file} | ${fmt(h.pagesHayro)} / ${fmt(h.pagesBase)} | ${fmt(h.classifierReadyAt)} | ${fmt(h.fetchMs, 1)} / ${fmt(h.classifierWaitMs, 1)} / ${fmt(h.parseMs, 1)} | ${fmt(h.classifyWorkerP50Ms, 2)} / ${fmt(h.classifyWorkerMaxMs, 2)} | ${fmt(h.classifyRoundTripP50Ms, 1)} | ${fmt(h.hayroLoadMs)} / ${fmt(h.hayroParseMs, 1)} | ${fmt(h.hayroLoadedAt)} | ${fmt(h.classifierMiB, 1)} / ${fmt(h.hayroMiB, 1)} | ${h.fallbacks.length ? h.fallbacks.join("; ") : "none"} |`;
      }),
    "",
    "## hayro in the worker",
    "",
    "Medians across jobs of each job's median, per kind of pass: a base or a detail layer rendered on its own, or one pass at the detail scale that serves both layers (`once`). Raster: hayro's rendering in WebAssembly. Reduce: averaging the full-resolution pixels into the base layer. Bitmap: creating the ImageBitmap of the layer the pass sends first; Full bitmap: the full-resolution bitmap a `once` pass sends after its base layer. Kept bitmaps: detail-layer bitmaps the worker sent with a base render, used by the page's detail render or dropped unused, and the most memory they held at once while waiting for it.",
    "",
    "| File | Variant | Passes base / detail / once | Raster base / detail / once (ms) | Reduce (ms) | Bitmap base / detail / once (ms) | Full bitmap (ms) | Kept used / dropped | Kept peak (MiB) |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...startup
      .filter(
        (row) => row.hybrid && Number.isFinite(row.hybrid.pagesHayro) && row.hybrid.pagesHayro > 0,
      )
      .map((row) => {
        const h = row.hybrid as NonNullable<(typeof row)["hybrid"]>;
        const passes = (read: (pass: (typeof h.passes)[string]) => number, digits = 0) =>
          ["base", "detail", "once"]
            .map((pass) => {
              const cell = h.passes[pass];
              return cell ? fmt(read(cell), digits) : "—";
            })
            .join(" / ");
        return `| ${row.file} | ${row.variant} | ${passes((pass) => pass.count)} | ${passes((pass) => pass.rasterMs, 1)} | ${fmt(h.passes.once?.reduceMs, 1)} | ${passes((pass) => pass.bitmapMs, 1)} | ${fmt(h.passes.once?.fullBitmapMs, 1)} | ${fmt(h.keptUsed)} / ${fmt(h.keptDropped)}${h.keptDropReasons.length ? ` (${h.keptDropReasons.join(", ")})` : ""} | ${fmt(h.keptPeakMiB, 1)} |`;
      }),
    "",
    "## Scrolling",
    "",
    "Base render: every base render of the job (startup and scroll), hayro's on scans; median of each job's median and maximum. Kept: detail-layer bitmaps dropped unused, and the most memory kept bitmaps held at once.",
    "",
    "| File | Speed (px/s) | Variant | Pages crossed | Blank (%) | Blocked (ms) | Longest stall (ms) | Dropped frames | Base render p50 / max (ms) | Kept dropped / peak (MiB) |",
    "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ...scrolling.map(
      (row) =>
        `| ${row.file} | ${row.speed} | ${row.variant} | ${fmt(row.pagesCrossed)} | ${fmt(row.blankMeanPct, 1)} | ${fmt(row.blockedMs)} | ${fmt(row.stallMs, 1)} | ${fmt(row.droppedFrames)} / ${fmt(row.frames)} | ${fmt(row.baseRenderMs)} / ${fmt(row.baseRenderMaxMs)} | ${fmt(row.keptDropped)} / ${fmt(row.keptPeakMiB, 1)} |`,
    ),
    "",
    ...payloadTable(),
  ].join("\n");
}

interface StoredResults {
  environment: typeof environment;
  startup: typeof startup;
  scrolling: typeof scrolling;
}

/** Side-by-side summary of every browser's hybrid-<browser>.json. */
function renderComparison(): string {
  const all = browserNames.flatMap((name) => {
    const path = join(resultsDir, `hybrid-${name}.json`);
    return existsSync(path) ? [JSON.parse(readFileSync(path, "utf8")) as StoredResults] : [];
  });
  const header = `| File | Variant | ${all.map((results) => results.environment.browser).join(" | ")} |`;
  const rule = `|---|---|${all.map(() => "---:").join("|")}|`;
  const table = (title: string, read: (row: StoredResults["startup"][number]) => string) => [
    `## ${title}`,
    "",
    header,
    rule,
    ...(all[0]?.startup ?? []).map(
      (row) =>
        `| ${row.file} | ${row.variant} | ${all
          .map((results) => {
            const match = results.startup.find(
              (candidate) => candidate.file === row.file && candidate.variant === row.variant,
            );
            return match ? read(match) : "—";
          })
          .join(" | ")} |`,
    ),
    "",
  ];
  const scrollTable = (
    speed: number,
    title: string,
    read: (row: StoredResults["scrolling"][number]) => string,
  ) => [
    `## ${title} at ${speed} px/s`,
    "",
    header,
    rule,
    ...(all[0]?.scrolling ?? [])
      .filter((row) => row.speed === speed)
      .map(
        (row) =>
          `| ${row.file} | ${row.variant} | ${all
            .map((results) => {
              const match = results.scrolling.find(
                (candidate) =>
                  candidate.file === row.file &&
                  candidate.variant === row.variant &&
                  candidate.speed === speed,
              );
              return match ? read(match) : "—";
            })
            .join(" | ")} |`,
      ),
    "",
  ];
  const render = (row: StoredResults["startup"][number], layer: string) =>
    Object.entries(row.renders)
      .filter(([key, cell]) => key.startsWith(layer) && Number.isFinite(cell.p50Ms))
      .map(([key, cell]) => `${fmt(cell.p50Ms)} (${key.split(" ")[1]})`)
      .join(", ") || "—";
  return [
    "# ParaPDF hybrid engine across browsers",
    "",
    `Each browser's full report: ${all
      .map(
        (results) =>
          `[${results.environment.browser}](hybrid-${results.environment.browserName}.md) (${results.environment.runAt})`,
      )
      .join(
        ", ",
      )}. Medians of ${all[0]?.environment.settings.runs ?? "?"} runs at each of ${all[0]?.environment.settings.speeds.join(" and ") ?? "?"} px/s, pooled; Playwright's WebKit is not Safari.`,
    "",
    ...table("First paint (ms)", (row) => fmt(row.firstPaintMs)),
    ...table("Page 1 sharp (ms)", (row) => fmt(row.page1DetailMs)),
    ...table("Longest main-thread stall during startup (ms)", (row) => fmt(row.startupStallMs, 1)),
    ...table("Detail render per page, p50 (ms, engine)", (row) => render(row, "detail")),
    ...table("Base render per page, p50 (ms, engine)", (row) => render(row, "base")),
    ...table("hayro raster per pass, p50: base / detail / once (ms)", (row) =>
      row.hybrid && row.hybrid.pagesHayro > 0
        ? ["base", "detail", "once"]
            .map((pass) => fmt(row.hybrid?.passes?.[pass]?.rasterMs, 1))
            .join(" / ")
        : "—",
    ),
    ...table("Kept full-resolution bitmaps: used / dropped, peak MiB", (row) =>
      row.hybrid && row.hybrid.pagesHayro > 0 && row.hybrid.keptUsed !== undefined
        ? `${fmt(row.hybrid.keptUsed)} / ${fmt(row.hybrid.keptDropped)}, ${fmt(row.hybrid.keptPeakMiB, 1)}`
        : "—",
    ),
    ...table("WebAssembly memory: classifier / hayro (MiB)", (row) =>
      row.hybrid ? `${fmt(row.hybrid.classifierMiB, 1)} / ${fmt(row.hybrid.hayroMiB, 1)}` : "—",
    ),
    ...[...new Set((all[0]?.scrolling ?? []).map((row) => row.speed))].flatMap((speed) => [
      ...scrollTable(
        speed,
        "Main thread while scrolling: blocked / longest stall (ms)",
        (row) => `${fmt(row.blockedMs)} / ${fmt(row.stallMs, 1)}`,
      ),
      ...scrollTable(
        speed,
        "Blank area while scrolling (%) / base render p50 (ms)",
        (row) => `${fmt(row.blankMeanPct, 1)} / ${fmt(row.baseRenderMs)}`,
      ),
    ]),
  ].join("\n");
}
