/**
 * Main-thread cost of zooming and of slow scrolling, measured with Chromium's
 * DevTools protocol: task, script, layout, and style time from
 * Performance.getMetrics, plus a JavaScript CPU profile that attributes the
 * script time, and the renders and layers the scheduler completed. Zoom: steps
 * 600 ms apart (four 1.25× steps from the fit-width zoom by default), then
 * until the pages are sharp and idle work is done. Slow scroll: 900 CSS px
 * per second for 4 seconds by default, sideways in "horizontal" scroll mode and
 * downward otherwise, then the same settling.
 *
 * Usage: pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/main-thread-bench.ts
 * Build with `vite build --minify false` first to read function names in the profile.
 * Environment: SCENARIOS (zoom,slow scroll), VARIANTS, TEXT and LINKS (1, 0, or 1,0),
 * SCROLL (scroll modes: vertical, horizontal, wrapped, or a list; vertical), FILE
 * (bill-hr815.pdf), DPR (2), START_SCALE (CSS px per point, fit-width, or fit-page; fit
 * width), ZOOM (zoom factors, 1.25,1.25,1.25,1.25), SPEED (CSS px per second, 900), DURATION
 * (ms, 4000), RUNS (3), QUERIES (demo parameters each variant is also measured with,
 * separated by ";", such as "autoLinks=0;autoLinks=1"), OUTPUT (main-thread), LABEL (a note on
 * the code measured, for the report). The variants follow each other run by run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CDPSession, Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  launchBrowser,
  measureInTurn,
  turnTaking,
  turnTakingSummary,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const engines = [
  { name: "pdfjs-hwa", engine: "pdfjs" },
  { name: "pdfjs-next-hwa", engine: "pdfjs-next" },
].filter(
  (variant) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(variant.name),
);
const textModes = (process.env.TEXT ?? "1,0").split(",").map((mode) => mode !== "0");
const linkModes = (process.env.LINKS ?? "1").split(",").map((mode) => mode !== "0");
const scrollModes = (process.env.SCROLL ?? "vertical").split(",");
const queries = process.env.QUERIES ? process.env.QUERIES.split(";") : [""];
for (const mode of scrollModes) {
  if (!["vertical", "horizontal", "wrapped"].includes(mode)) {
    throw new Error(`scroll mode ${mode} is not one this benchmark scrolls`);
  }
}
const variants = engines.flatMap((engine) =>
  textModes.flatMap((text) =>
    linkModes.flatMap((links) =>
      scrollModes.flatMap((scroll) =>
        queries.map((extra) => ({
          ...engine,
          text,
          links,
          scroll,
          extra,
          label: [
            engine.name,
            text ? "" : "no text",
            links ? "" : "no links",
            process.env.SCROLL ? scroll : "",
            extra,
          ]
            .filter(Boolean)
            .join(", "),
        })),
      ),
    ),
  ),
);
const file = process.env.FILE ?? "bill-hr815.pdf";
const dpr = Number(process.env.DPR ?? "2");
// A number, or a fit: "fit-width" or "fit-page".
const startScale = process.env.START_SCALE
  ? Number.isNaN(Number(process.env.START_SCALE))
    ? process.env.START_SCALE
    : Number(process.env.START_SCALE)
  : null;
const zoomSteps = (process.env.ZOOM ?? "1.25,1.25,1.25,1.25").split(",").map(Number);
const speed = Number(process.env.SPEED ?? "900");
const durationMs = Number(process.env.DURATION ?? "4000");
const runs = Number(process.env.RUNS ?? "3");
const label = process.env.LABEL ?? null;
const output = process.env.OUTPUT ?? "main-thread";
const allScenarios = ["zoom", "slow scroll"] as const;
type Scenario = (typeof allScenarios)[number];
const scenarios = allScenarios.filter(
  (scenario) => !process.env.SCENARIOS || process.env.SCENARIOS.split(",").includes(scenario),
);

interface Cost {
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  /** Self time per source file and function, in milliseconds, from the CPU profile. */
  profile: Record<string, number>;
  /** Renders and layers the scheduler completed during the scenario. */
  renders: Record<string, number>;
}

/** Scheduler counters reported per scenario. */
const RENDER_KEYS = ["base", "detail", "text", "textUpdates", "annotations", "cancelled"];

const METRICS = {
  TaskDuration: "taskMs",
  ScriptDuration: "scriptMs",
  LayoutDuration: "layoutMs",
  RecalcStyleDuration: "styleMs",
} as const;

async function metrics(session: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = (await session.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(list.map(({ name, value }) => [name, value]));
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

/** Self time per "file › function", skipping idle and program time. */
function attribute(profile: {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}): Record<string, number> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals: Record<string, number> = {};
  profile.samples.forEach((id, index) => {
    const node = nodes.get(id);
    if (!node) return;
    const { functionName, url } = node.callFrame;
    if (functionName === "(idle)" || functionName === "(program)" || functionName === "(root)") {
      return;
    }
    const source = url ? (url.split("/").pop() ?? url).replace(/-[\w-]{8}\.js$/, ".js") : "";
    const key = `${source || "(browser)"} › ${functionName || "(anonymous)"}`;
    totals[key] = (totals[key] ?? 0) + (profile.timeDeltas[index + 1] ?? 0) / 1000;
  });
  return totals;
}

/** Waits until the visible pages are sharp, then lets idle work (text, links) finish. */
const settle = async (page: Page) => {
  await page.waitForFunction(
    () =>
      ((window as unknown as { __viewer?: { sharpness(): number } }).__viewer?.sharpness() ?? 0) >=
      0.99,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1500);
};

const stats = (page: Page) =>
  page.evaluate(
    () =>
      ({
        ...(window as unknown as { __viewer: { stats: Record<string, number> } }).__viewer.stats,
      }) as Record<string, number>,
  );

async function run(page: Page, session: CDPSession, scenario: Scenario): Promise<Cost> {
  const statsBefore = await stats(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  await session.send("Profiler.start");
  const before = await metrics(session);
  if (scenario === "zoom") {
    for (const factor of zoomSteps) {
      await page.evaluate((factor) => {
        (window as unknown as { __viewer: { zoomBy(factor: number): void } }).__viewer.zoomBy(
          factor,
        );
      }, factor);
      await page.waitForTimeout(600);
    }
  } else {
    await page.evaluate(
      async ({ speed, durationMs }) => {
        const { scroller, store } = (
          window as unknown as {
            __viewer: { scroller: HTMLElement; store: { get(): { scrollMode: string } } };
          }
        ).__viewer;
        // Pages follow each other sideways in "horizontal" mode.
        const sideways = store.get().scrollMode === "horizontal";
        const start = performance.now();
        const from = sideways ? scroller.scrollLeft : scroller.scrollTop;
        await new Promise<void>((resolve) => {
          const tick = () => {
            const elapsed = performance.now() - start;
            if (elapsed >= durationMs) return resolve();
            const position = from + (speed * elapsed) / 1000;
            if (sideways) scroller.scrollLeft = position;
            else scroller.scrollTop = position;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { speed, durationMs },
    );
  }
  await settle(page);
  const after = await metrics(session);
  const { profile } = (await session.send("Profiler.stop")) as {
    profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };
  };
  const statsAfter = await stats(page);
  const renders = Object.fromEntries(
    Object.keys(statsAfter).map((key) => [key, (statsAfter[key] ?? 0) - (statsBefore[key] ?? 0)]),
  );
  const cost = { profile: attribute(profile), renders } as Cost;
  for (const [name, key] of Object.entries(METRICS)) {
    cost[key] = ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  }
  return cost;
}

const power = assertMeasurementPower();
const loadAtStart = loadavg()[0] ?? 0;
const launched = await launchBrowser("chromium");
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4178, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4178/";
const results: { variant: string; scenario: Scenario; run: number; cost?: Cost; error?: string }[] =
  [];
try {
  for (const scenario of scenarios) {
    for (let index = 0; index < runs; index++) {
      for (const variant of variants) {
        const outcome = await measureInTurn(launched, async (browser) => {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: dpr,
          });
          try {
            const page = await context.newPage();
            const query = new URLSearchParams({
              engine: variant.engine,
              hwa: "1",
              text: variant.text ? "1" : "0",
              links: variant.links ? "1" : "0",
              scroll: variant.scroll,
              file,
            });
            for (const [key, value] of new URLSearchParams(variant.extra)) query.set(key, value);
            await page.goto(`${baseUrl}?${query}`);
            await settle(page);
            if (startScale !== null) {
              await page.evaluate((scale) => {
                (
                  window as unknown as { __viewer: { setScale(scale: number | string): void } }
                ).__viewer.setScale(scale);
              }, startScale);
              await settle(page);
            }
            const session = await context.newCDPSession(page);
            await session.send("Performance.enable");
            return { cost: await run(page, session, scenario) };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          } finally {
            await context.close();
          }
        });
        results.push({ variant: variant.label, scenario, run: index, ...outcome });
        const { cost } = outcome;
        console.log(
          `${scenario} · ${variant.label} · run ${index + 1}/${runs}: ${
            cost
              ? `task ${cost.taskMs.toFixed(0)} ms, script ${cost.scriptMs.toFixed(0)}, layout ${cost.layoutMs.toFixed(0)}, style ${cost.styleMs.toFixed(0)}`
              : `ERROR ${outcome.error}`
          }`,
        );
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}

const median = (values: number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const summaries = scenarios.flatMap((scenario) =>
  variants.map((variant) => {
    const ok = results.filter(
      (result) => result.scenario === scenario && result.variant === variant.label && result.cost,
    );
    const costs = ok.map((result) => result.cost as Cost);
    const keys = new Set(costs.flatMap((cost) => Object.keys(cost.profile)));
    const profile = Object.fromEntries(
      [...keys]
        .map((key) => [key, median(costs.map((cost) => cost.profile[key] ?? 0))] as const)
        .filter(([, value]) => value >= 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    );
    return {
      scenario,
      variant: variant.label,
      runs: ok.length,
      taskMs: median(costs.map((cost) => cost.taskMs)),
      scriptMs: median(costs.map((cost) => cost.scriptMs)),
      layoutMs: median(costs.map((cost) => cost.layoutMs)),
      styleMs: median(costs.map((cost) => cost.styleMs)),
      renders: Object.fromEntries(
        RENDER_KEYS.map((key) => [key, median(costs.map((cost) => cost.renders[key] ?? 0))]),
      ),
      profile,
    };
  }),
);

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${cpus().length} logical cores)`,
  browser: launched.label,
  power,
  loadAverage: { start: loadAtStart, end: loadavg()[0] ?? 0 },
  turnTaking: { ...turnTaking },
  code: label,
  settings: {
    file,
    dpr,
    startScale,
    scrollModes,
    zoom: zoomSteps.join(","),
    speed,
    durationMs,
    runs,
  },
};
const round = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `${output}.json`),
  `${JSON.stringify({ environment, summaries }, round, 2)}\n`,
);
const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(0) : "—");
// The settings this run was given, so the report says how to repeat it.
const reproduceEnv = [
  "SCENARIOS",
  "VARIANTS",
  "TEXT",
  "LINKS",
  "SCROLL",
  "FILE",
  "DPR",
  "START_SCALE",
  "ZOOM",
  "SPEED",
  "DURATION",
  "RUNS",
  "QUERIES",
]
  .filter((name) => process.env[name] !== undefined)
  .map((name) => {
    const value = process.env[name] ?? "";
    return `${name}=${/^[\w.,-]+$/.test(value) ? value : `'${value}'`} `;
  })
  .join("");
const markdown = [
  `# ParaPDF runtime prototype: main-thread cost, ${environment.browser}`,
  "",
  `- Run at: ${environment.runAt}`,
  ...(label ? [`- Code: ${label}`] : []),
  `- Machine: ${environment.os}, ${environment.cpu}; power: ${power.source === "ac" && !power.lowPowerMode ? "AC" : `**${power.source}; not comparable with AC runs**`}; one-minute load average ${environment.loadAverage.start.toFixed(1)} at the start, ${environment.loadAverage.end.toFixed(1)} at the end; ${turnTakingSummary()}.`,
  `- Method: ${file} at ${startScale === null ? "the fit-width zoom" : typeof startScale === "string" ? `the ${startScale} zoom` : `${startScale} CSS px per point`}${process.env.SCROLL ? ` in ${scrollModes.join(" or ")} scroll mode` : ""} on a 1280×900 viewport at devicePixelRatio ${dpr}, once the first page is sharp and idle work is done. Zoom: ${zoomSteps.length === 1 ? `one ${zoomSteps[0]}× step` : `${zoomSteps.length} steps of ${[...new Set(zoomSteps)].join("×, ")}× 600 ms apart`}. Slow scroll: ${speed} CSS px per second for ${durationMs / 1000} seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of ${runs} runs.`,
  `- Reproduce: \`pnpm --filter @parapdf/prototype exec vite build --minify false && ${reproduceEnv}node examples/prototype/scripts/main-thread-bench.ts\``,
  "",
  "| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |",
  "|---|---|---:|---:|---:|---:|---:|",
  ...summaries.map(
    (summary) =>
      `| ${summary.scenario} | ${summary.variant} | ${fmt(summary.taskMs)} | ${fmt(summary.scriptMs)} | ${fmt(summary.layoutMs)} | ${fmt(summary.styleMs)} | ${RENDER_KEYS.map((key) => fmt(summary.renders[key] ?? Number.NaN)).join(" / ")} |`,
  ),
  "",
  ...summaries.flatMap((summary) => [
    `## ${summary.scenario}, ${summary.variant}: JavaScript self time (ms)`,
    "",
    "| File › function | ms |",
    "|---|---:|",
    ...Object.entries(summary.profile).map(([key, value]) => `| ${key} | ${value.toFixed(1)} |`),
    "",
  ]),
];
writeFileSync(join(resultsDir, `${output}.md`), `${markdown.join("\n")}\n`);
console.log(`\nWrote ${join(resultsDir, `${output}.md`)}`);
