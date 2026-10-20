/**
 * Minimal reproduction, for an upstream pdf.js issue, of an upward drag
 * selection that selects all of the page above: in pdf.js's viewer, in WebKit
 * and Firefox, a drag that starts in page 2's text and enters page 1 through
 * the blank space below its last line selects from page 1's start, while
 * Chromium selects up to the pointer.
 *
 * selection-drag-repro.html shows the document with pdf.js's viewer
 * components (`pdf_viewer.mjs`, whose `TextLayerBuilder` handles selections:
 * the display API alone has no selection handling) or, with `mode=layers`,
 * with the display API's `TextLayer` alone. This script serves it and drags
 * with Playwright's mouse in it for released pdfjs-dist and, when a pdf.js
 * build is given, master's components and master's full viewer
 * (web/viewer.html, the online demo's build). Each job opens the document in
 * a fresh browser context, brings the gap between pages 1 and 2 to the middle
 * of the viewer, presses at the end of page 2's third line, moves to the
 * middle of the gap in 10 steps and then 20 CSS pixels below page 1's last
 * line in 5, and releases.
 *
 * Usage: node bench/scripts/selection-drag-repro.ts
 * Environment: BROWSER (chromium, webkit, or firefox), TARGETS
 * (components,layers,master-components,master-viewer; also online-viewer,
 * pdf.js's online demo at mozilla.github.io, which opens only its own test
 * document), FILES
 * (compressed.tracemonkey-pldi-09.pdf,usrguide.pdf), ZOOM (1, which is 100%,
 * or page-width), PDFJS_MASTER (a pdf.js
 * build directory holding generic/ and components/; default
 * bench/vendor/pdf.js/build), OUTPUT (JSON path; default
 * bench/results/raw/selection-drag-<browser>.json), SHOTS=1 to save a
 * screenshot of each selection next to it, and SERVE=1 to only serve the page
 * and print its URLs, for browsers outside Playwright.
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
const componentsDir = join(masterBuild, "components");
const hasMaster = existsSync(join(masterDir, "build/pdf.mjs"));
const hasComponents = hasMaster && existsSync(join(componentsDir, "pdf_viewer.mjs"));
const pdfjsDist = join(benchDir, "node_modules/pdfjs-dist");

const list = (name: string, fallback: string) =>
  (process.env[name] ?? fallback).split(",").filter(Boolean);
const browserName = browserFromEnv();
const defaultTargets = [
  "components",
  "layers",
  ...(hasComponents ? ["master-components"] : []),
  ...(hasMaster ? ["master-viewer"] : []),
];
const targets = list("TARGETS", defaultTargets.join(","));
const files = list("FILES", "compressed.tracemonkey-pldi-09.pdf,usrguide.pdf");
const shots = process.env.SHOTS === "1";
/** The viewer's zoom: a number (1 is 100%) or page-width. */
const zoom = process.env.ZOOM ?? "1";
const output =
  process.env.OUTPUT ?? join(benchDir, "results/raw", `selection-drag-${browserName}.json`);

const roots: Record<string, string> = {
  "/pdfjs-dist/": pdfjsDist,
  "/master/": masterDir,
  "/components/": componentsDir,
  "/pdf/": join(benchDir, "corpus"),
};
// pdf.js's own test document ships with its viewer; the corpus has the rest.
const pdfPath = (name: string) =>
  name === "compressed.tracemonkey-pldi-09.pdf"
    ? "/master/web/compressed.tracemonkey-pldi-09.pdf"
    : `/pdf/${name}`;
if (!hasMaster && files.includes("compressed.tracemonkey-pldi-09.pdf")) {
  throw new Error(`No pdf.js build, with its test document, in ${masterDir}; set PDFJS_MASTER`);
}
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
  if (path === "/") source = join(benchDir, "scripts/selection-drag-repro.html");
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

interface Job {
  target: string;
  file: string;
}

/** pdf.js's online demo, built from master; it opens only its own test document. */
const onlineViewer = "https://mozilla.github.io/pdf.js/web/viewer.html";

function targetUrl(job: Job): string {
  if (job.target === "online-viewer") {
    if (job.file !== "compressed.tracemonkey-pldi-09.pdf") {
      throw new Error("The online viewer opens only compressed.tracemonkey-pldi-09.pdf");
    }
    return `${onlineViewer}#zoom=${zoom === "page-width" ? zoom : Number(zoom) * 100}`;
  }
  const file = pdfPath(job.file);
  if (job.target === "master-viewer") {
    return `${baseUrl}master/web/viewer.html?file=${encodeURIComponent(file)}#zoom=${zoom === "page-width" ? zoom : Number(zoom) * 100}`;
  }
  const query = new URLSearchParams({ file, scale: zoom });
  if (job.target === "master-components") {
    query.set("lib", "/master/build/pdf.mjs");
    query.set("viewer", "/components/pdf_viewer.mjs");
    query.set("css", "/components/pdf_viewer.css");
    query.set("assets", "/master/web/");
  } else {
    query.set("lib", "/pdfjs-dist/build/pdf.mjs");
    query.set("viewer", "/pdfjs-dist/web/pdf_viewer.mjs");
    query.set("css", "/pdfjs-dist/web/pdf_viewer.css");
    query.set("assets", "/pdfjs-dist/");
    if (job.target === "layers") query.set("mode", "layers");
    else if (job.target !== "components") throw new Error(`Unknown target "${job.target}"`);
  }
  return `${baseUrl}?${query}`;
}

interface TextLine {
  top: number;
  height: number;
  left: number;
  right: number;
  /** Non-space characters. */
  chars: number;
}
interface PageBox {
  lines: TextLine[];
  top: number;
  bottom: number;
}

/**
 * A page's box and its text lines in the text layer's order, which is the
 * order a selection follows, in viewport coordinates: consecutive runs on the
 * same baseline form a line, so the columns of a two-column page stay apart.
 */
const pageLines = (page: Page, number: number) =>
  page.evaluate((number): PageBox | null => {
    const pageDiv = document.querySelector(`.page[data-page-number="${number}"]`);
    if (!pageDiv) return null;
    const lines: TextLine[] = [];
    for (const span of pageDiv.querySelectorAll(".textLayer span:not(.markedContent)")) {
      const chars = (span.textContent ?? "").replace(/\s/g, "").length;
      if (chars === 0) continue;
      const rect = span.getBoundingClientRect();
      const line = lines.at(-1);
      if (line && Math.abs(line.top - rect.top) < rect.height / 2 && rect.left >= line.left) {
        line.right = Math.max(line.right, rect.right);
        line.chars += chars;
      } else {
        lines.push({
          top: rect.top,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          chars,
        });
      }
    }
    const box = pageDiv.getBoundingClientRect();
    return { lines, top: box.top, bottom: box.bottom };
  }, number);

const selection = (page: Page) =>
  page.evaluate(() => {
    const value = window.getSelection();
    const text = value?.toString() ?? "";
    // Where the selection starts: the page holding the first selected node.
    const range = value?.rangeCount ? value.getRangeAt(0) : null;
    const startNode = range?.startContainer ?? null;
    const startElement =
      startNode instanceof Element ? startNode : (startNode?.parentElement ?? null);
    // Whether the selection reaches page 1's first run of text.
    const firstRun = [
      ...document.querySelectorAll(
        '.page[data-page-number="1"] .textLayer span:not(.markedContent)',
      ),
    ].find((span) => (span.textContent ?? "").trim());
    return {
      chars: text.replace(/\s/g, "").length,
      rangeCount: value?.rangeCount ?? 0,
      page1Start: Boolean(firstRun && value?.containsNode(firstRun, true)),
      startPage: startElement?.closest(".page")?.getAttribute("data-page-number") ?? null,
      head: text.trim().slice(0, 50),
    };
  });

const waitForTextLayers = (page: Page) =>
  page.waitForFunction(
    () =>
      [1, 2].every((number) =>
        document.querySelector(
          `.page[data-page-number="${number}"] .textLayer span:not(.markedContent)`,
        ),
      ),
    undefined,
    { timeout: 60_000 },
  );

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
    await page.goto(targetUrl(job));
    await waitForTextLayers(page);
    const pdfjs = await page.evaluate(() => {
      const lib = (globalThis as unknown as { pdfjsLib?: { version: string; build: string } })
        .pdfjsLib;
      return lib ? `${lib.version} (${lib.build})` : "unknown";
    });
    // Page 1's last line and page 2's third line in view, the space between
    // them in the middle of the viewer.
    // The viewer applies its zoom after the first pages render.
    await page.waitForTimeout(1000);
    const before = [await pageLines(page, 1), await pageLines(page, 2)];
    const [lastBefore, thirdBefore] = [before[0]?.lines.at(-1), before[1]?.lines[2]];
    if (!lastBefore || !thirdBefore) throw new Error("pages 1 and 2 have too few text lines");
    await page.evaluate(
      (middle) => {
        const container = document.getElementById("viewerContainer") as HTMLElement;
        const box = container.getBoundingClientRect();
        container.scrollTop += middle - box.top - container.clientHeight / 2;
      },
      (lastBefore.top + thirdBefore.top + thirdBefore.height) / 2,
    );
    await waitForTextLayers(page);
    await page.waitForTimeout(500);
    const upper = await pageLines(page, 1);
    const lower = await pageLines(page, 2);
    const viewer = await page.evaluate(() =>
      (document.getElementById("viewerContainer") as HTMLElement).getBoundingClientRect(),
    );
    const third = lower?.lines[2];
    const last = upper?.lines.at(-1);
    if (!upper || !lower || !third || !last) throw new Error("pages 1 and 2 have no text lines");
    const gesture = {
      start: { x: third.right - 1, y: third.top + third.height / 2 },
      gap: { x: (last.left + last.right) / 2, y: (upper.bottom + lower.top) / 2 },
      end: { x: (last.left + last.right) / 2, y: last.top + last.height + 20 },
    };
    if (gesture.end.y >= upper.bottom) throw new Error("page 1 has no margin below its last line");
    if (gesture.end.y <= viewer.top || gesture.start.y >= viewer.bottom) {
      throw new Error(
        `${job.file}: page 1's last line and page 2's third line do not fit in the viewer (${JSON.stringify({ gesture, viewer, before: [lastBefore, thirdBefore] })})`,
      );
    }
    await page.mouse.move(gesture.start.x, gesture.start.y);
    await page.mouse.down();
    await page.mouse.move(gesture.gap.x, gesture.gap.y, { steps: 10 });
    const inGap = await selection(page);
    await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 5 });
    const beforeRelease = await selection(page);
    await page.mouse.up();
    const selected = await selection(page);
    let shot: string | null = null;
    if (shots) {
      shot = join(
        benchDir,
        "results/raw",
        `selection-drag-${browserName}-${job.target}-${job.file.replace(/\.pdf$/, "")}.png`,
      );
      await page.screenshot({ path: shot });
    }
    const count = (lines: TextLine[], from: number, to?: number) =>
      lines.slice(from, to).reduce((sum, line) => sum + line.chars, 0);
    return {
      ...job,
      pdfjs,
      gesture,
      expected: {
        // Page 2's first three lines, plus at most page 1's last line.
        min: count(lower.lines, 0, 3),
        max: count(lower.lines, 0, 3) + last.chars,
        page1: count(upper.lines, 0),
      },
      inGap,
      beforeRelease,
      selected,
      shot,
      errors: [...new Set(errors)],
    };
  } finally {
    await context.close();
  }
}

const jobList: Job[] = targets.flatMap((target) => files.map((file) => ({ target, file })));
if (process.env.SERVE) {
  for (const job of jobList) console.log(`${job.target}, ${job.file}:\n  ${targetUrl(job)}`);
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
  turnTaking: turnTakingSummary(),
  pdfjsDist,
  masterBuild: hasMaster ? masterBuild : null,
};
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify({ environment, jobs }, null, 1)}\n`);

const targetNames: Record<string, string> = {
  components: "pdf_viewer.mjs components",
  layers: "display API TextLayer only",
  "master-components": "pdf_viewer.mjs components",
  "master-viewer": "web/viewer.html",
  "online-viewer": "online demo (mozilla.github.io)",
};
const lines = [
  `${launched.label}${launched.headless ? " (headless)" : ""}, ${environment.os}; ${environment.turnTaking}.`,
  "",
  "Non-space characters selected by an upward drag from the end of page 2's third line, over the gap, into the blank space 20 CSS px below page 1's last line (lines in the text layer's order). Expected: page 2's first three lines, plus at most page 1's last line.",
  "",
  "| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const job of jobs) {
  lines.push(
    `| ${targetNames[job.target] ?? job.target} | ${job.pdfjs} | ${job.file} | ${job.inGap.chars} | ${job.beforeRelease.chars} | ${job.selected.chars} | ${job.expected.min}–${job.expected.max} | ${job.expected.page1} | ${job.selected.page1Start ? "yes" : "no"} |`,
  );
}
const messages = jobs.filter((job) => job.errors.length);
if (messages.length) {
  lines.push("", "Console errors:");
  for (const job of messages) lines.push(`- ${job.target}, ${job.file}: ${job.errors.join(" / ")}`);
}
console.log(`\n${lines.join("\n")}\n\nWrote ${output}`);
