/**
 * Writes results/browsers.md, a side-by-side summary of the scroll benchmark
 * in every browser that has a results/<browser>.json from scroll-bench.ts.
 *
 * Usage: node examples/prototype/scripts/compare.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browserNames } from "../../../bench/scripts/browsers.ts";

interface Summary {
  file: string;
  speed: number;
  variant: string;
  runs: number;
  firstPaintMs: number;
  commitsDuringScroll: number;
  blankMeanPct: number;
  blockedMs: number;
  lagMaxMs: number;
  droppedFrames: number;
  frames: number;
}

interface ScrollResults {
  environment: {
    runAt: string;
    os: string;
    cpu: string;
    browser: string;
    idle: { timerLagP50Ms: number; timerLagP95Ms: number; frameIntervalMs: number };
    settings: { runs: number; durationMs: number };
  };
  summaries: Summary[];
}

const resultsDir = fileURLToPath(new URL("../results/", import.meta.url));
const all = browserNames.flatMap((name) => {
  const path = join(resultsDir, `${name}.json`);
  return existsSync(path)
    ? [{ name, ...(JSON.parse(readFileSync(path, "utf8")) as ScrollResults) }]
    : [];
});
if (all.length === 0) throw new Error("no results/<browser>.json files to compare");

const fmt = (value: number | undefined, digits = 0) =>
  value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const first = all[0] as (typeof all)[number];
const keys = first.summaries.map(({ file, speed, variant }) => ({ file, speed, variant }));
const groups = [...new Set(keys.map(({ file, speed }) => `${file}\t${speed}`))];
const variants = [...new Set(keys.map(({ variant }) => variant))];
const find = (results: ScrollResults, file: string, speed: number, variant: string) =>
  results.summaries.find(
    (summary) => summary.file === file && summary.speed === speed && summary.variant === variant,
  );
const header = `| Variant | ${all.map((results) => results.environment.browser).join(" | ")} |`;
const rule = `|---|${all.map(() => "---:").join("|")}|`;

const markdown = [
  "# ParaPDF runtime prototype: scripted scroll across browsers",
  "",
  `Each browser's full report: ${all.map((results) => `[${results.environment.browser}](${results.name}.md) (${results.environment.runAt})`).join(", ")}.`,
  "",
  `- Machine: ${first.environment.os}, ${first.environment.cpu}`,
  "- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.",
  ...all.map(
    ({ environment: { browser, idle } }) =>
      `- ${browser}: on an idle page a 4 ms timer fires ${fmt(idle.timerLagP50Ms, 1)} ms late (median) / ${fmt(idle.timerLagP95Ms, 1)} ms (p95); animation frames arrive every ${fmt(idle.frameIntervalMs, 1)} ms.`,
  ),
  `- Method: the scroll benchmark's method in every browser, ${first.environment.settings.durationMs} ms of scrolling, median of ${first.environment.settings.runs} runs. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls. Dropped frames are frames longer than 1.5 idle frame intervals.`,
  "- Cells: blank viewport (%) · main thread blocked (ms) · longest stall (ms) · dropped frames.",
  "",
  ...groups.flatMap((group) => {
    const [file = "", speedText = "0"] = group.split("\t");
    const speed = Number(speedText);
    return [
      `## ${file}, ${speed} CSS px per second`,
      "",
      header,
      rule,
      ...variants.map((variant) => {
        const cells = all.map((results) => {
          const summary = find(results, file, speed, variant);
          if (!summary || summary.runs === 0) return "error";
          return `${fmt(summary.blankMeanPct, 1)} · ${fmt(summary.blockedMs)} · ${fmt(summary.lagMaxMs)} · ${fmt(summary.droppedFrames)}`;
        });
        return `| ${variant} | ${cells.join(" | ")} |`;
      }),
      "",
    ];
  }),
  "## First paint (ms)",
  "",
  "Time from navigation start until page 1 shows pixels, median over both scroll speeds' runs.",
  "",
  `| File · variant | ${all.map((results) => results.environment.browser).join(" | ")} |`,
  rule,
  ...[...new Set(keys.map(({ file }) => file))].flatMap((file) =>
    variants.map((variant) => {
      const cells = all.map((results) => {
        const values = results.summaries
          .filter((summary) => summary.file === file && summary.variant === variant)
          .map((summary) => summary.firstPaintMs)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const median =
          values.length % 2
            ? values[mid]
            : ((values[mid - 1] ?? Number.NaN) + (values[mid] ?? Number.NaN)) / 2;
        return fmt(median);
      });
      return `| ${file} · ${variant} | ${cells.join(" | ")} |`;
    }),
  ),
  "",
  "## React commits while scrolling",
  "",
  "Commits depend on the pages crossed, not on the browser; a browser that commits more is rendering React in the hot path.",
  "",
  `| File · speed | ${all.map((results) => results.environment.browser).join(" | ")} |`,
  rule,
  ...groups.map((group) => {
    const [file = "", speedText = "0"] = group.split("\t");
    const speed = Number(speedText);
    const variant = variants[0] ?? "";
    const cells = all.map((results) =>
      fmt(find(results, file, speed, variant)?.commitsDuringScroll),
    );
    return `| ${file} · ${speed} px/s (${variant}) | ${cells.join(" | ")} |`;
  }),
  "",
];
const target = join(resultsDir, "browsers.md");
writeFileSync(target, `${markdown.join("\n")}\n`);
console.log(`Wrote ${target}`);
