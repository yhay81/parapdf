/**
 * Minimal reproduction, for an upstream pdf.js issue, of text runs that end
 * short of their glyphs or past them when a PDF declares no /Lang: pdf.js's
 * `TextLayer` measures each run on a hidden canvas whose `lang` attribute is
 * the text content's language, set to "" (an unknown language) when the PDF
 * has none, while the runs inherit the page's language. The generic font
 * families the runs use resolve by language, so the canvas and the runs can
 * resolve different fonts, and each run is scaled by the ratio of the wrong
 * width.
 *
 * textlayer-lang-repro.html renders a page and its text layer with pdf.js's
 * display API only (`getDocument`, `PDFPageProxy.render`, `TextLayer`) and
 * reports each run's width against its text item's. This script serves it
 * and runs it for released pdfjs-dist and a pdf.js master build, under page
 * languages "en" and "ja", with and without the workaround that gives text
 * content without a language the page's. It also opens pdf.js master's own
 * viewer (web/viewer.html) and measures the runs of its first page the same
 * way, as it is hosted (no `lang` on its root element) and with a `lang` set
 * on the root element before the document loads, as Firefox's built-in
 * viewer has one from its UI locale and as pages embedding pdf.js's viewer
 * components often do. Each job opens the document in a fresh browser
 * context.
 *
 * Usage: node bench/scripts/textlayer-lang-repro.ts
 * Environment: BROWSER (chromium, webkit, or firefox), BUILDS
 * (pdfjs-dist,master), LANGS (en,ja), FILL (0,1), FILES
 * (compressed.tracemonkey-pldi-09.pdf,bill-hr815.pdf), VIEWER_LANGS
 * (none,en,ja: the viewer root element's lang; empty skips the viewer), PDFJS_MASTER (a pdf.js build
 * directory holding generic/; default bench/vendor/pdf.js/build), OUTPUT (JSON
 * path; default bench/results/raw/textlayer-lang-<browser>.json), SHOTS=1 to
 * save screenshots with the runs shaded next to it, and SERVE=1 to only
 * serve the page and print its URLs, for browsers outside Playwright.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { arch, platform, release } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import {
  browserFromEnv,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTakingSummary,
} from "./browsers.ts";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const masterBuild = process.env.PDFJS_MASTER ?? join(benchDir, "vendor/pdf.js/build");
const masterDir = join(masterBuild, "generic");
const hasMaster = existsSync(join(masterDir, "build/pdf.mjs"));
const pdfjsDist = join(benchDir, "node_modules/pdfjs-dist");

const list = (name: string, fallback: string) =>
  (process.env[name] ?? fallback).split(",").filter(Boolean);
const browserName = browserFromEnv();
const builds = list("BUILDS", hasMaster ? "pdfjs-dist,master" : "pdfjs-dist");
if (!hasMaster && builds.includes("master")) {
  throw new Error(`No pdf.js build in ${masterDir}; set PDFJS_MASTER or run build-pdfjs-next.sh`);
}
const langs = list("LANGS", "en,ja");
const fills = list("FILL", "0,1").map((value) => value === "1");
const files = list("FILES", "compressed.tracemonkey-pldi-09.pdf,bill-hr815.pdf");
const viewerLangs = hasMaster ? list("VIEWER_LANGS", "none,en,ja") : [];
const shots = process.env.SHOTS === "1";
const output =
  process.env.OUTPUT ?? join(benchDir, "results/raw", `textlayer-lang-${browserName}.json`);

const buildPaths: Record<string, { lib: string; css: string; assets: string }> = {
  "pdfjs-dist": {
    lib: "/pdfjs-dist/build/pdf.mjs",
    css: "/pdfjs-dist/web/pdf_viewer.css",
    assets: "/pdfjs-dist/",
  },
  master: { lib: "/master/build/pdf.mjs", css: "/master/web/viewer.css", assets: "/master/web/" },
};

// pdf.js's own test document ships with its viewer; the corpus has the rest.
const roots: Record<string, string> = {
  "/pdfjs-dist/": pdfjsDist,
  "/master/": masterDir,
  "/pdf/": join(benchDir, "corpus"),
};
const pdfPath = (name: string) =>
  name === "compressed.tracemonkey-pldi-09.pdf"
    ? "/master/web/compressed.tracemonkey-pldi-09.pdf"
    : `/pdf/${name}`;
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ftl": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  let source: string | undefined;
  if (path === "/") source = join(benchDir, "scripts/textlayer-lang-repro.html");
  else if (path === "/blank") {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html>");
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
    response.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

interface Ratios {
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}
interface PageResult {
  environment: Record<string, unknown>;
  pageLang: string | null;
  pdfLang: string | null;
  hiddenCanvasLangs: (string | null)[];
  layerFamilies: string[];
  runs: number;
  widthRatio: Ratios | null;
  families: { family: string; emptyLang: number; inherited: number }[];
}

interface PageJob {
  kind: "page";
  build: string;
  file: string;
  lang: string;
  fill: boolean;
}
interface ViewerJob {
  kind: "viewer";
  /** The root element's lang; "none" leaves it without one, as hosted. */
  lang: string;
  file: string;
}
type Job = PageJob | ViewerJob;

function pageUrl(job: PageJob, show = false): string {
  const build = buildPaths[job.build];
  if (!build) throw new Error(`Unknown build "${job.build}"; use ${Object.keys(buildPaths)}`);
  const query = new URLSearchParams({
    lib: build.lib,
    css: build.css,
    assets: build.assets,
    file: pdfPath(job.file),
    lang: job.lang,
    fill: job.fill ? "1" : "0",
  });
  if (show) query.set("show", "1");
  return `${baseUrl}?${query}`;
}
const viewerUrl = (job: ViewerJob) =>
  `${baseUrl}master/web/viewer.html?file=${encodeURIComponent(pdfPath(job.file))}#page=1`;

/**
 * The runs of the viewer's first page against their items, as the repro page
 * measures its own: pdf.js's viewer lays them out with the same TextLayer.
 */
const measureViewer = (page: Page) =>
  page.evaluate(async () => {
    const app = (
      window as unknown as {
        PDFViewerApplication: {
          pdfDocument: {
            getPage(n: number): Promise<{
              getTextContent(options: object): Promise<{
                items: { str?: string; width: number; height: number }[];
                lang: string | null;
              }>;
            }>;
          };
          pdfViewer: { currentScale: number };
        };
      }
    ).PDFViewerApplication;
    // currentScale is relative to 96 CSS pixels per inch.
    const scale = (app.pdfViewer.currentScale * 96) / 72;
    const pdfPage = await app.pdfDocument.getPage(1);
    const { items, lang } = await pdfPage.getTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    const layer = document.querySelector('.page[data-page-number="1"] .textLayer');
    const spans = [...(layer?.querySelectorAll("span:not(.markedContent)") ?? [])];
    const ratios: number[] = [];
    let cursor = 0;
    for (const item of items) {
      if (!item.str || item.str.length < 2) continue;
      while (cursor < spans.length && spans[cursor]?.textContent !== item.str) cursor++;
      const span = spans[cursor++];
      if (!span) break;
      const expected = (item.width || item.height) * scale;
      if (expected < 1) continue;
      ratios.push(span.getBoundingClientRect().width / expected);
    }
    const sorted = [...ratios].sort((a, b) => a - b);
    const quantile = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
    const hidden = [...document.body.querySelectorAll(":scope > canvas")].map((element) =>
      element.getAttribute("lang"),
    );
    const { version, build } = (
      globalThis as unknown as { pdfjsLib: { version: string; build: string } }
    ).pdfjsLib;
    return {
      environment: {
        userAgent: navigator.userAgent,
        languages: navigator.languages,
        pdfjs: `${version} (${build})`,
      },
      pageLang: document.documentElement.getAttribute("lang"),
      viewerLang: document.getElementById("viewer")?.getAttribute("lang") ?? null,
      pdfLang: lang,
      hiddenCanvasLangs: hidden,
      layerFamilies: [...new Set(spans.map((span) => (span as HTMLElement).style.fontFamily))],
      scale,
      runs: ratios.length,
      widthRatio: ratios.length
        ? {
            median: quantile(0.5),
            p10: quantile(0.1),
            p90: quantile(0.9),
            min: sorted[0] as number,
            max: sorted.at(-1) as number,
          }
        : null,
    };
  });

async function runJob(browser: Browser, job: Job) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await restoreScaleFactor(page, `${baseUrl}blank`);
    let result: unknown;
    let shot: string | null = null;
    if (job.kind === "page") {
      const url = pageUrl(job, shots);
      await page.goto(url);
      await page.waitForFunction(() => "repro" in window, undefined, { timeout: 60_000 });
      result = await page.evaluate(() => (window as unknown as { repro: PageResult }).repro);
      if (shots) {
        shot = join(
          benchDir,
          "results/raw",
          `textlayer-lang-${browserName}-${job.build}-${job.file.replace(/\.pdf$/, "")}-${job.lang}${job.fill ? "-filled" : ""}.png`,
        );
        await page.locator("#page").screenshot({ path: shot });
      }
    } else {
      if (job.lang !== "none") {
        // Before the viewer's scripts run, as Firefox's built-in viewer gets it.
        await page.addInitScript((lang) => {
          document.addEventListener(
            "readystatechange",
            () => {
              document.documentElement.lang = lang;
            },
            { once: true },
          );
        }, job.lang);
      }
      await page.goto(viewerUrl(job));
      await page.waitForSelector('.page[data-page-number="1"] .textLayer .endOfContent', {
        state: "attached",
        timeout: 60_000,
      });
      result = await measureViewer(page);
      if (shots) {
        // The viewer's CSP refuses style elements; inline styles still apply.
        await page.evaluate(() => {
          for (const span of document.querySelectorAll<HTMLElement>(".textLayer span")) {
            span.style.background = "rgb(255 0 0 / 0.2)";
          }
        });
        shot = join(
          benchDir,
          "results/raw",
          `textlayer-lang-${browserName}-viewer-${job.file.replace(/\.pdf$/, "")}-${job.lang}.png`,
        );
        await page.locator('.page[data-page-number="1"]').screenshot({ path: shot });
      }
    }
    return { ...job, result, shot, errors: [...new Set(errors)] };
  } finally {
    await context.close();
  }
}

const jobList: Job[] = [
  ...builds.flatMap((build) =>
    files.flatMap((file) =>
      langs.flatMap((lang) =>
        fills.map((fill): Job => ({ kind: "page", build, file, lang, fill })),
      ),
    ),
  ),
  ...viewerLangs.map(
    (lang): Job => ({ kind: "viewer", lang, file: "compressed.tracemonkey-pldi-09.pdf" }),
  ),
];
if (process.env.SERVE) {
  for (const job of jobList) {
    if (job.kind === "page") {
      console.log(
        `${job.build}, ${job.file}, page lang ${job.lang}${job.fill ? ", filled" : ""}:\n  ${pageUrl(job, true)}`,
      );
    } else {
      console.log(
        `pdf.js master's viewer${job.lang === "none" ? "" : ` (the driver sets lang="${job.lang}" on its root element before the viewer's scripts run, which a browser needs an extension or a local edit of viewer.html for)`}:\n  ${viewerUrl(job)}`,
      );
    }
  }
  console.log("\nServing until interrupted.");
  await new Promise<never>(() => {});
}

const launched = await launchBrowser(browserName);
const jobs: Awaited<ReturnType<typeof runJob>>[] = [];
try {
  for (const job of jobList) {
    jobs.push(await measureInTurn(launched, (browser) => runJob(browser, job)));
  }
} finally {
  await launched.close();
  server.close();
}

const environment = {
  runAt: new Date().toISOString(),
  os: `${platform()} ${release()} ${arch()}`,
  browser: launched.label,
  headless: launched.headless,
  systemLanguage: process.env.LANG ?? null,
  turnTaking: turnTakingSummary(),
  pdfjsDist,
  masterDir: hasMaster ? masterDir : null,
};
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify({ environment, jobs }, null, 1)}\n`);

const percent = (ratio: number | undefined) =>
  ratio === undefined ? "–" : `${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(1)}%`;
const lines = [
  `${launched.label}${launched.headless ? " (headless)" : ""}, ${environment.os}; ${environment.turnTaking}.`,
  "",
  "Width of each text run of two or more characters against its text item's width: median, and 10th to 90th percentile.",
  "",
  "| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const job of jobs) {
  const result = job.result as PageResult & { viewerLang?: string | null };
  const ratio = result.widthRatio;
  const where = job.kind === "page" ? "repro page" : "pdf.js viewer";
  lines.push(
    `| ${where} | ${result.environment.pdfjs} | ${job.file} | ${JSON.stringify(result.pageLang)} | ${JSON.stringify(result.pdfLang)} | ${result.hiddenCanvasLangs.map((value) => JSON.stringify(value)).join(", ")} | ${job.kind === "page" && job.fill ? "yes" : "no"} | ${result.runs} | ${percent(ratio?.median)} | ${percent(ratio?.p10)} to ${percent(ratio?.p90)} |`,
  );
}
lines.push(
  "",
  'Canvas measureText of a 100px pangram in each generic family, on a canvas with lang="" and on one inheriting the page\'s language:',
  "",
);
for (const lang of langs) {
  const job = jobs.find((entry) => entry.kind === "page" && !entry.fill && entry.lang === lang);
  const result = job?.result as PageResult | undefined;
  if (!result) continue;
  lines.push(
    `- page lang ${JSON.stringify(result.pageLang)}: ${result.families.map((entry) => `${entry.family} ${entry.emptyLang} against ${entry.inherited} px`).join(", ")}`,
  );
}
const messages = jobs.filter((job) => job.errors.length);
if (messages.length) {
  lines.push("", "Console errors:");
  for (const job of messages)
    lines.push(`- ${JSON.stringify({ ...job, result: undefined })}: ${job.errors.join(" / ")}`);
}
console.log(`\n${lines.join("\n")}\n\nWrote ${output}`);
