import {
  PdfDocument,
  type PdfjsDocumentOptions,
  PdfPageRect,
  type PdfSource,
  PdfViewport,
  type ScrollMode,
  type SpreadMode,
  usePdfDocument,
  usePdfNavigation,
  usePdfOutline,
  usePdfState,
  usePdfViewer,
  type ViewerOptions,
} from "parapdf";
import { Profiler, type ProfilerOnRenderCallback, Suspense, use, useEffect, useState } from "react";
import { BenchDriver } from "./BenchDriver.tsx";
import { configureEngine, type Pdfjs } from "./engines.ts";
import { PasswordPrompt } from "./PasswordPrompt.tsx";
import { SearchBox } from "./SearchBox.tsx";
import { Sidebar, type SidebarView } from "./Sidebar.tsx";

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
  /** "data" opens the PDF from bytes the application fetched instead of from its URL. */
  source: params.get("source") === "data" ? "data" : "url",
  /** The password the source carries; the viewer asks for one when it is absent or wrong. */
  password: params.get("password"),
  /** Form fields the reader can fill in. */
  forms: params.get("forms") === "1",
  /** "0" fails encrypted documents instead of asking for their password. */
  passwordPrompt: params.get("passwordPrompt") !== "0",
  /** "odd" or "even" shows pages side by side in pairs. */
  spread: (["odd", "even"].includes(params.get("spread") ?? "")
    ? params.get("spread")
    : "none") as SpreadMode,
  /** "horizontal", "wrapped", or "page" arranges pages other than in a column. */
  scrollMode: (["horizontal", "wrapped", "page"].includes(params.get("scroll") ?? "")
    ? params.get("scroll")
    : "vertical") as ScrollMode,
  /** The one-based page shown first. */
  initialPage: Number(params.get("page") ?? "1") - 1,
  /** A scale in CSS pixels per point, "fit-width", or "fit-page". */
  initialScale: ((value): ViewerOptions["initialScale"] =>
    value === "fit-page" || value === "fit-width" ? value : value ? Number(value) : undefined)(
    params.get("scale"),
  ),
  /** CSS pixels per PDF point the zoom may reach; the runtime's default when absent. */
  maxScale: params.has("maxScale") ? Number(params.get("maxScale")) : undefined,
  /** More pdf.js getDocument parameters, as JSON. */
  documentOptions: params.has("documentOptions")
    ? (JSON.parse(params.get("documentOptions") ?? "{}") as PdfjsDocumentOptions)
    : undefined,
  /** Canvas pixel limits (ViewerOptions); the runtime's defaults when absent. */
  canvasLimits: Object.fromEntries(
    ["maxDetailPixels", "maxDetailViewports", "maxBasePixels", "maxCanvasPixels"].flatMap((name) =>
      params.has(name) ? [[name, Number(params.get(name))]] : [],
    ),
  ) as Pick<
    ViewerOptions,
    "maxDetailPixels" | "maxDetailViewports" | "maxBasePixels" | "maxCanvasPixels"
  >,
};

// The page's language, which the text layers of PDFs that declare none
// inherit: ?lang=ja shows them on a Japanese page, with Japanese labels.
const pageLanguage = params.get("lang");
if (pageLanguage !== null) document.documentElement.lang = pageLanguage;
const japanese = pageLanguage === "ja";
const pageLabel = japanese
  ? (pageNumber: number, pageCount: number) => `${pageCount} ページ中 ${pageNumber} ページ目`
  : undefined;

declare global {
  interface Window {
    /** Hooks for scripts/check-lifecycle.ts. */
    __lifecycle?: {
      remount(): void;
      unmount(): void;
      mount(): void;
      /** Renders the viewer again, which passes it a new but equal source object. */
      rerender(): void;
      /** The length of the bytes a data source opened, which pdf.js must leave intact. */
      sourceBytes(): number | null;
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

/** Counts the documents pdf.js opens and destroys (`?count=1`). */
function countEngineWork(pdfjs: Pdfjs): Pdfjs {
  return {
    ...pdfjs,
    getDocument(...args: Parameters<Pdfjs["getDocument"]>) {
      engineStats.opens++;
      const task = pdfjs.getDocument(...args);
      const destroy = task.destroy.bind(task);
      task.destroy = () => {
        engineStats.destroys++;
        return destroy();
      };
      return task;
    },
  };
}

configureEngine(
  settings.engine,
  settings.hwa,
  settings.documentOptions,
  params.has("count") ? countEngineWork : undefined,
);
// Module-level values stay referentially stable across renders.
const url = `/corpus/${settings.file}`;
const bytesPromise: Promise<Uint8Array | null> =
  settings.source === "data"
    ? fetch(url).then(async (response) => new Uint8Array(await response.arrayBuffer()))
    : Promise.resolve(null);
let bytes: Uint8Array | null = null;
void bytesPromise.then((loaded) => {
  bytes = loaded;
});
const viewerOptions: ViewerOptions = {
  textLayer: settings.text,
  annotationLayer: settings.links,
  externalLinks: settings.externalLinks,
  forms: settings.forms,
  passwordPrompt: settings.passwordPrompt,
  spread: settings.spread,
  scrollMode: settings.scrollMode,
  ...(settings.initialPage > 0 ? { initialPage: settings.initialPage } : {}),
  ...(settings.initialScale !== undefined ? { initialScale: settings.initialScale } : {}),
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
  // A new key mounts a new viewer with a new runtime for the same source.
  const [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [renders, setRenders] = useState(0);
  useEffect(() => {
    window.__lifecycle = {
      remount: () => setGeneration((value) => value + 1),
      unmount: () => setMounted(false),
      mount: () => setMounted(true),
      rerender: () => setRenders((value) => value + 1),
      sourceBytes: () => bytes?.byteLength ?? null,
      stats: engineStats,
      unhandled,
    };
  }, []);
  return (
    <Suspense fallback={<div className="status">Loading…</div>}>
      {mounted ? <Viewer key={generation} renders={renders} /> : null}
    </Suspense>
  );
}

/** A new `renders` only renders the viewer again (see `__lifecycle.rerender`). */
function Viewer(_props: { renders: number }) {
  // Only a data source waits for its bytes: suspending for a URL would delay
  // PdfDocument's render, which starts loading pdf.js and the PDF.
  const data = settings.source === "data" ? use(bytesPromise) : null;
  const [sidebar, setSidebar] = useState<SidebarView | null>(null);
  // A new object at every render: the document stays open while its URL or
  // its bytes stay the same.
  const password = settings.password !== null ? { password: settings.password } : {};
  const source: PdfSource = data ? { data, ...password } : { url, ...password };
  return (
    <Profiler id="viewer" onRender={countCommit}>
      <PdfDocument source={source} options={viewerOptions}>
        <Toolbar
          sidebar={sidebar}
          onToggleSidebar={(view) => setSidebar((open) => (open === view ? null : view))}
        />
        <PasswordPrompt />
        {sidebar ? <Sidebar view={sidebar} id="sidebar" /> : null}
        <PdfViewport
          className={sidebar ? "viewport with-sidebar" : "viewport"}
          {...(japanese ? { label: "PDF 文書", pageLabel } : {})}
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
  sidebar,
  onToggleSidebar,
}: {
  sidebar: SidebarView | null;
  onToggleSidebar: (view: SidebarView) => void;
}) {
  const viewer = usePdfViewer();
  const navigation = usePdfNavigation();
  const outline = usePdfOutline();
  const hasOutline = outline !== null && outline.length > 0;
  const hasLayers = usePdfState((state) => (state.layers?.length ?? 0) > 0);
  const hasAttachments = usePdfState((state) => (state.attachments?.length ?? 0) > 0);
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
  (window as { __pdfDocument?: unknown }).__pdfDocument = usePdfDocument() ?? undefined;
  const status = usePdfState((state) => state.status);
  const error = usePdfState((state) => state.error);
  const progress = usePdfState((state) => state.progress);
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  const label = usePdfState((state) => state.pageLabels?.[state.currentPage] ?? null);
  const title = usePdfState((state) => state.metadata?.title ?? null);
  const scale = usePdfState((state) => state.scale);
  const zoomMode = usePdfState((state) => state.zoomMode);
  const spread = usePdfState((state) => state.spread);
  const scrollMode = usePdfState((state) => state.scrollMode);
  const tool = usePdfState((state) => state.tool);
  const sidebarButton = (view: SidebarView, text: string) => (
    <button
      type="button"
      aria-expanded={sidebar === view}
      aria-controls={sidebar === view ? "sidebar" : undefined}
      onClick={() => onToggleSidebar(view)}
    >
      {text}
    </button>
  );
  const pageText =
    status === "ready"
      ? `${label ?? page + 1} (${page + 1} / ${pageCount})`
      : status === "loading" && progress
        ? `Loading ${Math.round(progress.loaded / 1024)} KiB${progress.total ? ` of ${Math.round(progress.total / 1024)}` : ""}`
        : (error ?? status);
  return (
    <header className="toolbar">
      {hasOutline ? sidebarButton("outline", "Outline") : null}
      {sidebarButton("thumbnails", "Thumbnails")}
      {hasLayers ? sidebarButton("layers", "Layers") : null}
      {hasAttachments ? sidebarButton("attachments", "Attachments") : null}
      <button type="button" onClick={back} disabled={!navigation.canGoBack}>
        Back
      </button>
      <strong title={title ?? undefined}>ParaPDF prototype</strong>
      <span className="engine">{viewer.engineName}</span>
      <button type="button" onClick={() => viewer.previousPage()} aria-label="Previous page">
        ‹
      </button>
      <span>{pageText}</span>
      <button type="button" onClick={() => viewer.nextPage()} aria-label="Next page">
        ›
      </button>
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
      <button
        type="button"
        aria-pressed={zoomMode === "fit-page"}
        onClick={() => viewer.setScale("fit-page")}
      >
        Fit page
      </button>
      <select
        aria-label="Spread"
        value={spread}
        onChange={(event) => viewer.setSpread(event.target.value as SpreadMode)}
      >
        <option value="none">Single pages</option>
        <option value="odd">Odd spreads</option>
        <option value="even">Even spreads</option>
      </select>
      <select
        aria-label="Scrolling"
        value={scrollMode}
        onChange={(event) => viewer.setScrollMode(event.target.value as ScrollMode)}
      >
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
        <option value="wrapped">Wrapped</option>
        <option value="page">Page by page</option>
      </select>
      <button
        type="button"
        aria-pressed={tool === "hand"}
        onClick={() => viewer.setTool(tool === "hand" ? "select" : "hand")}
      >
        Hand tool
      </button>
      <button type="button" onClick={() => viewer.rotate(-90)} aria-label="Rotate counterclockwise">
        ↺
      </button>
      <button type="button" onClick={() => viewer.rotate(90)} aria-label="Rotate clockwise">
        ↻
      </button>
      <button type="button" onClick={() => void viewer.print()} disabled={status !== "ready"}>
        Print
      </button>
      <button type="button" onClick={() => void viewer.download()} disabled={status !== "ready"}>
        Download
      </button>
      {viewer.textLayer ? <SearchBox /> : null}
    </header>
  );
}
