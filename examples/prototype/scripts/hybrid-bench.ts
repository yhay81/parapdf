/**
 * Hybrid engine benchmark. Runs the scripted scroll of scroll-bench.ts with
 * pdf.js master and its renderer worker (`pdfjs-next-hwa`) and with the hybrid
 * engine (`hybrid-hwa`), alternating their order run by run, and records what
 * the hybrid engine changes: when page 1 got its first and its
 * full-resolution pixels, the main thread's longest stall from startup on,
 * render times per canvas layer and engine, the classifier's cost, hayro's
 * load time, WebAssembly memory, and the payload in dist/.
 *
 * Usage: pnpm bench:build && pnpm --filter @parapdf/prototype build &&
 * pnpm --filter @parapdf/prototype bench:hybrid
 * Environment: BROWSER (chromium, webkit, or firefox), VARIANTS, FILES, SPEEDS
 * (CSS px per second, 900,3600), RUNS (5), DURATION (ms, 4000), OUTPUT
 * (hybrid-<browser>). The run waits while Playwright browsers started by other
 * processes are open and repeats jobs they overlapped; ALLOW_PARALLEL=1 skips
 * that.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
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

const variants = [
  { name: "pdfjs-next-hwa", engine: "pdfjs-next" },
  { name: "hybrid-hwa", engine: "hybrid" },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
const files = (
  process.env.FILES ??
  "bunka-kokugo-series-019-p4.pdf,patent-us223898.pdf,wdl6812-manuscript.pdf,bill-hr815.pdf"
).split(",");
const speeds = (process.env.SPEEDS ?? "900,3600").split(",").map(Number);
const runs = Number(process.env.RUNS ?? "5");
const durationMs = Number(process.env.DURATION ?? "4000");
const browserName = browserFromEnv();
const output = process.env.OUTPUT ?? `hybrid-${browserName}`;

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

interface JobResult {
  variant: string;
  file: string;
  speed: number;
  run: number;
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

/**
 * Playwright browsers and test runners that another process started. Browser
 * main processes are children of their driver, so ancestry tells ours apart;
 * WebKit's helper processes belong to launchd and are skipped.
 */
function foreignBrowsers(): string[] {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const ours = (pid: number) => {
    for (let at = pid, depth = 0; at > 1 && depth < 50; at = parent.get(at) ?? 0, depth++) {
      if (at === process.pid) return true;
    }
    return false;
  };
  const browserMain = (command = "") =>
    (/ms-playwright\/chromium/.test(command) && !command.includes("--type=")) ||
    (/ms-playwright\/firefox/.test(command) && !command.includes("-contentproc")) ||
    (/ms-playwright\/webkit/.test(command) && !command.includes("com.apple.WebKit."));
  const driver = (command = "") => /@playwright\/test|playwright(-core)?\/cli\.js/.test(command);
  return rows
    .filter((row) => (browserMain(row.command) || driver(row.command)) && !ours(row.pid))
    .map((row) => `${row.pid} ${row.command?.slice(0, 140)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForQuietMachine(): Promise<void> {
  if (process.env.ALLOW_PARALLEL) return;
  const start = Date.now();
  for (let foreign = foreignBrowsers(); foreign.length; foreign = foreignBrowsers()) {
    if (Date.now() - start > 60 * 60_000) {
      throw new Error(`other Playwright browsers kept running for an hour:\n${foreign.join("\n")}`);
    }
    console.log(`Waiting for other Playwright browsers to close:\n  ${foreign.join("\n  ")}`);
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
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4182, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://localhost:4182/";
const launched = await launchBrowser(browserName);
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
  const job = { variant: variant.name, file, speed, run };
  try {
    // The idle baseline comes from a page without the viewer, in the same
    // context, right before the job.
    await page.goto(`${baseUrl}calibrate.html`);
    await waitForDone(page);
    const idle = (await page.evaluate(
      () => (window as { __result?: unknown }).__result,
    )) as JobResult["idle"] & {};
    const query = new URLSearchParams({
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
    return { ...payload, ...job, idle };
  } catch (error) {
    return { ...job, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close();
  }
}

const results: JobResult[] = [];
try {
  // Discarded jobs warm the GPU process and the server for each variant.
  for (const variant of variants) await runJob(variant, files[0] ?? "", speeds[0] ?? 900, -1);
  for (const file of files) {
    for (const speed of speeds) {
      for (let run = 0; run < runs; run++) {
        // Alternate which variant goes first so drift affects both alike.
        const ordered = run % 2 ? [...variants].reverse() : variants;
        for (const variant of ordered) {
          let result: JobResult | undefined;
          for (let attempt = 0; attempt < 3 && !result; attempt++) {
            await waitForQuietMachine();
            // Stop without writing results if the machine lost AC power mid-run.
            assertMeasurementPower();
            const candidate = await runJob(variant, file, speed, run);
            if (process.env.ALLOW_PARALLEL || foreignBrowsers().length === 0) result = candidate;
            else console.log("Another Playwright browser started during the job; repeating it.");
          }
          if (!result) throw new Error("other Playwright browsers kept overlapping the jobs");
          results.push(result);
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
const pick = (subset: JobResult[], read: (result: JobResult) => number | null | undefined) =>
  median(subset.map(read));
const renderKeys = [...new Set(ok.flatMap((result) => Object.keys(result.renderTimes ?? {})))];

// Startup does not depend on the scroll speed, so it pools every job of a variant.
const startup = files.flatMap((file) =>
  variants.map((variant) => {
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
            fallbacks: [...new Set(jobs.flatMap((result) => result.hybrid?.fallbacks ?? []))],
          }
        : null,
    };
  }),
);

const scrolling = files.flatMap((file) =>
  speeds.flatMap((speed) =>
    variants.map((variant) => {
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
  settings: { runs, speeds, durationMs, viewport: "1280x900", devicePixelRatio: 2 },
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
    `- Variants: \`pdfjs-next-hwa\` is pdf.js master with its renderer worker on a GPU-backed canvas; \`hybrid-hwa\` is the same engine with image-only pages rendered by hayro (wasm, simd128) in the hybrid worker. Text, links, and search come from pdf.js in both.`,
    `- Method: fresh browser context per job, 1280×900 viewport at devicePixelRatio 2, fit-width zoom; ${runs} runs per file, speed, and variant, alternating which variant goes first; startup numbers pool both speeds (${runs * speeds.length} jobs per cell). Medians throughout.`,
    "- First paint: navigation start until page 1 shows pixels (its low-resolution base layer). Page 1 sharp: until page 1's full-resolution layer is on the canvas.",
    "- Longest stall: the largest lateness of a 4 ms timer on the main thread, from startup until the scroll begins (startup) or during the scroll. Blocked: summed lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger.",
    "- Render: from the scheduler's request until the pixels are on the canvas, per canvas layer (base at half a device pixel per CSS pixel, detail at full resolution) and per engine; median of each job's median. Renders overlap (two at a time), so this is latency, not CPU time.",
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
    "## Scrolling",
    "",
    "| File | Speed (px/s) | Variant | Pages crossed | Blank (%) | Blocked (ms) | Longest stall (ms) | Dropped frames |",
    "|---|---:|---|---:|---:|---:|---:|---:|",
    ...scrolling.map(
      (row) =>
        `| ${row.file} | ${row.speed} | ${row.variant} | ${fmt(row.pagesCrossed)} | ${fmt(row.blankMeanPct, 1)} | ${fmt(row.blockedMs)} | ${fmt(row.stallMs, 1)} | ${fmt(row.droppedFrames)} / ${fmt(row.frames)} |`,
    ),
    "",
    ...payloadTable(),
  ].join("\n");
}

interface StoredResults {
  environment: typeof environment;
  startup: typeof startup;
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
    ...table("WebAssembly memory: classifier / hayro (MiB)", (row) =>
      row.hybrid ? `${fmt(row.hybrid.classifierMiB, 1)} / ${fmt(row.hybrid.hayroMiB, 1)}` : "—",
    ),
  ].join("\n");
}
