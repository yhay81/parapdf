/**
 * Renders bench/results/latest.md from bench/results/latest.json.
 * run.ts calls this after measuring; run it directly to regenerate the report
 * without measuring again: node bench/scripts/report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Summary {
  file: string;
  engine: string;
  error?: string;
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

export interface LatestResults {
  environment: {
    runAt: string;
    os: string;
    cpu: string;
    memoryGiB: number;
    chromium: string;
    headless: boolean;
    gpu: string;
    crossOriginIsolated: boolean;
    versions: Record<string, string | undefined>;
    settings: { runs: number; pages: number; scale: number };
  };
  payload: Record<string, { files: string[]; raw: number; gzip: number; brotli: number }>;
  summaries: Summary[];
}

const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const kib = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KiB`;

export function renderReport({ environment, payload, summaries }: LatestResults): string {
  const engines = [...new Set(summaries.map((summary) => summary.engine))];
  const files = [...new Set(summaries.map((summary) => summary.file))];
  const { versions, settings } = environment;
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

  return [
    "# ParaPDF engine benchmark",
    "",
    `- Run at: ${environment.runAt}`,
    `- Machine: ${environment.os}, ${environment.cpu}, ${environment.memoryGiB} GiB`,
    `- Browser: Chromium ${environment.chromium} (${environment.headless ? "headless" : "headed"}), GPU: ${environment.gpu}, crossOriginIsolated: ${environment.crossOriginIsolated}`,
    `- Engines: pdfjs-dist ${versions["pdfjs-dist"]} (main-thread drawing)${versions["pdf.js master"] ? `, pdf.js master ${versions["pdf.js master"]} (renderer worker)` : ""}, @embedpdf/pdfium ${versions["@embedpdf/pdfium"]} (worker), hayro ${versions.hayro} (worker, wasm simd128). \`-hwa\` variants set \`enableHWA\` for a GPU-backed canvas.`,
    `- Method: scale ${settings.scale} (100% zoom at devicePixelRatio 2), first ${settings.pages} pages rendered one after another, fresh page per job, median of ${settings.runs} runs. "Visible" waits two animation frames after the pixels are committed to the canvas.`,
    "- Reproduce: `pnpm bench:build && pnpm bench`",
    "",
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
      "Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.",
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
      "Sum of event-loop lag measured by a 4 ms timer during the whole render phase. Lower means input and scrolling stay responsive while pages render.",
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

export function writeReport(resultsDir: string): string {
  const latest = JSON.parse(readFileSync(join(resultsDir, "latest.json"), "utf8")) as LatestResults;
  const target = join(resultsDir, "latest.md");
  writeFileSync(target, `${renderReport(latest)}\n`);
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Wrote ${writeReport(fileURLToPath(new URL("../results/", import.meta.url)))}`);
}
