import {
  PdfDocument,
  type PdfEngine,
  type PdfjsDocumentOptions,
  PdfPageRect,
  type PdfSource,
  PdfViewport,
  pdfjsDocumentOf,
  usePdfDocument,
  usePdfNavigation,
  usePdfOutline,
  usePdfState,
  usePdfViewer,
  type ViewerOptions,
} from "parapdf";
import { Profiler, type ProfilerOnRenderCallback, Suspense, use, useEffect, useState } from "react";
import { preload } from "react-dom";
import { BenchDriver } from "./BenchDriver.tsx";
import { loadEngine } from "./engines.ts";
import { OutlinePanel } from "./OutlinePanel.tsx";
import { SearchBox } from "./SearchBox.tsx";

const params = new URLSearchParams(location.search);
const settings = {
  file: params.get("file") ?? "synthetic-text-1000.pdf",
  engine: params.get("engine") ?? "pdfjs-next",
  hwa: params.get("hwa") !== "0",
  text: params.get("text") !== "0",
  links: params.get("links") !== "0",
  /** "disabled" leaves links to other documents inert. */
  externalLinks: (params.get("externalLinks") === "disabled"
    ? "disabled"
    : "new-tab") as ViewerOptions["externalLinks"],
  /** Scripted scroll speed in CSS pixels per second; 0 disables the benchmark driver. */
  autoscroll: Number(params.get("autoscroll") ?? "0"),
  durationMs: Number(params.get("duration") ?? "4000"),
  // Idle baseline from calibrate.html; the defaults suit Chromium at 60 Hz.
  idle: {
    timerLagP95Ms: Number(params.get("idleLag") ?? "2"),
    frameIntervalMs: Number(params.get("idleFrame") ?? "16.7"),
  },
  preload: params.get("preload") !== "0",
  /** CSS pixels per PDF point the zoom may reach; the runtime's default when absent. */
  maxScale: params.has("maxScale") ? Number(params.get("maxScale")) : undefined,
  /** More pdf.js getDocument parameters, as JSON. */
  documentOptions: params.has("documentOptions")
    ? (JSON.parse(params.get("documentOptions") ?? "{}") as PdfjsDocumentOptions)
    : undefined,
  /** Canvas pixel limits (ViewerOptions); the runtime's defaults when absent. */
  canvasLimits: Object.fromEntries(
    ["maxDetailPixels", "maxBasePixels", "maxCanvasPixels"].flatMap((name) =>
      params.has(name) ? [[name, Number(params.get(name))]] : [],
    ),
  ) as Pick<ViewerOptions, "maxDetailPixels" | "maxBasePixels" | "maxCanvasPixels">,
};

declare global {
  interface Window {
    /** Hooks for scripts/check-lifecycle.ts. */
    __lifecycle?: {
      remount(): void;
      unmount(): void;
      mount(): void;
      stats: { opens: number; destroys: number };
      unhandled: string[];
    };
  }
}

// Engine work and unhandled rejections, counted for scripts/check-lifecycle.ts.
const engineStats = { opens: 0, destroys: 0 };
const unhandled: string[] = [];
window.addEventListener("unhandledrejection", (event) => {
  unhandled.push(String(event.reason));
});

function countEngineWork(engine: PdfEngine): PdfEngine {
  return {
    name: engine.name,
    async open(source) {
      engineStats.opens++;
      const doc = await engine.open(source);
      return {
        ...doc,
        destroy() {
          engineStats.destroys++;
          return doc.destroy();
        },
      };
    },
  };
}

// Module-level values stay referentially stable across renders.
const enginePromise = loadEngine(settings.engine, settings.hwa, settings.documentOptions).then(
  countEngineWork,
);
const source: PdfSource = { url: `/corpus/${settings.file}` };
const viewerOptions: ViewerOptions = {
  textLayer: settings.text,
  annotationLayer: settings.links,
  externalLinks: settings.externalLinks,
  ...(settings.maxScale ? { maxScale: settings.maxScale } : {}),
  ...settings.canvasLimits,
};
const commits = { count: 0 };
const countCommit: ProfilerOnRenderCallback = () => {
  commits.count++;
};
const benchLabel = {
  file: settings.file,
  engineKind: settings.engine,
  hwa: settings.hwa,
  text: settings.text,
  links: settings.links,
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
  // A new key mounts a new viewer with a new runtime for the same source.
  const [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    window.__lifecycle = {
      remount: () => setGeneration((value) => value + 1),
      unmount: () => setMounted(false),
      mount: () => setMounted(true),
      stats: engineStats,
      unhandled,
    };
  }, []);
  return (
    <Suspense fallback={<div className="status">Loading the engine…</div>}>
      {mounted ? <Viewer key={generation} /> : null}
    </Suspense>
  );
}

function Viewer() {
  const engine = use(enginePromise);
  const [outlineOpen, setOutlineOpen] = useState(false);
  return (
    <Profiler id="viewer" onRender={countCommit}>
      <PdfDocument engine={engine} source={source} options={viewerOptions}>
        <Toolbar
          outlineOpen={outlineOpen}
          onToggleOutline={() => setOutlineOpen((open) => !open)}
        />
        {outlineOpen ? <OutlinePanel id="outline" /> : null}
        <PdfViewport
          className={outlineOpen ? "viewport with-outline" : "viewport"}
          renderOverlay={renderOverlay}
        />
        {settings.autoscroll > 0 ? (
          <BenchDriver
            speed={settings.autoscroll}
            durationMs={settings.durationMs}
            idle={settings.idle}
            commits={commits}
            label={benchLabel}
          />
        ) : null}
      </PdfDocument>
    </Profiler>
  );
}

function Toolbar({
  outlineOpen,
  onToggleOutline,
}: {
  outlineOpen: boolean;
  onToggleOutline: () => void;
}) {
  const viewer = usePdfViewer();
  const navigation = usePdfNavigation();
  const outline = usePdfOutline();
  const hasOutline = outline !== null && outline.length > 0;
  const { back } = navigation;

  // Alt+Left returns from a link jump, as browsers do for pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back]);
  // Exposed for the Playwright probes; not part of the library surface.
  (window as { __viewer?: unknown }).__viewer = viewer;
  // The escape hatch: pdf.js's own PDFDocumentProxy, for check-rotation.ts.
  const pdfDocument = usePdfDocument();
  (window as { __pdfDocument?: unknown }).__pdfDocument = pdfjsDocumentOf(pdfDocument) ?? undefined;
  const status = usePdfState((state) => state.status);
  const error = usePdfState((state) => state.error);
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  const scale = usePdfState((state) => state.scale);
  const zoomMode = usePdfState((state) => state.zoomMode);
  return (
    <header className="toolbar">
      {hasOutline ? (
        <button
          type="button"
          aria-expanded={outlineOpen}
          aria-controls="outline"
          onClick={onToggleOutline}
        >
          Outline
        </button>
      ) : null}
      <button type="button" onClick={back} disabled={!navigation.canGoBack}>
        Back
      </button>
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
      <button
        type="button"
        aria-pressed={zoomMode === "fit-width"}
        onClick={() => viewer.setScale("fit-width")}
      >
        Fit width
      </button>
      <button type="button" onClick={() => viewer.rotate(-90)} aria-label="Rotate counterclockwise">
        ↺
      </button>
      <button type="button" onClick={() => viewer.rotate(90)} aria-label="Rotate clockwise">
        ↻
      </button>
      {viewer.textLayer ? <SearchBox /> : null}
    </header>
  );
}
