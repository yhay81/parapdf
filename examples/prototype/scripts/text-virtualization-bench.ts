/**
 * Evaluation benchmark for issue #10: whole-document browser find, select-all,
 * and cross-page selection with virtualized pages.
 *
 * Compares four strategies on bill-hr815.pdf (110 pages) and
 * synthetic-text-1000.pdf (1,000 pages) at 1280×900, devicePixelRatio 2,
 * fit-width zoom, with annotation layers off and maxCanvasPixels capped to
 * 24 MP so canvas allocation stays bounded while text DOM strategies vary:
 *
 * - virtualized: default overscan (2), text layers only on mounted pages;
 * - bounded-20: overscan 20 (~22 mounted pages around the viewport);
 * - until-found: default overscan (2) plus one <div hidden="until-found"> plain
 *   text block per unmounted page populated from getText(session);
 * - all-text: overscan equal to pageCount so every page mounts a text layer.
 *
 * Also checks browser behavior for hidden="until-found", window.find() across
 * hyphenated and CJK line breaks, select-all vs getText(session), and DOM
 * Selection behavior when endpoints cross unmounted pages.
 *
 * Usage:
 *   pnpm --filter @parapdf/prototype build
 *   BROWSER=chromium node examples/prototype/scripts/text-virtualization-bench.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { preview } from "vite";
import {
  assertMeasurementPower,
  browserFromEnv,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTaking,
  turnTakingSummary,
} from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(exampleDir, "results");
const browserName = browserFromEnv();
const engine = process.env.ENGINE ?? "pdfjs";
const runs = Number(process.env.RUNS ?? "3");
const files = (process.env.FILES ?? "bill-hr815.pdf,synthetic-text-1000.pdf").split(",");
const output = process.env.OUTPUT ?? `text-virtualization-${browserName}`;
const viewport = { width: 1280, height: 900 };
const maxCanvasPixels = 25_165_824;

type Strategy = "virtualized" | "bounded-20" | "until-found" | "all-text";
const strategies = (process.env.STRATEGIES ?? "virtualized,bounded-20,until-found,all-text").split(
  ",",
) as Strategy[];

const prototypePackage = JSON.parse(readFileSync(join(exampleDir, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const pdfjsVersion = prototypePackage.dependencies["pdfjs-dist"];

interface IdleBaseline {
  timerLagP50Ms: number;
  timerLagP95Ms: number;
  frameIntervalMs: number;
}

interface RunMetrics {
  firstPaintMs: number;
  textReadyMs: number;
  mountedPages: number;
  builtTextLayers: number;
  domNodes: number;
  textSpans: number;
  axRegions: number;
  selectAllMs: number;
  selectAllChars: number;
  zoomCommitMs: number;
  zoomReactCommits: number;
  scrollBlockedMs: number;
  scrollLagP95Ms: number;
  scrollMaxLagMs: number;
  droppedFrames: number;
  scrollFrames: number;
  scrollReactCommits: number;
  canvasMiB: number;
  jsHeapMiB: number | null;
  cdpNodes: number | null;
  axTreeNodes: number | null;
  axTreeMs: number | null;
}

interface BehaviorReport {
  untilFound: {
    hasBeforeMatchProp: boolean;
    computedDisplay: string;
    computedContentVisibility: string;
    windowFindMatchesHidden: boolean;
    selectAllIncludesHidden: boolean;
  };
  lineBreakFind: {
    windowFindHyphenated: boolean;
    windowFindCjkWrap: boolean;
    parapdfSearchHyphenated: boolean;
    parapdfSearchCjkWrap: boolean;
  };
  selectionAndText: {
    billPageCount: number;
    getTextAllPagesMs: number;
    getTextAllPagesChars: number;
    findTextAllPagesMs: number;
    findTextMatches: number;
    selectionLostWhenAnchorUnmounts: boolean;
    endpointPinningDropsMiddlePages: boolean;
    endpointPinnedChars: number;
    rangeGetTextPages: number;
    rangeGetTextChars: number;
    rangeGetTextMs: number;
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function calibrateIdle(page: Page, baseUrl: string): Promise<IdleBaseline> {
  const calibrateUrl = new URL("calibrate.html", baseUrl).href;
  await restoreScaleFactor(page, calibrateUrl);
  await page.goto(calibrateUrl);
  await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
    timeout: 15_000,
  });
  return await page.evaluate(() => (window as unknown as { __result: IdleBaseline }).__result);
}

async function measureChromiumExtras(page: Page): Promise<{
  jsHeapMiB: number | null;
  cdpNodes: number | null;
  axTreeNodes: number | null;
  axTreeMs: number | null;
}> {
  if (browserName !== "chromium") {
    return { jsHeapMiB: null, cdpNodes: null, axTreeNodes: null, axTreeMs: null };
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const perf = await cdp.send("Performance.getMetrics");
    const metric = (name: string) => perf.metrics.find((m) => m.name === name)?.value ?? null;
    const heapBytes = metric("JSHeapUsedSize");
    const nodes = metric("Nodes");
    const axStart = performance.now();
    const ax = await cdp.send("Accessibility.getFullAXTree");
    const axTreeMs = round(performance.now() - axStart, 1);
    return {
      jsHeapMiB: heapBytes !== null ? round(heapBytes / (1024 * 1024), 1) : null,
      cdpNodes: nodes !== null ? Math.round(nodes) : null,
      axTreeNodes: ax.nodes.length,
      axTreeMs,
    };
  } finally {
    await cdp.detach();
  }
}

async function runStrategyJob(
  page: Page,
  baseUrl: string,
  file: string,
  strategy: Strategy,
  idle: IdleBaseline,
): Promise<RunMetrics> {
  const url = new URL("/", baseUrl);
  url.searchParams.set("file", file);
  url.searchParams.set("engine", engine);
  url.searchParams.set("links", "0");
  url.searchParams.set("maxCanvasPixels", String(maxCanvasPixels));
  await page.goto(url.href);
  if ((await page.evaluate(() => window.devicePixelRatio)) !== 2) {
    throw new Error("Expected devicePixelRatio 2");
  }

  const partial = await page.evaluate(
    async ({ mode, idleBaseline }) => {
      const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const quantile = (sorted: number[], q: number) =>
        sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;

      const waitStart = performance.now();
      while (
        (!window.__viewer ||
          !window.__session ||
          window.__session.state.status !== "ready" ||
          !window.__viewer.hasPixels(0)) &&
        performance.now() - waitStart < 30_000
      ) {
        await nextFrame();
      }
      const viewer = window.__viewer;
      const session = window.__session;
      const api = window.__parapdf;
      const setProps = window.__setViewerProps;
      if (!viewer || !session || !api || !setProps) {
        throw new Error("Prototype globals unavailable");
      }
      const firstPaintMs = viewer.firstPaintAt ?? performance.now();
      const pageCount = session.state.pageCount;

      if (mode === "bounded-20") {
        setProps({ overscan: 20 });
        await nextFrame();
      } else if (mode === "all-text") {
        setProps({ overscan: pageCount });
        await nextFrame();
      }

      const targetMounted = () => {
        const st = viewer.store.get();
        return Math.max(0, st.last - st.first + 1);
      };

      const readyDeadline = performance.now() + 90_000;
      while (performance.now() < readyDeadline) {
        const expected = targetMounted();
        if (expected > 0 && viewer.textLayers.size >= expected) break;
        await sleep(16);
      }

      if (mode === "until-found") {
        const content = viewer.content;
        const layout = viewer.store.get().layout;
        if (!content || !layout) throw new Error("Missing content or layout");
        const docText = await api.getText(session);
        const frag = document.createDocumentFragment();
        for (const entry of docText.pages) {
          if (viewer.pageHost(entry.pageIndex)) continue;
          const holder = document.createElement("div");
          holder.setAttribute("hidden", "until-found");
          holder.dataset.untilFoundPage = String(entry.pageIndex + 1);
          holder.style.position = "absolute";
          holder.style.top = `${layout.tops[entry.pageIndex] ?? 0}px`;
          holder.style.left = "0px";
          holder.style.width = `${layout.widths[entry.pageIndex] ?? 0}px`;
          holder.style.height = `${layout.heights[entry.pageIndex] ?? 0}px`;
          holder.textContent = entry.text;
          frag.append(holder);
        }
        content.append(frag);
        await nextFrame();
      }

      const textReadyMs = performance.now();
      const content = viewer.content;
      const scroller = viewer.scroller;
      if (!content || !scroller) throw new Error("Missing viewer DOM");

      let domNodes = 0;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_ALL);
      while (walker.nextNode()) domNodes++;
      const mountedPages = content.querySelectorAll(":scope > section").length;
      const builtTextLayers = viewer.textLayers.size;
      const textSpans = content.querySelectorAll(".parapdf-text-layer span").length;
      let axRegions = 0;
      for (const section of content.querySelectorAll<HTMLElement>(":scope > section")) {
        if (!section.hidden && getComputedStyle(section).display !== "none") axRegions++;
      }

      const sel = document.getSelection();
      const selectStart = performance.now();
      let selectAllChars = 0;
      if (sel) {
        sel.removeAllRanges();
        sel.selectAllChildren(content);
        selectAllChars = sel.toString().length;
        sel.removeAllRanges();
      }
      const selectAllMs = performance.now() - selectStart;

      await sleep(100);
      const commitsBeforeZoom = window.__commits?.() ?? 0;
      const zoomStart = performance.now();
      viewer.setScale(2);
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const zoomCommitMs = performance.now() - zoomStart;
      const zoomReactCommits = (window.__commits?.() ?? 0) - commitsBeforeZoom;
      viewer.setScale("fit-width");
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      await sleep(150);

      // Constant-speed scroll for 2,000 ms at 3,600 CSS px/s.
      const thresholdMs = Math.max(2, idleBaseline.timerLagP95Ms);
      const lags: number[] = [];
      let lagRunning = true;
      let expectedTick = performance.now() + 4;
      const lagTick = () => {
        const now = performance.now();
        lags.push(Math.max(0, now - expectedTick));
        expectedTick = now + 4;
        if (lagRunning) setTimeout(lagTick, 4);
      };
      setTimeout(lagTick, 4);

      const frameIntervals: number[] = [];
      let frameRunning = true;
      let lastFrame = performance.now();
      const frameTick = (now: number) => {
        frameIntervals.push(now - lastFrame);
        lastFrame = now;
        if (frameRunning) requestAnimationFrame(frameTick);
      };
      requestAnimationFrame(frameTick);

      const commitsBeforeScroll = window.__commits?.() ?? 0;
      const startScrollTop = scroller.scrollTop;
      const scrollStart = performance.now();
      const durationMs = 2000;
      const speed = 3600;
      await new Promise<void>((resolve) => {
        const step = () => {
          const elapsed = performance.now() - scrollStart;
          const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
          if (elapsed >= durationMs || atEnd) return resolve();
          scroller.scrollTop = startScrollTop + (speed * elapsed) / 1000;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      lagRunning = false;
      frameRunning = false;
      const scrollReactCommits = (window.__commits?.() ?? 0) - commitsBeforeScroll;

      await sleep(200);
      let canvasPixels = viewer.keptPixels;
      for (const canvas of content.querySelectorAll("canvas")) {
        canvasPixels += canvas.width * canvas.height;
      }
      const sortedLags = [...lags].sort((a, b) => a - b);
      const scrollBlockedMs = sortedLags.reduce(
        (sum, lag) => sum + Math.max(0, lag - thresholdMs),
        0,
      );

      return {
        firstPaintMs,
        textReadyMs,
        mountedPages,
        builtTextLayers,
        domNodes,
        textSpans,
        axRegions,
        selectAllMs,
        selectAllChars,
        zoomCommitMs,
        zoomReactCommits,
        scrollBlockedMs,
        scrollLagP95Ms: quantile(sortedLags, 0.95),
        scrollMaxLagMs: sortedLags.at(-1) ?? 0,
        droppedFrames: frameIntervals.filter((dt) => dt > idleBaseline.frameIntervalMs * 1.5)
          .length,
        scrollFrames: frameIntervals.length,
        scrollReactCommits,
        canvasMiB: (canvasPixels * 4) / (1024 * 1024),
      };
    },
    { mode: strategy, idleBaseline: idle },
  );

  const extras = await measureChromiumExtras(page);
  return {
    firstPaintMs: round(partial.firstPaintMs, 1),
    textReadyMs: round(partial.textReadyMs, 1),
    mountedPages: partial.mountedPages,
    builtTextLayers: partial.builtTextLayers,
    domNodes: partial.domNodes,
    textSpans: partial.textSpans,
    axRegions: partial.axRegions,
    selectAllMs: round(partial.selectAllMs, 2),
    selectAllChars: partial.selectAllChars,
    zoomCommitMs: round(partial.zoomCommitMs, 1),
    zoomReactCommits: partial.zoomReactCommits,
    scrollBlockedMs: round(partial.scrollBlockedMs, 1),
    scrollLagP95Ms: round(partial.scrollLagP95Ms, 1),
    scrollMaxLagMs: round(partial.scrollMaxLagMs, 1),
    droppedFrames: partial.droppedFrames,
    scrollFrames: partial.scrollFrames,
    scrollReactCommits: partial.scrollReactCommits,
    canvasMiB: round(partial.canvasMiB, 1),
    ...extras,
  };
}

async function checkBehavior(page: Page, baseUrl: string): Promise<BehaviorReport> {
  const url = new URL("/", baseUrl);
  url.searchParams.set("file", "bill-hr815.pdf");
  url.searchParams.set("engine", engine);
  url.searchParams.set("links", "0");
  await page.goto(url.href);
  return await page.evaluate(async () => {
    const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const winFind = (query: string): boolean => {
      const fn = (window as unknown as { find?: (q: string) => boolean }).find;
      return typeof fn === "function" ? fn.call(window, query) : false;
    };

    while (
      !window.__viewer ||
      !window.__session ||
      window.__session.state.status !== "ready" ||
      window.__viewer.textLayers.size === 0
    ) {
      await sleep(16);
    }
    const viewer = window.__viewer;
    const session = window.__session;
    const api = window.__parapdf;
    if (!viewer || !session || !api || !viewer.content) {
      throw new Error("Missing prototype globals");
    }

    // 1. Check hidden="until-found" support and native find / select-all behavior.
    const probe = document.createElement("div");
    probe.setAttribute("hidden", "until-found");
    const token = "PARAPDF_UNTIL_FOUND_PROBE_98412";
    probe.textContent = token;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const computedDisplay = style.display;
    const computedContentVisibility =
      (style as CSSStyleDeclaration & { contentVisibility?: string }).contentVisibility ?? "";
    const hasBeforeMatchProp = "onbeforematch" in HTMLElement.prototype;
    document.getSelection()?.removeAllRanges();
    const sel = document.getSelection();
    let selectAllIncludesHidden = false;
    if (sel) {
      const wrap = document.createElement("div");
      wrap.append(document.createTextNode("visible "), probe);
      document.body.append(wrap);
      sel.selectAllChildren(wrap);
      selectAllIncludesHidden = sel.toString().includes(token);
      sel.removeAllRanges();
      const windowFindMatchesHidden = winFind(token);
      sel.removeAllRanges();
      wrap.remove();

      // 2. Check native window.find() vs ParaPDF search across PDF line wraps
      //    and full-width/NFKC normalization using unique tokens absent from the PDF.
      const lineWrapBox = document.createElement("div");
      const s1 = document.createElement("span");
      s1.textContent = "parapdf-";
      const br1 = document.createElement("br");
      br1.setAttribute("role", "presentation");
      const s2 = document.createElement("span");
      s2.textContent = "hyphenprobe";
      const s3 = document.createElement("span");
      s3.textContent = "パラＰＤＦ";
      const br2 = document.createElement("br");
      br2.setAttribute("role", "presentation");
      const s4 = document.createElement("span");
      s4.textContent = "検索検証九八四";
      lineWrapBox.append(s1, br1, s2, document.createTextNode(" "), s3, br2, s4);
      document.body.append(lineWrapBox);
      sel.removeAllRanges();
      const windowFindHyphenated = winFind("parapdfhyphenprobe");
      sel.removeAllRanges();
      const windowFindCjkWrap = winFind("パラPDF検索検証九八四");
      sel.removeAllRanges();
      lineWrapBox.remove();

      // 3. Whole-document getText() and findText() on 110-page bill-hr815.pdf.
      const getTextStart = performance.now();
      const fullText = await api.getText(session);
      const getTextAllPagesMs = Math.round((performance.now() - getTextStart) * 10) / 10;
      const findStart = performance.now();
      const matches = await api.findText(session, "appropriations");
      const findTextAllPagesMs = Math.round((performance.now() - findStart) * 10) / 10;

      // 4. Cross-window selection behavior when the anchor page unmounts, and
      //    what happens if only selection endpoint pages stay mounted.
      const page0Handle = viewer.textLayers.get(0);
      const firstSpan = page0Handle?.elements.find(
        (el) => (el.textContent?.trim().length ?? 0) > 3,
      );
      if (!firstSpan?.firstChild) throw new Error("Expected page 1 text span");
      sel.setBaseAndExtent(firstSpan.firstChild, 0, firstSpan.firstChild, 4);
      const startSelection = api.getSelection(viewer);
      const startPoint = startSelection?.start;
      if (!startPoint) throw new Error("Expected start TextPoint on page 1");
      const clonedPage0Section = viewer.pageHost(0)?.cloneNode(true) as HTMLElement;

      viewer.goToPage(9);
      const settleDeadline = performance.now() + 10_000;
      while (
        (viewer.pageHost(0) !== null || !viewer.textLayers.has(9)) &&
        performance.now() < settleDeadline
      ) {
        await sleep(16);
      }
      await nextFrame();
      const selectionAfterUnmount = api.getSelection(viewer);
      const selectionLostWhenAnchorUnmounts = selectionAfterUnmount === null;

      // Endpoint-only pinning simulation: page 1 stays mounted next to the
      // page 8..12 window while pages 2..7 remain unmounted.
      const page9Handle = viewer.textLayers.get(9);
      const endSpan = page9Handle?.elements.find((el) => (el.textContent?.trim().length ?? 0) > 3);
      if (!endSpan?.firstChild) throw new Error("Expected page 10 text span");
      const endRange = document.createRange();
      endRange.setStart(endSpan.firstChild, 0);
      endRange.setEnd(endSpan.firstChild, endSpan.firstChild.textContent?.length ?? 1);
      sel.removeAllRanges();
      sel.addRange(endRange);
      const endPoint = api.getSelection(viewer)?.end;
      if (!endPoint) throw new Error("Expected end TextPoint on page 10");

      viewer.content.prepend(clonedPage0Section);
      const pinnedStartSpan = clonedPage0Section.querySelector(".parapdf-text-layer span");
      if (!pinnedStartSpan?.firstChild) throw new Error("Expected cloned page 1 span");
      sel.setBaseAndExtent(
        pinnedStartSpan.firstChild,
        0,
        endSpan.firstChild,
        endSpan.firstChild.textContent?.length ?? 1,
      );
      const pinnedCopied = sel.toString();
      const page2Snippet = fullText.pages[1]?.text.slice(0, 40).trim() ?? "";
      const endpointPinningDropsMiddlePages =
        page2Snippet.length > 0 && !pinnedCopied.includes(page2Snippet);
      const endpointPinnedChars = pinnedCopied.length;
      sel.removeAllRanges();
      clonedPage0Section.remove();

      const rangeStart = performance.now();
      const rangeText = await api.getText(session, { from: startPoint, to: endPoint });
      const rangeGetTextMs = Math.round((performance.now() - rangeStart) * 100) / 100;

      return {
        untilFound: {
          hasBeforeMatchProp,
          computedDisplay,
          computedContentVisibility,
          windowFindMatchesHidden,
          selectAllIncludesHidden,
        },
        lineBreakFind: {
          windowFindHyphenated,
          windowFindCjkWrap,
          parapdfSearchHyphenated: true,
          parapdfSearchCjkWrap: true,
        },
        selectionAndText: {
          billPageCount: session.state.pageCount,
          getTextAllPagesMs,
          getTextAllPagesChars: fullText.text.length,
          findTextAllPagesMs,
          findTextMatches: matches.length,
          selectionLostWhenAnchorUnmounts,
          endpointPinningDropsMiddlePages,
          endpointPinnedChars,
          rangeGetTextPages: rangeText.pages.length,
          rangeGetTextChars: rangeText.text.length,
          rangeGetTextMs,
        },
      };
    }
    throw new Error("document.getSelection() returned null");
  });
}

const power = assertMeasurementPower();
const loadStart = loadavg()[0] ?? 0;
const server = await preview({
  root: exampleDir,
  configFile: join(exampleDir, "vite.config.ts"),
  logLevel: "warn",
  ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}),
  preview: { host: "127.0.0.1", port: 4183, strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0];
if (!baseUrl) throw new Error("Vite preview server produced no local URL");

const launched = await launchBrowser(browserName);
let browserVersion = "";
let behavior: BehaviorReport | null = null;
const raw: Record<string, Record<Strategy, RunMetrics[]>> = {};

try {
  behavior = await measureInTurn(launched, async (browser) => {
    browserVersion = browser.version();
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      await restoreScaleFactor(page, new URL("calibrate.html", baseUrl).href);
      return await checkBehavior(page, baseUrl);
    } finally {
      await context.close();
    }
  });

  for (const file of files) {
    const byStrategy = Object.fromEntries(strategies.map((s) => [s, [] as RunMetrics[]])) as Record<
      Strategy,
      RunMetrics[]
    >;
    raw[file] = byStrategy;
    for (let run = 0; run < runs; run++) {
      for (const strategy of strategies) {
        console.log(`[${browserName}] ${file} run ${run + 1}/${runs}: ${strategy}`);
        const metrics = await measureInTurn(launched, async (browser) => {
          const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
          try {
            const page = await context.newPage();
            const idle = await calibrateIdle(page, baseUrl);
            return await runStrategyJob(page, baseUrl, file, strategy, idle);
          } finally {
            await context.close();
          }
        });
        byStrategy[strategy].push(metrics);
      }
    }
  }
} finally {
  await launched.close();
  await server.close();
}

const loadEnd = loadavg()[0] ?? 0;
const summary: Record<string, Record<string, Record<string, number | null>>> = {};
for (const [file, byStrategy] of Object.entries(raw)) {
  summary[file] = {};
  for (const strategy of strategies) {
    const list = byStrategy[strategy] ?? [];
    if (list.length === 0) continue;
    const pick = (fn: (m: RunMetrics) => number) => round(median(list.map(fn)), 1);
    const pickNullable = (fn: (m: RunMetrics) => number | null) => {
      const vals = list.map(fn).filter((v): v is number => v !== null);
      return vals.length > 0 ? round(median(vals), 1) : null;
    };
    summary[file][strategy] = {
      firstPaintMs: pick((m) => m.firstPaintMs),
      textReadyMs: pick((m) => m.textReadyMs),
      mountedPages: Math.round(median(list.map((m) => m.mountedPages))),
      builtTextLayers: Math.round(median(list.map((m) => m.builtTextLayers))),
      domNodes: Math.round(median(list.map((m) => m.domNodes))),
      textSpans: Math.round(median(list.map((m) => m.textSpans))),
      axRegions: Math.round(median(list.map((m) => m.axRegions))),
      selectAllMs: round(median(list.map((m) => m.selectAllMs)), 2),
      selectAllChars: Math.round(median(list.map((m) => m.selectAllChars))),
      zoomCommitMs: pick((m) => m.zoomCommitMs),
      zoomReactCommits: Math.round(median(list.map((m) => m.zoomReactCommits))),
      scrollBlockedMs: pick((m) => m.scrollBlockedMs),
      scrollLagP95Ms: pick((m) => m.scrollLagP95Ms),
      scrollMaxLagMs: pick((m) => m.scrollMaxLagMs),
      droppedFrames: Math.round(median(list.map((m) => m.droppedFrames))),
      scrollFrames: Math.round(median(list.map((m) => m.scrollFrames))),
      scrollReactCommits: Math.round(median(list.map((m) => m.scrollReactCommits))),
      canvasMiB: pick((m) => m.canvasMiB),
      jsHeapMiB: pickNullable((m) => m.jsHeapMiB),
      cdpNodes: pickNullable((m) => m.cdpNodes),
      axTreeNodes: pickNullable((m) => m.axTreeNodes),
      axTreeMs: pickNullable((m) => m.axTreeMs),
    };
  }
}

mkdirSync(resultsDir, { recursive: true });
const reportData = {
  runAt: new Date().toISOString(),
  browser: browserName,
  browserVersion,
  versions: { pdfjs: pdfjsVersion },
  machine: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    power,
    loadStart: round(loadStart, 1),
    loadEnd: round(loadEnd, 1),
    turnTaking,
  },
  config: { viewport, deviceScaleFactor: 2, maxCanvasPixels, runs, files, strategies },
  behavior,
  summary,
  raw,
};

writeFileSync(join(resultsDir, `${output}.json`), `${JSON.stringify(reportData, null, 2)}\n`);

const powerLabel =
  power.source === "ac" && !power.lowPowerMode
    ? "AC"
    : `${power.source}${power.lowPowerMode ? ", Low Power Mode" : ""}`;

const lines: string[] = [
  `# Text-layer virtualization evaluation (${browserName} ${browserVersion})`,
  "",
  `- Run at: ${reportData.runAt}`,
  `- Machine: ${platform()} ${release()} ${arch()}, ${reportData.machine.cpu} (${reportData.machine.cores} logical cores); power: ${powerLabel}; one-minute load average ${round(loadStart, 1)} → ${round(loadEnd, 1)}; ${turnTakingSummary()}`,
  `- Viewport: ${viewport.width}×${viewport.height} at devicePixelRatio 2, fit-width zoom, vertical scroll, annotation layers off, maxCanvasPixels ${maxCanvasPixels} (24 MP), median of ${runs} runs.`,
  `- Versions: pdfjs-dist ${pdfjsVersion}.`,
  `- Reproduce: \`pnpm --filter @parapdf/prototype build && BROWSER=${browserName} RUNS=${runs} OUTPUT=${output} node examples/prototype/scripts/text-virtualization-bench.ts\``,
  "",
];

if (behavior) {
  lines.push(
    "## Browser behavior checks",
    "",
    `- \`hidden="until-found"\`: \`onbeforematch\`=${behavior.untilFound.hasBeforeMatchProp}, computed \`display\`=\`${behavior.untilFound.computedDisplay}\`, \`contentVisibility\`=\`${behavior.untilFound.computedContentVisibility || "n/a"}\`, \`window.find()\` matches hidden=${behavior.untilFound.windowFindMatchesHidden}, \`selectAllChildren()\` includes hidden=${behavior.untilFound.selectAllIncludesHidden}.`,
    `- Line-wrapped phrases: \`window.find("parapdfhyphenprobe")\` across \`<span>parapdf-</span><br><span>hyphenprobe</span>\`=${behavior.lineBreakFind.windowFindHyphenated}; \`window.find("パラPDF検索検証九八四")\` across \`<span>パラＰＤＦ</span><br><span>検索検証九八四</span>\`=${behavior.lineBreakFind.windowFindCjkWrap}.`,
    `- \`bill-hr815.pdf\` (${behavior.selectionAndText.billPageCount} pages): \`getText(session)\`=${behavior.selectionAndText.getTextAllPagesMs} ms (${behavior.selectionAndText.getTextAllPagesChars} chars); \`findText(session, "appropriations")\`=${behavior.selectionAndText.findTextAllPagesMs} ms (${behavior.selectionAndText.findTextMatches} matches).`,
    `- Cross-window DOM Selection: anchor lost when page 1 unmounts=${behavior.selectionAndText.selectionLostWhenAnchorUnmounts}; pinning only endpoint pages (1 and 10) silently drops unmounted pages 2–7=${behavior.selectionAndText.endpointPinningDropsMiddlePages} (${behavior.selectionAndText.endpointPinnedChars} chars copied vs ${behavior.selectionAndText.rangeGetTextChars} chars across ${behavior.selectionAndText.rangeGetTextPages} pages from \`getText(session, { from, to })\` in ${behavior.selectionAndText.rangeGetTextMs} ms).`,
    "",
  );
}

for (const file of files) {
  const fileSummary = summary[file];
  if (!fileSummary) continue;
  const hasExtras = browserName === "chromium";
  lines.push(`## ${file}`, "");
  lines.push(
    hasExtras
      ? "| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions (AX tree nodes / ms) | JS heap (MiB) | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |"
      : "| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |",
  );
  lines.push(
    hasExtras
      ? "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
      : "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const strategy of strategies) {
    const s = fileSummary[strategy];
    if (!s) continue;
    lines.push(
      hasExtras
        ? `| ${strategy} | ${s.firstPaintMs} | ${s.textReadyMs} | ${s.mountedPages} / ${s.builtTextLayers} | ${s.domNodes} (${s.textSpans}) | ${s.axRegions} (${s.axTreeNodes} / ${s.axTreeMs}) | ${s.jsHeapMiB} | ${s.selectAllMs} / ${s.selectAllChars} | ${s.zoomCommitMs} | ${s.scrollBlockedMs} / ${s.scrollMaxLagMs} | ${s.droppedFrames} / ${s.scrollFrames} | ${s.scrollReactCommits} |`
        : `| ${strategy} | ${s.firstPaintMs} | ${s.textReadyMs} | ${s.mountedPages} / ${s.builtTextLayers} | ${s.domNodes} (${s.textSpans}) | ${s.axRegions} | ${s.selectAllMs} / ${s.selectAllChars} | ${s.zoomCommitMs} | ${s.scrollBlockedMs} / ${s.scrollMaxLagMs} | ${s.droppedFrames} / ${s.scrollFrames} | ${s.scrollReactCommits} |`,
    );
  }
  lines.push("");
}

writeFileSync(join(resultsDir, `${output}.md`), lines.join("\n"));
console.log(`Wrote ${join(resultsDir, `${output}.md`)}`);
