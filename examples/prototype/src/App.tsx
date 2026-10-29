import * as parapdf from "parapdf";
import {
  download,
  historyOf,
  PdfDocument,
  type PdfjsDocumentOptions,
  type PdfPageMode,
  PdfPageRect,
  type PdfSource,
  PdfViewer,
  type Viewer as PdfViewerController,
  type PdfViewerProps,
  print,
  type ScrollMode,
  type SpreadMode,
  searchOf,
  useAnnotationEditing,
  useAttachments,
  useDocumentState,
  useFormChange,
  useHistory,
  useInitialView,
  useLayers,
  useMetadata,
  useOutline,
  usePageLabels,
  useSession,
  useViewer,
  useViewState,
} from "parapdf";
import type { PDFDataRangeTransport } from "pdfjs-dist";
import {
  lazy,
  Profiler,
  type ProfilerOnRenderCallback,
  Suspense,
  use,
  useEffect,
  useState,
} from "react";
import { AnnotationToolbar } from "./AnnotationToolbar.tsx";
import { BenchDriver } from "./BenchDriver.tsx";
import { configureEngine, type Pdfjs } from "./engines.ts";
import { attachViewport, showWith } from "./internals.ts";
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
    : "new-tab") as PdfViewerProps["externalLinks"],
  /** Scripted scroll speed in CSS pixels per second; 0 disables the benchmark driver. */
  autoscroll: Number(params.get("autoscroll") ?? "0"),
  durationMs: Number(params.get("duration") ?? "4000"),
  // Idle baseline from calibrate.html; the defaults suit Chromium at 60 Hz.
  idle: {
    timerLagP95Ms: Number(params.get("idleLag") ?? "2"),
    frameIntervalMs: Number(params.get("idleFrame") ?? "16.7"),
  },
  /**
   * "data" opens the PDF from bytes the application fetched instead of from
   * its URL, and "range" through a transport that fetches the ranges pdf.js
   * asks for with code of its own.
   */
  source: (["data", "range"].includes(params.get("source") ?? "") ? params.get("source") : "url") as
    | "url"
    | "data"
    | "range",
  /** The password the source carries; the viewer asks for one when it is absent or wrong. */
  password: params.get("password"),
  /** URLs and e-mail addresses in the text become links. */
  autoLinks: params.get("autoLinks") === "1",
  /** Form fields the reader can fill in. */
  forms: params.get("forms") === "1",
  /** The document's scripts run in its form fields. */
  formScripts: params.get("scripts") === "1",
  /** Highlights, text, drawings, images, and signatures the reader creates. */
  annotations: params.get("annotations") === "1",
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
  /** "ltr" or "rtl" orders pages; unset, the document's /ViewerPreferences decide. */
  direction: (["ltr", "rtl"].includes(params.get("direction") ?? "")
    ? params.get("direction")
    : undefined) as PdfViewerProps["direction"],
  /**
   * "document" opens the document where and as it asks, and its sidebar
   * panel; `spread`, `scroll`, `page`, and `scale` still win when given.
   */
  initialView: (params.get("view") === "document"
    ? "document"
    : "options") as PdfViewerProps["initialView"],
  /** "0" keeps the zoom when following links and the outline. */
  destinationZoom: params.get("destinationZoom") !== "0",
  /** "1" follows what the document permits. */
  enforcePermissions: params.get("permissions") === "1",
  /** A view kept from `getViewState()`, as JSON, to open with. */
  viewState: params.has("viewState")
    ? (JSON.parse(params.get("viewState") ?? "{}") as PdfViewerProps["initialViewState"])
    : undefined,
  /** The one-based page shown first. */
  initialPage: Number(params.get("page") ?? "1") - 1,
  /** A scale in CSS pixels per point, "fit-width", "fit-page", or "auto". */
  initialScale: ((value): PdfViewerProps["defaultZoom"] =>
    value === "fit-page" || value === "fit-width" || value === "auto"
      ? value
      : value
        ? Number(value)
        : undefined)(params.get("scale")),
  /** CSS pixels per PDF point the zoom may reach; the runtime's default when absent. */
  maxScale: params.has("maxScale") ? Number(params.get("maxScale")) : undefined,
  /** More pdf.js getDocument parameters, as JSON. */
  documentOptions: params.has("documentOptions")
    ? (JSON.parse(params.get("documentOptions") ?? "{}") as PdfjsDocumentOptions)
    : undefined,
  /** Canvas pixel limits (PdfViewer's props); the runtime's defaults when absent. */
  canvasLimits: Object.fromEntries(
    [
      "maxDetailPixels",
      "maxDetailViewports",
      "maxBasePixels",
      "maxCanvasPixels",
      "maxKeptPixels",
    ].flatMap((name) => (params.has(name) ? [[name, Number(params.get(name))]] : [])),
  ) as Pick<
    PdfViewerProps,
    "maxDetailPixels" | "maxDetailViewports" | "maxBasePixels" | "maxCanvasPixels" | "maxKeptPixels"
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
    /** The ranges a transport source fetched, as [begin, end). */
    __ranges?: [number, number][];
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
/**
 * A transport whose ranges the demo fetches itself (`source=range`), each
 * listed in `window.__ranges`; pdf.js loads only then.
 */
const rangePromise: Promise<PDFDataRangeTransport | null> =
  settings.source === "range"
    ? Promise.all([fetch(url, { method: "HEAD" }), import("pdfjs-dist")]).then(
        ([head, { PDFDataRangeTransport: Transport }]) => {
          const ranges: [number, number][] = [];
          window.__ranges = ranges;
          class Fetched extends Transport {
            override requestDataRange(begin: number, end: number): void {
              ranges.push([begin, end]);
              fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
                .then((response) => response.arrayBuffer())
                .then((chunk) => this.onDataRange(begin, new Uint8Array(chunk)))
                .catch((error: unknown) => console.error("fetching a range failed", error));
            }
          }
          return new Fetched(Number(head.headers.get("Content-Length")), null);
        },
      )
    : Promise.resolve(null);
let bytes: Uint8Array | null = null;
void bytesPromise.then((loaded) => {
  bytes = loaded;
});
const viewerProps: PdfViewerProps = {
  textLayer: settings.text,
  annotationLayer: settings.links,
  externalLinks: settings.externalLinks,
  autoLinks: settings.autoLinks,
  forms: settings.forms,
  formScripts: settings.formScripts,
  annotationEditing: settings.annotations,
  // With the document's initial view, only the arrangement asked for wins over it.
  ...(settings.initialView === "options" || params.has("spread")
    ? { defaultSpread: settings.spread }
    : {}),
  ...(settings.initialView === "options" || params.has("scroll")
    ? { defaultScrollMode: settings.scrollMode }
    : {}),
  initialView: settings.initialView,
  destinationZoom: settings.destinationZoom,
  ...(settings.direction ? { direction: settings.direction } : {}),
  enforcePermissions: settings.enforcePermissions,
  ...(settings.viewState ? { initialViewState: settings.viewState } : {}),
  ...(settings.initialPage > 0 ? { defaultPage: settings.initialPage } : {}),
  ...(settings.initialScale !== undefined ? { defaultZoom: settings.initialScale } : {}),
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
      x={72}
      y={36}
      width={220}
      height={30}
      style={{ background: "rgb(255 213 0 / 0.3)", outline: "2px solid rgb(255 170 0)" }}
    />
  ) : null;

const SplitView = lazy(() => import("./SplitView.tsx"));

export function App() {
  const [fragment, setFragment] = useState(params.get("fragment") ?? "");
  useEffect(() => {
    window.__setFragment = setFragment;
  }, []);
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
      {params.get("split") === "1" ? (
        <SplitView
          source={{ url: fragment ? `${url}#${fragment}` : url }}
          passwordPrompt={settings.passwordPrompt}
          viewerProps={viewerProps}
        />
      ) : mounted ? (
        <Viewer key={generation} renders={renders} fragment={fragment} />
      ) : null}
    </Suspense>
  );
}

/** A new `renders` only renders the viewer again (see `__lifecycle.rerender`). */
function Viewer({ fragment }: { renders: number; fragment: string }) {
  // Only a data source waits for its bytes: suspending for a URL would delay
  // PdfDocument's render, which starts loading pdf.js and the PDF.
  const data = settings.source === "data" ? use(bytesPromise) : null;
  const range = settings.source === "range" ? use(rangePromise) : null;
  const viewer = useViewer();
  const [sidebar, setSidebar] = useState<SidebarView | null>(null);
  // Props a check sets on the viewer while it shows the document.
  const [changed, setChanged] = useState<Partial<PdfViewerProps>>({});
  useEffect(() => {
    window.__setViewerProps = (props) => setChanged((previous) => ({ ...previous, ...props }));
  }, []);
  // A new object at every render: the document stays open while its URL or
  // its bytes stay the same.
  const password = settings.password !== null ? { password: settings.password } : {};
  const source: PdfSource = data
    ? { data, ...password }
    : range
      ? { range, ...password }
      : { url: fragment ? `${url}#${fragment}` : url, ...password };
  return (
    <Profiler id="viewer" onRender={countCommit}>
      <PdfDocument source={source} passwordPrompt={settings.passwordPrompt}>
        <Toolbar
          viewer={viewer}
          sidebar={sidebar}
          onToggleSidebar={(view) => setSidebar((open) => (open === view ? null : view))}
          onOpenSidebar={setSidebar}
        />
        <Probes viewer={viewer} />
        {settings.annotations ? <AnnotationToolbar viewer={viewer} file={settings.file} /> : null}
        <PasswordPrompt />
        {sidebar ? <Sidebar viewer={viewer} view={sidebar} id="sidebar" /> : null}
        <PdfViewer
          {...viewerProps}
          {...changed}
          viewer={viewer}
          className={[
            "viewport",
            sidebar ? "with-sidebar" : "",
            settings.annotations ? "with-annotations" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          {...(japanese ? { label: "PDF 文書", pageLabel } : {})}
          renderOverlay={renderOverlay}
        />
        {settings.autoscroll > 0 ? (
          <BenchDriver
            viewer={viewer}
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

declare global {
  interface Window {
    /** The viewer and its features, for the Playwright checks; not part of the library surface. */
    __viewer?: parapdf.Viewer;
    /** The session of the viewer's document, whose state the checks read. */
    __session?: parapdf.PdfSession;
    /** The package's functions, which take the viewer. */
    __parapdf?: typeof parapdf;
    __search?: parapdf.Search;
    __history?: parapdf.History;
    __annotations?: parapdf.AnnotationEditing | null;
    /** The escape hatch: pdf.js's own PDFDocumentProxy, for check-rotation.ts. */
    __pdfDocument?: unknown;
    /** Hears what the reader enters into form fields (`useFormChange()`), for check-document.ts. */
    __onFormChange?: (change: parapdf.FormChange) => void;
    /** Shows a document opened with a pdf.js of the check's own, for check-options.ts. */
    __showWith?: typeof showWith;
    /** Binds a viewer to elements of the check's own, for check-options.ts. */
    __attachViewport?: typeof attachViewport;
    /** Changes props of the viewer's `<PdfViewer>`, which are live, for check-options.ts. */
    __setViewerProps?: (props: Partial<PdfViewerProps>) => void;
    /** Changes the fragment of the source's URL, for check-document.ts. */
    __setFragment?: (fragment: string) => void;
  }
}

// The package's functions, for the checks, in the split view too.
window.__parapdf = parapdf;
window.__showWith = showWith;
window.__attachViewport = attachViewport;

/** Exposes the viewer and its features to the checks: the same the toolbars use. */
function Probes({ viewer }: { viewer: PdfViewerController }) {
  const session = useSession();
  window.__viewer = viewer;
  window.__session = session;
  window.__search = searchOf(viewer);
  window.__history = historyOf(viewer);
  window.__annotations = useAnnotationEditing(viewer);
  // pdf.js's document once ready.
  window.__pdfDocument = useDocumentState((state) => state.status === "ready" && session.proxy)
    ? (session.proxy ?? undefined)
    : undefined;
  useFormChange(viewer, (change) => window.__onFormChange?.(change));
  return null;
}

/** The sidebar panel that shows what each /PageMode asks to show beside the pages. */
const PAGE_MODE_PANELS: Partial<Record<PdfPageMode, SidebarView>> = {
  UseOutlines: "outline",
  UseThumbs: "thumbnails",
  UseOC: "layers",
  UseAttachments: "attachments",
};

function Toolbar({
  viewer,
  sidebar,
  onToggleSidebar,
  onOpenSidebar,
}: {
  viewer: PdfViewerController;
  sidebar: SidebarView | null;
  onToggleSidebar: (view: SidebarView) => void;
  onOpenSidebar: (view: SidebarView) => void;
}) {
  const navigation = useHistory(viewer);
  const { back, forward } = navigation;

  // Alt+Left returns from a link jump and Alt+Right goes forward again, as
  // browsers do for pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") back();
        else forward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, forward]);
  const status = useDocumentState((state) => state.status);
  const error = useDocumentState((state) => state.error);
  // Progress only while it loads: pdf.js may fetch the rest in the background after.
  const progress = useDocumentState((state) =>
    state.status === "loading" ? state.progress : null,
  );
  const pageCount = useDocumentState((state) => state.pageCount);
  const canPrint = useDocumentState((state) => state.permissions?.print ?? true);
  const page = useViewState(viewer, (state) => state.currentPage);
  const scale = useViewState(viewer, (state) => state.scale);
  const zoomMode = useViewState(viewer, (state) => state.zoomMode);
  const spread = useViewState(viewer, (state) => state.spread);
  const scrollMode = useViewState(viewer, (state) => state.scrollMode);
  const tool = useViewState(viewer, (state) => state.tool);
  const pageNumbers = `${page + 1} / ${pageCount}`;
  const pageText =
    status === "ready"
      ? pageNumbers
      : status === "loading" && progress
        ? `Loading ${Math.round(progress.loaded / 1024)} KiB${progress.total ? ` of ${Math.round(progress.total / 1024)}` : ""}`
        : (error ?? status);
  return (
    <header className="toolbar">
      {/* The document's data loads apart from the pages, which never wait for it. */}
      <Suspense fallback={null}>
        <PanelButtons sidebar={sidebar} onToggleSidebar={onToggleSidebar} />
        {settings.initialView === "document" ? <AskedPanel onOpenSidebar={onOpenSidebar} /> : null}
      </Suspense>
      <button type="button" onClick={back} disabled={!navigation.canGoBack}>
        Back
      </button>
      <button type="button" onClick={forward} disabled={!navigation.canGoForward}>
        Forward
      </button>
      <Suspense fallback={<strong>ParaPDF prototype</strong>}>
        <Title />
      </Suspense>
      <span className="engine">{settings.engine}</span>
      <button type="button" onClick={() => viewer.previousPage()} aria-label="Previous page">
        ‹
      </button>
      {status === "ready" ? (
        <Suspense fallback={<span>{pageText}</span>}>
          <PageText page={page} numbers={pageNumbers} />
        </Suspense>
      ) : (
        <span>{pageText}</span>
      )}
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
      <button
        type="button"
        onClick={() => void print(viewer)}
        disabled={status !== "ready" || (settings.enforcePermissions && !canPrint)}
      >
        Print
      </button>
      <button type="button" onClick={() => void download(viewer)} disabled={status !== "ready"}>
        Download
      </button>
      {settings.text ? <SearchBox viewer={viewer} /> : null}
    </header>
  );
}

/** The buttons of the panels the document has something to show in. */
function PanelButtons({
  sidebar,
  onToggleSidebar,
}: {
  sidebar: SidebarView | null;
  onToggleSidebar: (view: SidebarView) => void;
}) {
  const hasOutline = useOutline().length > 0;
  const hasLayers = useLayers().length > 0;
  const hasAttachments = useAttachments().length > 0;
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
  return (
    <>
      {hasOutline ? sidebarButton("outline", "Outline") : null}
      {sidebarButton("thumbnails", "Thumbnails")}
      {hasLayers ? sidebarButton("layers", "Layers") : null}
      {hasAttachments ? sidebarButton("attachments", "Attachments") : null}
    </>
  );
}

/** Opens the panel the document asks for, once, as it opens. */
function AskedPanel({ onOpenSidebar }: { onOpenSidebar: (view: SidebarView) => void }) {
  const pageMode = useInitialView()?.pageMode ?? null;
  const asked = pageMode ? PAGE_MODE_PANELS[pageMode] : undefined;
  useEffect(() => {
    if (asked) onOpenSidebar(asked);
  }, [asked, onOpenSidebar]);
  return null;
}

/** The demo's name, titled with the document's own. */
function Title() {
  const title = useMetadata()?.title ?? null;
  return <strong title={title ?? undefined}>ParaPDF prototype</strong>;
}

/** The current page's label, and its number of the pages. */
function PageText({ page, numbers }: { page: number; numbers: string }) {
  const label = usePageLabels()?.[page] ?? null;
  return <span>{`${label ?? page + 1} (${numbers})`}</span>;
}
