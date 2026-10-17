import {
  PdfDocument,
  PdfPageRect,
  type PdfSource,
  PdfViewport,
  usePdfState,
  usePdfViewer,
  type ViewerOptions,
} from "parapdf";
import { Profiler, type ProfilerOnRenderCallback, Suspense, use } from "react";
import { preload } from "react-dom";
import { BenchDriver } from "./BenchDriver.tsx";
import { loadEngine } from "./engines.ts";
import { SearchBox } from "./SearchBox.tsx";

const params = new URLSearchParams(location.search);
const settings = {
  file: params.get("file") ?? "synthetic-text-1000.pdf",
  engine: params.get("engine") ?? "pdfjs-next",
  hwa: params.get("hwa") !== "0",
  text: params.get("text") !== "0",
  autoscroll: Number(params.get("autoscroll") ?? "0"),
  durationMs: Number(params.get("duration") ?? "4000"),
  preload: params.get("preload") !== "0",
};

// Module-level values stay referentially stable across renders.
const enginePromise = loadEngine(settings.engine, settings.hwa);
const source: PdfSource = { url: `/corpus/${settings.file}` };
const viewerOptions: ViewerOptions = { textLayer: settings.text };
const commits = { count: 0 };
const countCommit: ProfilerOnRenderCallback = () => {
  commits.count++;
};
const benchLabel = {
  file: settings.file,
  engineKind: settings.engine,
  hwa: settings.hwa,
  text: settings.text,
  speed: settings.autoscroll,
  preload: settings.preload,
};

/** One highlight in PDF points, to show overlays follow zoom without re-rendering. */
const renderOverlay = (pageIndex: number) =>
  pageIndex === 0 ? (
    <PdfPageRect
      pageIndex={0}
      x={72}
      y={36}
      width={220}
      height={30}
      style={{ background: "rgb(255 213 0 / 0.3)", outline: "2px solid rgb(255 170 0)" }}
    />
  ) : null;

export function App() {
  // Start downloading the PDF while the engine module loads. The request
  // matches the CORS mode pdf.js uses, so its fetch reuses this response.
  if (settings.preload && "url" in source) {
    preload(source.url, { as: "fetch", crossOrigin: "anonymous" });
  }
  return (
    <Suspense fallback={<div className="status">Loading the engine…</div>}>
      <Viewer />
    </Suspense>
  );
}

function Viewer() {
  const engine = use(enginePromise);
  return (
    <Profiler id="viewer" onRender={countCommit}>
      <PdfDocument engine={engine} source={source} options={viewerOptions}>
        <Toolbar />
        <PdfViewport className="viewport" renderOverlay={renderOverlay} />
        {settings.autoscroll > 0 ? (
          <BenchDriver
            speed={settings.autoscroll}
            durationMs={settings.durationMs}
            commits={commits}
            label={benchLabel}
          />
        ) : null}
      </PdfDocument>
    </Profiler>
  );
}

function Toolbar() {
  const viewer = usePdfViewer();
  // Exposed for the Playwright probes; not part of the library surface.
  (window as { __viewer?: unknown }).__viewer = viewer;
  const status = usePdfState((state) => state.status);
  const error = usePdfState((state) => state.error);
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  const scale = usePdfState((state) => state.scale);
  return (
    <header className="toolbar">
      <strong>ParaPDF prototype</strong>
      <span className="engine">{viewer.engineName}</span>
      <span>{status === "ready" ? `${page + 1} / ${pageCount}` : (error ?? status)}</span>
      <button type="button" onClick={() => viewer.zoomBy(1 / 1.25)} aria-label="Zoom out">
        −
      </button>
      {/* 100% is the page at 96 CSS pixels per inch. */}
      <span>{Math.round((scale * 72 * 100) / 96)}%</span>
      <button type="button" onClick={() => viewer.zoomBy(1.25)} aria-label="Zoom in">
        +
      </button>
      {viewer.textLayer ? <SearchBox /> : null}
    </header>
  );
}
