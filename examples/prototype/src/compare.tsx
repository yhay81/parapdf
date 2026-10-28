import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import workerUrl from "react-pdf-worker?url";
import {
  type CSSProperties,
  Profiler,
  type ProfilerOnRenderCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Document, Page, pdfjs } from "react-pdf";
import { List, type RowComponentProps } from "react-window";
import {
  blockedThreshold,
  nextFrame,
  sleep,
  startFrameMonitor,
  startLagMonitor,
} from "./metrics.ts";

/**
 * The scroll benchmark's page for react-pdf, the comparison for ParaPDF's
 * demo: the same document, at the width ParaPDF fits it to, scrolled the
 * same way, publishing the measures BenchDriver publishes on
 * `window.__result`. `viewer=react-pdf` mounts a `<Page>` for every page, as
 * react-pdf's documentation shows; `viewer=react-pdf-window` mounts only
 * the rows react-window keeps, the usual way to show long documents with
 * it. Both size every page as the first, which suits documents whose pages
 * share a size and spares them reading every page's size first.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const params = new URLSearchParams(location.search);
const settings = {
  windowed: params.get("viewer") === "react-pdf-window",
  file: params.get("file") ?? "synthetic-text-1000.pdf",
  text: params.get("text") !== "0",
  links: params.get("links") !== "0",
  autoscroll: Number(params.get("autoscroll") ?? "0"),
  durationMs: Number(params.get("duration") ?? "4000"),
  idle: {
    timerLagP95Ms: Number(params.get("idleLag") ?? "2"),
    frameIntervalMs: Number(params.get("idleFrame") ?? "16.7"),
  },
};

// ParaPDF's default gap around and between pages, so pages fit the same width.
const GAP = 12;
const options = {
  cMapUrl: "/react-pdf/cmaps/",
  standardFontDataUrl: "/react-pdf/standard_fonts/",
  wasmUrl: "/react-pdf/wasm/",
  iccUrl: "/react-pdf/iccs/",
};

/** Pages whose canvas holds pixels and is mounted, and render counts. */
const pixels = new Set<number>();
const counts = { base: 0, text: 0, annotations: 0, commits: 0, firstPaintMs: Number.NaN };

const countCommit: ProfilerOnRenderCallback = () => {
  counts.commits++;
};

interface Geometry {
  /** CSS pixels per point. */
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

function PageRow({ index, geometry }: { index: number; geometry: Geometry }) {
  useEffect(() => () => void pixels.delete(index), [index]);
  return (
    <Page
      pageIndex={index}
      width={geometry.pageWidth}
      renderTextLayer={settings.text}
      renderAnnotationLayer={settings.links}
      onRenderSuccess={() => {
        counts.base++;
        if (index === 0 && Number.isNaN(counts.firstPaintMs))
          counts.firstPaintMs = performance.now();
        pixels.add(index);
      }}
      onRenderTextLayerSuccess={() => void counts.text++}
      onRenderAnnotationLayerSuccess={() => void counts.annotations++}
    />
  );
}

const rowStyle = (style: CSSProperties): CSSProperties => ({ ...style, paddingTop: GAP });

function WindowRow({ index, style, geometry }: RowComponentProps<{ geometry: Geometry }>) {
  return (
    <div className="row" style={rowStyle(style)}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <PageRow index={index} geometry={geometry} />
      </div>
    </div>
  );
}

function Pages({ pageCount, geometry }: { pageCount: number; geometry: Geometry }) {
  const rowHeight = geometry.pageHeight + GAP;
  if (settings.windowed) {
    return (
      <List
        className="viewport"
        style={{ position: "absolute" }}
        rowComponent={WindowRow}
        rowCount={pageCount}
        rowHeight={rowHeight}
        rowProps={{ geometry }}
      />
    );
  }
  return (
    <div className="viewport">
      <div style={{ position: "relative", height: pageCount * rowHeight + GAP }}>
        {Array.from({ length: pageCount }, (_, index) => index).map((index) => (
          <div
            key={index}
            className="page"
            style={{ top: index * rowHeight + GAP, height: geometry.pageHeight }}
          >
            <PageRow index={index} geometry={geometry} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Compare() {
  const sizer = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{
    pageCount: number;
    geometry: Geometry;
  } | null>(null);

  useEffect(() => {
    if (!loaded || settings.autoscroll <= 0) return;
    void drive(loaded.pageCount, loaded.geometry);
  }, [loaded]);

  return (
    <Document
      file={`/corpus/${settings.file}`}
      options={options}
      onLoadSuccess={async (pdf) => {
        // The width ParaPDF's "fit-width" gives the first page, and its height there.
        const first = await pdf.getPage(1);
        const { width, height } = first.getViewport({ scale: 1 });
        const room = (sizer.current?.clientWidth ?? 0) - 2 * GAP;
        const scale = room / width;
        setLoaded({
          pageCount: pdf.numPages,
          geometry: { scale, pageWidth: room, pageHeight: Math.round(height * scale) },
        });
      }}
      loading={null}
    >
      {/* Measures the viewport's width with the scrollbar the pages will have. */}
      <div ref={sizer} className="viewport" style={{ overflowY: "scroll", visibility: "hidden" }} />
      {loaded ? <Pages pageCount={loaded.pageCount} geometry={loaded.geometry} /> : null}
    </Document>
  );
}

/** The visible pages' area without pixels, as a share of the viewport's. */
function blankFraction(scroller: HTMLElement, pageCount: number, geometry: Geometry): number {
  const { scrollTop: top, clientHeight: height, clientWidth: width } = scroller;
  if (height === 0) return 0;
  const rowHeight = geometry.pageHeight + GAP;
  const first = Math.max(0, Math.floor((top - GAP) / rowHeight));
  const last = Math.min(pageCount - 1, Math.floor((top + height) / rowHeight));
  const visibleWidth = Math.min(width, geometry.pageWidth);
  let blank = 0;
  for (let index = first; index <= last; index++) {
    if (pixels.has(index)) continue;
    const pageTop = index * rowHeight + GAP;
    const visible = Math.min(top + height, pageTop + geometry.pageHeight) - Math.max(top, pageTop);
    if (visible > 0) blank += visible * visibleWidth;
  }
  return blank / (height * width);
}

const currentPage = (scroller: HTMLElement, geometry: Geometry) =>
  Math.floor((scroller.scrollTop + scroller.clientHeight / 2) / (geometry.pageHeight + GAP)) + 1;

/** The pixels of every canvas in the page. */
const canvasPixels = () =>
  [...document.querySelectorAll("canvas")].reduce(
    (sum, canvas) => sum + canvas.width * canvas.height,
    0,
  );

async function drive(pageCount: number, geometry: Geometry) {
  const label = { viewer: settings.windowed ? "react-pdf-window" : "react-pdf" };
  const publish = (result: unknown) => {
    window.__result = result;
    window.__done = true;
  };
  try {
    const waitStart = performance.now();
    while (!pixels.has(0) && performance.now() - waitStart < 30_000) await nextFrame();
    if (!pixels.has(0)) throw new Error("first page did not paint within 30 seconds");
    const firstPaintMs = counts.firstPaintMs;
    await sleep(600);
    const scroller = [...document.querySelectorAll<HTMLElement>(".viewport")].at(-1);
    if (!scroller) throw new Error("no scroller");

    const before = { ...counts };
    const startPage = currentPage(scroller, geometry);
    const stopLag = startLagMonitor(blockedThreshold(settings.idle));
    const stopFrames = startFrameMonitor(settings.idle.frameIntervalMs);
    let sampledFrames = 0;
    let blankSum = 0;
    let blankFrames = 0;
    const start = performance.now();
    const startPosition = scroller.scrollTop;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const blank = blankFraction(scroller, pageCount, geometry);
        blankSum += blank;
        if (blank > 0.01) blankFrames++;
        sampledFrames++;
        const elapsed = performance.now() - start;
        const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
        if (elapsed >= settings.durationMs || atEnd) return resolve();
        scroller.scrollTop = startPosition + (settings.autoscroll * elapsed) / 1000;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const scrollMs = performance.now() - start;
    const commitsDuringScroll = counts.commits - before.commits;
    const lag = stopLag();
    const frames = stopFrames();
    const pagesCrossed = currentPage(scroller, geometry) - startPage;
    const settleStart = performance.now();
    while (
      blankFraction(scroller, pageCount, geometry) > 0 &&
      performance.now() - settleStart < 10_000
    )
      await nextFrame();
    const settleMs = performance.now() - settleStart;
    publish({
      ...label,
      scrollMode: "vertical",
      scale: geometry.scale,
      firstPaintMs,
      scrollMs,
      pagesCrossed,
      commitsDuringScroll,
      blankMeanPct: (blankSum / Math.max(1, sampledFrames)) * 100,
      blankFramesPct: (blankFrames / Math.max(1, sampledFrames)) * 100,
      settleMs,
      lag,
      frames,
      renders: {
        base: counts.base - before.base,
        detail: 0,
        text: counts.text - before.text,
        annotations: counts.annotations - before.annotations,
        cancelled: 0,
        failed: 0,
      },
      canvasPixels: canvasPixels(),
      crossOriginIsolated,
      devicePixelRatio,
    });
  } catch (error) {
    publish({ ...label, error: String(error) });
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <Profiler id="viewer" onRender={countCommit}>
      <Compare />
    </Profiler>,
  );
}
