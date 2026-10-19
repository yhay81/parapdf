/**
 * Renders bench/results/<browser>.md from bench/results/<browser>.json and the
 * cross-browser summary bench/results/browsers.md from every browser's JSON.
 * run.ts calls this after measuring; run it directly to regenerate the reports
 * without measuring again: node bench/scripts/report.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserName, browserNames } from "./browsers.ts";

export interface Summary {
  file: string;
  engine: string;
  error?: string;
  usesRendererWorker?: boolean;
  initMs: number;
  openMs: number;
  firstRenderMs: number;
  firstPresentMs: number;
  pagePresentP50Ms: number;
  pagePresentP95Ms: number;
  blockedMs: number;
  lagP95Ms: number;
  lagMaxMs: number;
  wasmMemoryMiB: number | null;
}

export interface BrowserResults {
  environment: {
    runAt: string;
    os: string;
    cpu: string;
    memoryGiB: number;
    browserName: BrowserName;
    /** "WebKit 27.2". */
    browser: string;
    headless: boolean;
    power?: { source: string; lowPowerMode: boolean | null };
    /** How the run took turns with other Playwright browsers on the machine. */
    turnTaking?: string;
    gpu: string;
    crossOriginIsolated: boolean;
    idle: { timerLagP50Ms: number; timerLagP95Ms: number; frameIntervalMs: number };
    versions: Record<string, string | undefined>;
    settings: { runs: number; pages: number; scale: number };
  };
  payload: Record<string, { files: string[]; raw: number; gzip: number; brotli: number }>;
  summaries: Summary[];
}

const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const kib = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KiB`;

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const engineLine = (versions: Record<string, string | undefined>): string =>
  `pdfjs-dist ${versions["pdfjs-dist"]} (main-thread drawing)${versions["pdf.js master"] ? `, pdf.js master ${versions["pdf.js master"]} (renderer worker)` : ""}, @embedpdf/pdfium ${versions["@embedpdf/pdfium"]} (worker), hayro ${versions.hayro} (worker, wasm simd128). \`-hwa\` variants set \`enableHWA\` for a GPU-backed canvas.`;

const powerLine = ({ power }: BrowserResults["environment"]): string =>
  power?.source === "ac" && !power.lowPowerMode
    ? "AC"
    : `**${power?.source ?? "unknown"}${power?.lowPowerMode ? ", Low Power Mode" : ""}; not comparable with AC runs**`;

const idleLine = ({ idle }: BrowserResults["environment"]): string =>
  `on an idle page a 4 ms timer fires ${fmt(idle.timerLagP50Ms)} ms late (median) / ${fmt(idle.timerLagP95Ms)} ms (p95), and animation frames arrive every ${fmt(idle.frameIntervalMs)} ms`;

export function renderReport({ environment, payload, summaries }: BrowserResults): string {
  const engines = [...new Set(summaries.map((summary) => summary.engine))];
  const files = [...new Set(summaries.map((summary) => summary.file))];
  const { settings } = environment;
  const table = (title: string, note: string, pick: (summary: Summary) => string): string[] => [
    `## ${title}`,
    "",
    ...(note ? [note, ""] : []),
    `| File | ${engines.join(" | ")} |`,
    `|---|${engines.map(() => "---:").join("|")}|`,
    ...files.map((file) => {
      const cells = engines.map((engine) => {
        const summary = summaries.find((entry) => entry.file === file && entry.engine === engine);
        if (!summary) return "—";
        return summary.error ? "error" : pick(summary);
      });
      return `| ${file} | ${cells.join(" | ")} |`;
    }),
    "",
  ];
  const errors = summaries.filter((summary) => summary.error);
  const fallbacks = summaries.filter(
    (summary) =>
      summary.engine.startsWith("pdfjs-next") && !summary.error && !summary.usesRendererWorker,
  );

  return [
    `# ParaPDF engine benchmark: ${environment.browser}`,
    "",
    `- Run at: ${environment.runAt}`,
    `- Machine: ${environment.os}, ${environment.cpu}, ${environment.memoryGiB} GiB`,
    `- Browser: ${environment.browser} (Playwright build, ${environment.headless ? "headless" : "headed"}), WebGL renderer: ${environment.gpu}, crossOriginIsolated: ${environment.crossOriginIsolated}`,
    `- Power: ${powerLine(environment)}. Idle baseline: ${idleLine(environment)}.${environment.turnTaking ? ` The run ${environment.turnTaking}.` : ""}`,
    `- Engines: ${engineLine(environment.versions)}`,
    `- Method: scale ${settings.scale} (100% zoom at devicePixelRatio 2), first ${settings.pages} pages rendered one after another, fresh page per job, median of ${settings.runs} runs. "Visible" waits two animation frames after the pixels are committed to the canvas.`,
    `- Reproduce: \`pnpm bench:build && BROWSER=${environment.browserName} pnpm bench\``,
    "",
    ...(errors.length || fallbacks.length
      ? [
          "## Failures",
          "",
          ...errors.map((summary) => `- ${summary.file} · ${summary.engine}: ${summary.error}`),
          ...fallbacks.map(
            (summary) =>
              `- ${summary.file} · ${summary.engine}: pdf.js fell back to main-thread drawing.`,
          ),
          "",
        ]
      : []),
    "## Engine payload",
    "",
    "| Engine | Files | Raw | gzip | brotli |",
    "|---|---|---:|---:|---:|",
    ...Object.entries(payload).map(
      ([engine, totals]) =>
        `| ${engine} | ${totals.files.length} | ${kib(totals.raw)} | ${kib(totals.gzip)} | ${kib(totals.brotli)} |`,
    ),
    "",
    ...table(
      "First page visible, cold (ms)",
      `Frame-aligned, so values move in steps of about ${fmt(environment.idle.frameIntervalMs)} ms; use the committed table for finer engine differences.`,
      (summary) => fmt(summary.firstPresentMs),
    ),
    ...table("First page committed to the canvas, cold (ms)", "", (summary) =>
      fmt(summary.firstRenderMs),
    ),
    ...table(
      "Per-page visible p50 / p95 (ms)",
      "",
      (summary) => `${fmt(summary.pagePresentP50Ms)} / ${fmt(summary.pagePresentP95Ms)}`,
    ),
    ...table(
      "Main thread blocked while rendering (ms)",
      "Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.",
      (summary) => fmt(summary.blockedMs, 0),
    ),
    ...table(
      "Event-loop lag p95 / max (ms)",
      "",
      (summary) => `${fmt(summary.lagP95Ms)} / ${fmt(summary.lagMaxMs)}`,
    ),
    ...table(
      "Engine init + document open (ms)",
      "",
      (summary) => `${fmt(summary.initMs, 0)} + ${fmt(summary.openMs, 0)}`,
    ),
    ...table("Wasm linear memory after rendering (MiB)", "", (summary) =>
      fmt(summary.wasmMemoryMiB, 0),
    ),
  ].join("\n");
}

/** Files the cross-browser summary shows individually: text, scan, CJK fallback, vectors. */
const spotlightFiles = [
  "f1040.pdf",
  "bunka-kokugo-series-019-p4.pdf",
  "synthetic-cjk-nonembedded.pdf",
  "synthetic-vector-200k.pdf",
];

export function renderComparison(all: BrowserResults[]): string {
  const engines = [
    ...new Set(all.flatMap((results) => results.summaries.map((summary) => summary.engine))),
  ];
  const find = (results: BrowserResults, file: string, engine: string) =>
    results.summaries.find((summary) => summary.file === file && summary.engine === engine);
  const across = (pick: (summary: Summary) => number, digits: number) =>
    engines.map((engine) => {
      const cells = all.map((results) => {
        const ok = results.summaries.filter(
          (summary) => summary.engine === engine && !summary.error,
        );
        return ok.length ? fmt(median(ok.map(pick)), digits) : "—";
      });
      return `| ${engine} | ${cells.join(" | ")} |`;
    });
  const header = `| Engine | ${all.map((results) => results.environment.browser).join(" | ")} |`;
  const rule = `|---|${all.map(() => "---:").join("|")}|`;
  const spotlight = (pick: (summary: Summary) => string) =>
    spotlightFiles.flatMap((file) => [
      `| **${file}** | ${all.map(() => "").join(" | ")} |`,
      ...engines.map((engine) => {
        const cells = all.map((results) => {
          const summary = find(results, file, engine);
          if (!summary) return "—";
          return summary.error ? "error" : pick(summary);
        });
        return `| ${engine} | ${cells.join(" | ")} |`;
      }),
    ]);
  const fileCount = new Set(all.flatMap((results) => results.summaries.map((s) => s.file))).size;
  const failures = all.flatMap((results) =>
    results.summaries
      .filter(
        (summary) =>
          summary.error || (summary.engine.startsWith("pdfjs-next") && !summary.usesRendererWorker),
      )
      .map(
        (summary) =>
          `- ${results.environment.browser} · ${summary.file} · ${summary.engine}: ${summary.error ?? "pdf.js fell back to main-thread drawing"}`,
      ),
  );

  return [
    "# ParaPDF engine benchmark across browsers",
    "",
    "Each browser's full report: " +
      all
        .map(
          (results) =>
            `[${results.environment.browser}](${results.environment.browserName}.md) (${results.environment.runAt})`,
        )
        .join(", ") +
      ".",
    "",
    `- Machine: ${all[0]?.environment.os}, ${all[0]?.environment.cpu}`,
    `- Engines: ${all[0] ? engineLine(all[0].environment.versions) : ""}`,
    "- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.",
    ...all.map(
      (results) =>
        `- ${results.environment.browser}: power ${powerLine(results.environment)}; ${idleLine(results.environment)}.`,
    ),
    `- Method: the per-browser method on the same ${fileCount} files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.`,
    "",
    "## Failures and fallbacks",
    "",
    ...(failures.length ? failures : ["None."]),
    "",
    "## First page committed to the canvas, cold (ms): median across files",
    "",
    header,
    rule,
    ...across((summary) => summary.firstRenderMs, 1),
    "",
    "## Per-page visible p50 (ms): median across files",
    "",
    "Includes two animation frames after the commit.",
    "",
    header,
    rule,
    ...across((summary) => summary.pagePresentP50Ms, 1),
    "",
    "## Main thread blocked while rendering 10 pages (ms): median across files",
    "",
    header,
    rule,
    ...across((summary) => summary.blockedMs, 0),
    "",
    "## Event-loop lag max (ms): median across files",
    "",
    header,
    rule,
    ...across((summary) => summary.lagMaxMs, 1),
    "",
    "## Selected files: first page committed (ms) / main thread blocked (ms)",
    "",
    header,
    rule,
    ...spotlight((summary) => `${fmt(summary.firstRenderMs, 0)} / ${fmt(summary.blockedMs, 0)}`),
    "",
  ].join("\n");
}

const readResults = (resultsDir: string, browser: BrowserName): BrowserResults | undefined => {
  const path = join(resultsDir, `${browser}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BrowserResults) : undefined;
};

export function writeReport(resultsDir: string, browser: BrowserName): string {
  const results = readResults(resultsDir, browser);
  if (!results) throw new Error(`${browser}.json is missing in ${resultsDir}`);
  const target = join(resultsDir, `${browser}.md`);
  writeFileSync(target, `${renderReport(results)}\n`);
  return target;
}

export function writeComparison(resultsDir: string): string {
  const all = browserNames.flatMap((browser) => readResults(resultsDir, browser) ?? []);
  const target = join(resultsDir, "browsers.md");
  writeFileSync(target, `${renderComparison(all)}\n`);
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resultsDir = fileURLToPath(new URL("../results/", import.meta.url));
  for (const browser of browserNames) {
    if (readResults(resultsDir, browser)) console.log(`Wrote ${writeReport(resultsDir, browser)}`);
  }
  console.log(`Wrote ${writeComparison(resultsDir)}`);
}
