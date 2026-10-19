/**
 * Control for the scroll benchmark: main-thread timer lateness on a viewer
 * whose pages are already rendered, either left still or scrolled back and
 * forth inside the mounted pages. Nothing renders and React does not commit,
 * so lateness here comes from the browser and the page as it stands, not
 * from ParaPDF's rendering. Writes results/control.{md,json}.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/scroll-control.ts
 * Environment: BROWSERS (chromium,webkit,firefox), FILE (bill-hr815.pdf), RUNS (3).
 */
import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  type BrowserName,
  browserNames,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTaking,
  turnTakingSummary,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const requested = (process.env.BROWSERS ?? browserNames.join(",")).split(",");
const browsers = browserNames.filter((name) => requested.includes(name));
const file = process.env.FILE ?? "bill-hr815.pdf";
const runs = Number(process.env.RUNS ?? "3");
const modes = ["still", "scroll"] as const;
type Mode = (typeof modes)[number];

interface Sample {
  idleLagP95Ms: number;
  blockedMs: number;
  maxLagMs: number;
  renders: number;
}

/** One idle second for the baseline, then four seconds still or scrolling 600 px back and forth. */
const measure = (page: Page, mode: Mode): Promise<Sample> =>
  page.evaluate(async (mode) => {
    type Stats = { base: number; detail: number; text: number; annotations: number };
    const viewer = (window as unknown as { __viewer: { scroller: HTMLElement; stats: Stats } })
      .__viewer;
    const scroller = viewer.scroller;
    const lateness = (durationMs: number, step?: (elapsed: number) => void) =>
      new Promise<number[]>((resolve) => {
        const lags: number[] = [];
        const start = performance.now();
        let expected = start + 4;
        const tick = () => {
          const now = performance.now();
          lags.push(Math.max(0, now - expected));
          expected = now + 4;
          if (now - start < durationMs) setTimeout(tick, 4);
          else resolve(lags);
        };
        setTimeout(tick, 4);
        if (step) {
          const frame = (now: number) => {
            if (now - start >= durationMs) return;
            step(now - start);
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }
      });
    const total = (stats: Stats) => stats.base + stats.detail + stats.text + stats.annotations;
    const idle = (await lateness(1000)).sort((a, b) => a - b);
    const idleLagP95Ms = idle[Math.floor(idle.length * 0.95)] ?? 0;
    const before = total(viewer.stats);
    const top = scroller.scrollTop;
    const lags = await lateness(
      4000,
      mode === "scroll"
        ? (elapsed) => {
            // 900 CSS px per second, back and forth over 600 px inside pages 1 and 2.
            const distance = (elapsed / 1000) * 900;
            const leg = distance % 1200;
            scroller.scrollTop = top + (leg < 600 ? leg : 1200 - leg);
          }
        : undefined,
    );
    return {
      idleLagP95Ms,
      // The scroll benchmark's rule: lateness beyond 2 ms or the idle p95.
      blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - Math.max(2, idleLagP95Ms)), 0),
      maxLagMs: Math.max(...lags),
      renders: total(viewer.stats) - before,
    };
  }, mode);

assertMeasurementPower();
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4187, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4187/";
const results: { browser: string; name: BrowserName; mode: Mode; samples: Sample[] }[] = [];
try {
  for (const name of browsers) {
    const launched = await launchBrowser(name);
    try {
      for (const mode of modes) {
        const samples: Sample[] = [];
        for (let run = 0; run < runs; run++) {
          const sample = await measureInTurn(launched, async (browser) => {
            const context = await browser.newContext({
              viewport: { width: 1280, height: 900 },
              deviceScaleFactor: 2,
            });
            try {
              const page = await context.newPage();
              await restoreScaleFactor(page, `${baseUrl}calibrate.html`);
              await page.goto(`${baseUrl}?engine=pdfjs-next&hwa=1&file=${file}`);
              await page.waitForSelector('section[data-page="2"] .parapdf-text-layer span', {
                timeout: 30_000,
              });
              // Let detail renders, text layers, and annotation layers finish.
              await page.waitForTimeout(3000);
              return await measure(page, mode);
            } finally {
              await context.close();
            }
          });
          samples.push(sample);
          console.log(
            `${launched.label} · ${mode} · run ${run + 1}/${runs}: blocked ${sample.blockedMs.toFixed(0)} ms, longest ${sample.maxLagMs.toFixed(1)} ms, renders ${sample.renders}`,
          );
        }
        results.push({ browser: launched.label, name, mode, samples });
      }
    } finally {
      await launched.close();
    }
  }
} finally {
  await server.close();
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] ?? Number.NaN)
    : ((sorted[mid - 1] ?? Number.NaN) + (sorted[mid] ?? Number.NaN)) / 2;
};
const span = (values: number[], digits = 0) =>
  `${median(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)}–${Math.max(...values).toFixed(digits)})`;
const runAt = new Date().toISOString();
const markdown = [
  "# ParaPDF runtime prototype: scroll control",
  "",
  `- Run at: ${runAt}`,
  `- Machine: ${platform()} ${release()} ${arch()}, ${cpus()[0]?.model ?? "unknown"}; Playwright's headless browsers; the run ${turnTakingSummary()}.`,
  `- Method: ${file} with pdf.js master's renderer worker on a GPU-backed canvas, 1280×900 at devicePixelRatio 2. After page 2's text layer exists and 3 more seconds pass, a 4 ms timer runs for 1 second idle (the baseline) and then for 4 seconds while the page stays still or scrolls back and forth over 600 px at 900 CSS px per second inside the mounted pages. Nothing renders and React does not commit in either mode. Blocked counts lateness beyond 2 ms or the idle 95th percentile, whichever is larger, as in the scroll benchmark. Fresh context per run, ${runs} runs.`,
  "- Reproduce: `pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/scroll-control.ts`",
  "",
  "| Browser | Mode | Blocked, median (range), ms | Longest stall, median (range), ms | Renders |",
  "|---|---|---:|---:|---:|",
  ...results.map(
    ({ browser, mode, samples }) =>
      `| ${browser} | ${mode} | ${span(samples.map((sample) => sample.blockedMs))} | ${span(
        samples.map((sample) => sample.maxLagMs),
        1,
      )} | ${samples.reduce((sum, sample) => sum + sample.renders, 0)} |`,
  ),
  "",
];
writeFileSync(join(resultsDir, "control.md"), `${markdown.join("\n")}\n`);
writeFileSync(
  join(resultsDir, "control.json"),
  `${JSON.stringify({ runAt, file, runs, turnTaking, results }, (_key, value) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value), 2)}\n`,
);
console.log(`\nWrote ${join(resultsDir, "control.md")}`);
