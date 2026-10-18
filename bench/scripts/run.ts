/**
 * Runs every engine on every corpus file in fresh browser pages and writes
 * bench/results/<browser>.{json,md} plus the cross-browser summary
 * bench/results/browsers.md. Per-run data and a thumbnail contact sheet go to
 * bench/results/raw/ (not committed).
 *
 * Environment: BROWSER (chromium, webkit, or firefox), ENGINES, FILES
 * (comma-separated), RUNS (3), PAGES (10), SCALE (2.6667 = 100% zoom at
 * devicePixelRatio 2), HEADED=1 to show the browser.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Browser } from "playwright";
import { preview } from "vite";
import { assertMeasurementPower, browserFromEnv, launchBrowser } from "./browsers.ts";
import { writeComparison, writeReport } from "./report.ts";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(benchDir, "dist");
const resultsDir = join(benchDir, "results");
const pdfjsNextRepo = join(benchDir, "vendor/pdf.js");
if (!existsSync(join(distDir, "index.html"))) {
  throw new Error("dist/ is missing; run `pnpm bench:build` first.");
}

const hasPdfjsNext = existsSync(join(pdfjsNextRepo, "build/generic/build/pdf.renderer.mjs"));
const defaultEngines = [
  "pdfjs",
  "pdfjs-hwa",
  ...(hasPdfjsNext ? ["pdfjs-next", "pdfjs-next-hwa"] : []),
  "pdfium",
  "hayro",
];
const engines = process.env.ENGINES ? process.env.ENGINES.split(",") : defaultEngines;
const runs = Number(process.env.RUNS ?? "3");
const pages = Number(process.env.PAGES ?? "10");
const scale = Number(process.env.SCALE ?? "2.6667");
const files = process.env.FILES
  ? process.env.FILES.split(",")
  : readdirSync(join(distDir, "corpus"))
      .filter((name) => name.endsWith(".pdf"))
      .sort();

interface JobResult {
  engine: string;
  file: string;
  run: number;
  error?: string;
  pageCount?: number;
  renderedPages?: number;
  initMs?: number;
  openMs?: number;
  firstRenderMs?: number;
  firstPresentMs?: number;
  presentMs?: number[];
  renderPhaseMs?: number;
  longTasks?: { blockingMs: number; maxMs: number };
  idle?: { timerLagP50Ms: number; timerLagP95Ms: number; frameIntervalMs: number };
  lag?: { samples: number; p95Ms: number; maxMs: number; blockedMs: number; rawLagMs: number };
  wasmMemoryBytes?: number;
  usesRendererWorker?: boolean;
  environment?: { gpu?: string; crossOriginIsolated?: boolean };
  thumbnail?: string;
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
};

async function runJob(
  browser: Browser,
  baseUrl: string,
  job: { engine: string; file: string; run: number },
): Promise<JobResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const query = new URLSearchParams({
    engine: job.engine,
    file: job.file,
    scale: String(scale),
    pages: String(pages),
  });
  try {
    await page.goto(`${baseUrl}?${query}`);
    await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
      timeout: 300_000,
    });
    const payload = (await page.evaluate(
      () => (window as { __result?: unknown }).__result,
    )) as Omit<JobResult, "run">;
    // One thumbnail per file and engine is enough for the contact sheet.
    if (job.run > 0) delete payload.thumbnail;
    return { ...payload, ...job };
  } catch (error) {
    return { ...job, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close();
  }
}

const power = assertMeasurementPower();
const server = await preview({
  root: benchDir,
  configFile: join(benchDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4179, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4179/";
const browserName = browserFromEnv();
const launched = await launchBrowser(browserName);
const { browser } = launched;

const results: JobResult[] = [];
try {
  // One discarded job warms the GPU process, fonts, and HTTP cache so the first
  // measured job is not penalized.
  await runJob(browser, baseUrl, { engine: engines[0] ?? "pdfjs", file: files[0] ?? "", run: -1 });
  for (const file of files) {
    // Stop without writing results if the machine lost AC power mid-run.
    assertMeasurementPower();
    for (const engine of engines) {
      for (let run = 0; run < runs; run++) {
        const result = await runJob(browser, baseUrl, { engine, file, run });
        results.push(result);
        const summary = result.error
          ? `ERROR ${result.error.split("\n")[0]}`
          : `visible ${result.firstPresentMs?.toFixed(1)} ms, main thread blocked ${result.lag?.blockedMs.toFixed(0)} ms`;
        console.log(`${file} · ${engine} · run ${run + 1}/${runs}: ${summary}`);
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}

// Transfer size of each engine's own assets (JS and Wasm), as served from dist/.
const assetDir = join(distDir, "assets");
const assetNames = readdirSync(assetDir);
const payloadPatterns: Record<string, RegExp> = {
  pdfjs: /^(pdfjs-[\w-]{8}\.js|pdf\.worker\.min-)/,
  "pdfjs-next (workers unminified)": /^(pdfjs-next-|pdf\.worker-|pdf\.renderer-)/,
  pdfium: /^pdfium/,
  hayro: /^hayro/,
};
const payload: Record<string, { files: string[]; raw: number; gzip: number; brotli: number }> = {};
for (const [engine, pattern] of Object.entries(payloadPatterns)) {
  const matched = assetNames.filter((name) => pattern.test(name) && !name.endsWith(".map"));
  if (matched.length === 0) continue;
  const totals = { files: matched, raw: 0, gzip: 0, brotli: 0 };
  for (const name of matched) {
    const bytes = readFileSync(join(assetDir, name));
    totals.raw += bytes.byteLength;
    totals.gzip += gzipSync(bytes, { level: 9 }).byteLength;
    totals.brotli += brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength;
  }
  payload[engine] = totals;
}

const packageVersion = (name: string): string =>
  JSON.parse(readFileSync(join(benchDir, "node_modules", name, "package.json"), "utf8")).version;
const hayroVersion =
  /name = "hayro"\nversion = "([^"]+)"/.exec(
    readFileSync(join(benchDir, "hayro-wasm/Cargo.lock"), "utf8"),
  )?.[1] ?? "unknown";
const pdfjsNextCommit = hasPdfjsNext
  ? execFileSync("git", ["-C", pdfjsNextRepo, "log", "-1", "--format=%h %cs"], {
      encoding: "utf8",
    }).trim()
  : undefined;
const firstOk = results.find((result) => !result.error);
const okResults = results.filter((result) => !result.error);
const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  memoryGiB: Math.round(totalmem() / 2 ** 30),
  browserName,
  browser: launched.label,
  headless: launched.headless,
  power,
  gpu: firstOk?.environment?.gpu ?? "unknown",
  crossOriginIsolated: firstOk?.environment?.crossOriginIsolated ?? false,
  // Medians of each job's idle baseline, measured before its engine loaded.
  idle: {
    timerLagP50Ms: median(okResults.map((result) => result.idle?.timerLagP50Ms ?? Number.NaN)),
    timerLagP95Ms: median(okResults.map((result) => result.idle?.timerLagP95Ms ?? Number.NaN)),
    frameIntervalMs: median(okResults.map((result) => result.idle?.frameIntervalMs ?? Number.NaN)),
  },
  versions: {
    "pdfjs-dist": packageVersion("pdfjs-dist"),
    "pdf.js master": pdfjsNextCommit,
    "@embedpdf/pdfium": packageVersion("@embedpdf/pdfium"),
    hayro: hayroVersion,
  },
  settings: { runs, pages, scale },
};

// Aggregate per file and engine: medians across runs; percentiles across pages.
const summaries = files.flatMap((file) =>
  engines.map((engine) => {
    const jobs = results.filter((result) => result.file === file && result.engine === engine);
    const ok = jobs.filter((job) => !job.error);
    const presented = ok.flatMap((job) => job.presentMs ?? []);
    return {
      file,
      engine,
      runs: ok.length,
      error: ok.length === 0 ? jobs[0]?.error?.split("\n")[0] : undefined,
      pageCount: ok[0]?.pageCount,
      renderedPages: ok[0]?.renderedPages,
      usesRendererWorker: ok[0]?.usesRendererWorker,
      initMs: median(ok.map((job) => job.initMs ?? Number.NaN)),
      openMs: median(ok.map((job) => job.openMs ?? Number.NaN)),
      firstRenderMs: median(ok.map((job) => job.firstRenderMs ?? Number.NaN)),
      firstPresentMs: median(ok.map((job) => job.firstPresentMs ?? Number.NaN)),
      pagePresentP50Ms: percentile(presented, 50),
      pagePresentP95Ms: percentile(presented, 95),
      renderPhaseMs: median(ok.map((job) => job.renderPhaseMs ?? Number.NaN)),
      blockedMs: median(ok.map((job) => job.lag?.blockedMs ?? Number.NaN)),
      lagP95Ms: median(ok.map((job) => job.lag?.p95Ms ?? Number.NaN)),
      lagMaxMs: median(ok.map((job) => job.lag?.maxMs ?? Number.NaN)),
      longTaskBlockingMs: median(ok.map((job) => job.longTasks?.blockingMs ?? Number.NaN)),
      wasmMemoryMiB: median(ok.map((job) => (job.wasmMemoryBytes ?? Number.NaN) / 2 ** 20)),
    };
  }),
);

mkdirSync(join(resultsDir, "raw"), { recursive: true });
const stamp = environment.runAt.replace(/[:.]/g, "-");
writeFileSync(
  join(resultsDir, "raw", `${browserName}-${stamp}.json`),
  JSON.stringify({ environment, results }, null, 1),
);
// Timer resolution is far coarser than float noise, so keep one decimal.
const roundMetrics = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
writeFileSync(
  join(resultsDir, `${browserName}.json`),
  `${JSON.stringify({ environment, payload, summaries }, roundMetrics, 2)}\n`,
);

// Contact sheet for side-by-side fidelity review of page 1 at the bench scale.
const contact = [
  `<!doctype html><meta charset=utf-8><title>ParaPDF engine thumbnails, ${launched.label}</title>`,
  "<style>body{font:12px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;vertical-align:top}img{width:200px;display:block}</style>",
  `<table><tr><th>file</th>${engines.map((engine) => `<th>${engine}</th>`).join("")}</tr>`,
  ...files.map((file) => {
    const cells = engines.map((engine) => {
      const job = results.find(
        (result) => result.file === file && result.engine === engine && result.thumbnail,
      );
      return `<td>${job?.thumbnail ? `<img src="${job.thumbnail}">` : "—"}</td>`;
    });
    return `<tr><th>${file}</th>${cells.join("")}</tr>`;
  }),
  "</table>",
].join("\n");
writeFileSync(join(resultsDir, "raw", `${browserName}-contact.html`), contact);

console.log(`\nWrote ${writeReport(resultsDir, browserName)}`);
console.log(`Wrote ${writeComparison(resultsDir)}`);
