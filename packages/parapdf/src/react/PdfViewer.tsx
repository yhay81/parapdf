"use client";

import {
  type CSSProperties,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type InitialViewOptions, initialViewOpening } from "../features/initial-view.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import type { AnnotationLabels } from "../pdfjs/editor.ts";
import type { Direction, ScrollMode, SpreadMode } from "../view/layout.ts";
import type { ViewerOptions } from "../view/options.ts";
import type { PointerTool, ViewerState } from "../view/state.ts";
import {
  attachPage,
  attachViewport,
  openViewer,
  setViewerOptions,
  type Viewer,
} from "../view/viewer.ts";
import { PageContext, useSelected, useSession } from "./context.ts";
import { setFeatureOptions, useViewer } from "./features.ts";
import { VIEWER_CSS } from "./styles.ts";

/** A zoom: CSS pixels per PDF point, or a fit that keeps fitting as the viewport resizes. */
export type Zoom = number | "fit-width" | "fit-page";

/** Each view setting a `<PdfViewer>` controls or leaves to the viewer, by its prop. */
interface ViewValues {
  zoom: Zoom;
  rotation: Rotation;
  spread: SpreadMode;
  scrollMode: ScrollMode;
  tool: PointerTool;
}

export interface PdfViewerProps extends InitialViewOptions {
  /**
   * The viewer to show the document with, from `useViewer()`, for the
   * hooks and functions that act through it; without it, the component
   * uses one of its own.
   */
  viewer?: Viewer;

  /**
   * The zoom, controlled: a scale in CSS pixels per point, "fit-width" to
   * keep fitting the width of the current page, or "fit-page" to keep
   * fitting all of it. The viewer reports its own changes through
   * `onZoomChange` and returns to this once React renders without it.
   */
  zoom?: Zoom;
  /** The zoom a document opens with while `zoom` is not given (default "fit-width"). */
  defaultZoom?: Zoom;
  /** Hears the zoom change, as the reader zooms or a method of the viewer does. */
  onZoomChange?: (zoom: Zoom) => void;
  /** The clockwise rotation of every page, controlled, as `zoom` is. */
  rotation?: Rotation;
  defaultRotation?: Rotation;
  onRotationChange?: (rotation: Rotation) => void;
  /** One page per row ("none"), or pairs side by side; controlled, as `zoom` is. */
  spread?: SpreadMode;
  defaultSpread?: SpreadMode;
  onSpreadChange?: (spread: SpreadMode) => void;
  /** How pages are arranged and scrolled; controlled, as `zoom` is. */
  scrollMode?: ScrollMode;
  defaultScrollMode?: ScrollMode;
  onScrollModeChange?: (scrollMode: ScrollMode) => void;
  /** What a mouse drag does: select text, or scroll with the hand tool; controlled, as `zoom` is. */
  tool?: PointerTool;
  defaultTool?: PointerTool;
  onToolChange?: (tool: PointerTool) => void;
  /** The zero-based page a document opens at, at the top of the viewport (default 0). */
  defaultPage?: number;
  /**
   * Hears the current page change as the reader scrolls, follows a link,
   * or `goToPage()` shows another; it is never set but by `goToPage()`.
   */
  onPageChange?: (pageIndex: number) => void;

  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
  /**
   * Build annotation layers (default true): focusable links, comment popups,
   * and, with `forms`, form fields.
   */
  annotationLayer?: boolean;
  /**
   * Show form fields as HTML that the reader can fill in (default false: the
   * drawing shows them as they are). Typed values belong to the document,
   * which `save()` writes them into. Needs `annotationLayer`.
   * `useFormChange()` hears what the reader enters. Its code loads only
   * when set.
   */
  forms?: boolean;
  /**
   * Let the reader create highlights, text, drawings, images, and
   * signatures on the pages (default false); see `useAnnotations()`.
   * `save()` writes them into the document, with those other viewers of it
   * create. Its code loads only when set.
   */
  annotationEditing?: boolean;
  /** The accessible names of the annotation editor's controls, by default in English. */
  annotationLabels?: Partial<AnnotationLabels>;
  /**
   * Follow what the document permits (default false, as in pdf.js): without
   * permission to copy, its text cannot be selected or copied, though it
   * stays readable by assistive technology and `getText()`; without
   * permission to print, `print()` fails; without permission to annotate,
   * annotations cannot be created, and form fields can be filled in only
   * with permission to fill forms. `useDocumentState()` tells the application.
   */
  enforcePermissions?: boolean;
  /**
   * Whether links and the outline take the zoom their destination asks for
   * (default true), as in pdf.js. With false, they keep the zoom and only scroll.
   */
  destinationZoom?: boolean;
  /**
   * The order of pages in a row: "rtl" puts the earlier page of a spread on
   * the right and runs rows from right to left, for documents read from the
   * right; ← and → follow it. Unset, the document's /ViewerPreferences
   * /Direction decides, and "ltr" where it says nothing. The view state's
   * `direction` holds the order shown.
   */
  direction?: Direction;
  /**
   * What links to other documents do: open in a new tab (the default), or
   * nothing, for apps that must not lead away from the document. Internal
   * links and the outline keep working.
   */
  externalLinks?: "new-tab" | "disabled";
  /**
   * Called when the reader opens a file attachment annotation or a link to
   * an embedded file. By default the browser downloads the file.
   */
  openAttachment?: (attachment: { filename: string; content: Uint8Array }) => void;
  /**
   * Draw pages in these two colors instead of their own, for example
   * `{ background: "Canvas", foreground: "CanvasText" }` in forced-colors mode.
   */
  pageColors?: PageColors;
  /** Space between pages in CSS pixels (default 12). */
  gap?: number;
  /** Pages mounted beyond each edge of the viewport (default 2). */
  overscan?: number;
  /** The smallest and largest scale the reader may zoom to (default 0.25 and 10). */
  minScale?: number;
  maxScale?: number;
  /** Pages drawn at once (default 2). */
  maxConcurrentRenders?: number;
  /**
   * The most pixels one page's detail canvas holds (default 16 777 216, the
   * canvas area limit of iOS). A page larger at full resolution gets detail
   * only for its visible area plus a margin, still at full resolution.
   */
  maxDetailPixels?: number;
  /**
   * The most pixels one page's detail canvas holds, as a multiple of the
   * viewport's device pixels (default unlimited); `maxDetailPixels` still caps it.
   */
  maxDetailViewports?: number;
  /** The most pixels one page's base canvas holds (default 2 097 152). */
  maxBasePixels?: number;
  /**
   * The most pixels all of this viewer's canvases hold together (default
   * unlimited), for memory-capped browsers such as iOS Safari. Visible
   * pages come first, and a visible page never goes blank.
   */
  maxCanvasPixels?: number;
  /**
   * The most pixels kept of the canvases of pages that leave the mounted
   * window, so that a page the reader comes back to shows at once (default
   * six viewports' worth of device pixels; 0 keeps none).
   */
  maxKeptPixels?: number;

  className?: string;
  style?: CSSProperties;
  /** Accessible name of the scroll container (default "PDF document"). */
  label?: string;
  /**
   * Accessible name of each page, in the application's language (default
   * "Page 3 of 12"). Called while rendering, for every mounted page.
   */
  pageLabel?: (pageNumber: number, pageCount: number) => string;
  /**
   * Content drawn over a page, rendered through a portal into a layer of
   * the page above its drawing and text; position it with `<PdfPageRect>`.
   */
  renderOverlay?: (pageIndex: number) => ReactNode;
}

/** The annotation editor's styles, loaded only by viewers that edit annotations. */
const EditorStyles = lazy(async () => {
  const { EDITOR_CSS } = await import("./editor-styles.ts");
  return {
    default: () => (
      <style href="parapdf-editor" precedence="parapdf">
        {EDITOR_CSS}
      </style>
    ),
  };
});

const defaultPageLabel = (pageNumber: number, pageCount: number) =>
  `Page ${pageNumber} of ${pageCount}`;

const zoomOf = (state: ViewerState): Zoom =>
  state.zoomMode === "custom" ? state.scale : state.zoomMode;

const viewOf = (state: ViewerState): ViewValues => ({
  zoom: zoomOf(state),
  rotation: state.rotation,
  spread: state.spread,
  scrollMode: state.scrollMode,
  tool: state.tool,
});

const VIEW_KEYS = ["zoom", "rotation", "spread", "scrollMode", "tool"] as const;

/** Show each controlled value the viewer does not show. */
function applyControlled(viewer: Viewer, controlled: Partial<ViewValues>): void {
  const state = viewer.store.get();
  const shown = viewOf(state);
  const { zoom, rotation, spread, scrollMode, tool } = controlled;
  if (spread !== undefined && spread !== shown.spread) viewer.setSpread(spread);
  if (scrollMode !== undefined && scrollMode !== shown.scrollMode) {
    viewer.setScrollMode(scrollMode);
  }
  if (rotation !== undefined && rotation !== shown.rotation) viewer.setRotation(rotation);
  if (tool !== undefined && tool !== shown.tool) viewer.setTool(tool);
  // A zoom needs pages to zoom; the first layout takes it as the initial one.
  if (zoom !== undefined && zoom !== shown.zoom && state.layout) viewer.setScale(zoom);
}

/**
 * One viewport onto the document of the nearest `<PdfDocument>`: the
 * scroll container, with only the pages in the viewer's window mounted.
 * Scrolling renders this component again only when that window changes.
 * It is focusable, so the browser's own keys scroll it.
 */
export function PdfViewer(props: PdfViewerProps) {
  return props.viewer ? (
    <ViewerViewport {...props} viewer={props.viewer} />
  ) : (
    <OwnViewer {...props} />
  );
}

function OwnViewer(props: PdfViewerProps) {
  return <ViewerViewport {...props} viewer={useViewer()} />;
}

function ViewerViewport({
  viewer,
  zoom,
  defaultZoom,
  onZoomChange,
  rotation,
  defaultRotation,
  onRotationChange,
  spread,
  defaultSpread,
  onSpreadChange,
  scrollMode,
  defaultScrollMode,
  onScrollModeChange,
  tool,
  defaultTool,
  onToolChange,
  defaultPage,
  onPageChange,
  initialView,
  initialViewState,
  forms = false,
  annotationEditing = false,
  annotationLabels,
  enforcePermissions = false,
  textLayer,
  annotationLayer,
  destinationZoom,
  direction,
  externalLinks,
  openAttachment,
  pageColors,
  gap,
  overscan,
  minScale,
  maxScale,
  maxConcurrentRenders,
  maxDetailPixels,
  maxDetailViewports,
  maxBasePixels,
  maxCanvasPixels,
  maxKeptPixels,
  className,
  style,
  label = "PDF document",
  pageLabel = defaultPageLabel,
  renderOverlay,
}: PdfViewerProps & { viewer: Viewer }) {
  const session = useSession();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const layout = useSelected(viewer.store.hot, (state) => state.layout);
  const first = useSelected(viewer.store.hot, (state) => state.first);
  const last = useSelected(viewer.store.hot, (state) => state.last);

  const initialScale = zoom ?? defaultZoom;
  const initialRotation = rotation ?? defaultRotation;
  const initialSpread = spread ?? defaultSpread;
  const initialScrollMode = scrollMode ?? defaultScrollMode;
  const initialTool = tool ?? defaultTool;
  const explicit = {
    ...(initialScale !== undefined ? { initialScale } : {}),
    ...(initialSpread !== undefined ? { initialSpread } : {}),
    ...(initialScrollMode !== undefined ? { initialScrollMode } : {}),
    ...(defaultPage !== undefined ? { initialPage: defaultPage } : {}),
  };
  const options: ViewerOptions = {
    ...explicit,
    ...(initialRotation !== undefined ? { initialRotation } : {}),
    ...(initialTool !== undefined ? { initialTool } : {}),
    opening: initialViewOpening({ initialView, initialViewState, ...explicit }),
    textLayer,
    annotationLayer,
    destinationZoom,
    direction,
    externalLinks,
    openAttachment,
    pageColors,
    gap,
    overscan,
    minScale,
    maxScale,
    maxConcurrentRenders,
    maxDetailPixels,
    maxDetailViewports,
    maxBasePixels,
    maxCanvasPixels,
    maxKeptPixels,
  };
  const controlled: Partial<ViewValues> = {
    ...(zoom !== undefined ? { zoom } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(spread !== undefined ? { spread } : {}),
    ...(scrollMode !== undefined ? { scrollMode } : {}),
    ...(tool !== undefined ? { tool } : {}),
  };
  const callbacks = {
    zoom: onZoomChange,
    rotation: onRotationChange,
    spread: onSpreadChange,
    scrollMode: onScrollModeChange,
    tool: onToolChange,
    page: onPageChange,
  };
  const latest = useRef({ controlled, callbacks });
  /** The view as last reported, or as the application set it: it hears no echo of its own values. */
  const reported = useRef<ViewValues | null>(null);
  // A change the application did not take up renders this again, which
  // returns the viewer to the controlled value.
  const [, reconcile] = useReducer((count: number) => count + 1, 0);

  // Options are live: the viewer compares them with those it has. Features
  // the options ask for attach before a document opens, which waits for
  // those that change how pages are drawn.
  useLayoutEffect(() => {
    setViewerOptions(viewer, options);
    setFeatureOptions(viewer, { forms, annotationEditing, annotationLabels, enforcePermissions });
    latest.current = { controlled, callbacks };
    reported.current = { ...(reported.current ?? viewOf(viewer.store.get())), ...controlled };
    applyControlled(viewer, controlled);
  });

  // The viewer's own changes are reported from its store, not React state.
  useEffect(() => {
    reported.current ??= viewOf(viewer.store.get());
    let page = viewer.store.get().currentPage;
    let laidOut = viewer.store.get().layout !== null;
    return viewer.store.subscribe(() => {
      const state = viewer.store.get();
      const view = viewOf(state);
      const { controlled, callbacks } = latest.current;
      // The first layout of a document may come after a controlled value changed.
      let differs = !laidOut && state.layout !== null;
      laidOut = state.layout !== null;
      const last = reported.current ?? view;
      for (const key of VIEW_KEYS) {
        if (Object.is(view[key], last[key])) continue;
        (callbacks[key] as ((value: unknown) => void) | undefined)?.(view[key]);
        if (controlled[key] !== undefined) differs = true;
      }
      reported.current = view;
      if (state.currentPage !== page) {
        page = state.currentPage;
        callbacks.page?.(page);
      }
      if (differs && VIEW_KEYS.some((key) => controlled[key] !== undefined)) reconcile();
    });
  }, [viewer]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    return attachViewport(viewer, scroller, content);
  }, [viewer]);

  // The viewer shows the session until it closes, also while this unmounts.
  useEffect(() => openViewer(viewer, session), [viewer, session]);

  const pages: ReactNode[] = [];
  if (layout) {
    const { shown } = layout;
    const pageCount = layout.sizes.length;
    const centered = layout.scrollMode === "horizontal" || shown !== null;
    for (let index = first; index <= last; index++) {
      pages.push(
        <PdfPage
          key={index}
          viewer={viewer}
          index={index}
          label={pageLabel(index + 1, pageCount)}
          top={layout.tops[index] ?? 0}
          gap={layout.gap}
          rowWidth={layout.rowWidths[index] ?? 0}
          rowHeight={centered ? (layout.rowHeights[index] ?? 0) : null}
          hidden={shown !== null && (index < shown.first || index > shown.last)}
          offset={layout.offsets[index] ?? 0}
          width={layout.widths[index] ?? 0}
          height={layout.heights[index] ?? 0}
          scale={layout.scale}
          rotation={layout.rotation}
          overlay={renderOverlay?.(index)}
        />,
      );
    }
  }

  return (
    <div
      ref={scrollerRef}
      className={className ? `parapdf-viewport ${className}` : "parapdf-viewport"}
      // The scroller is the query container whose size `cqw` and `cqh`
      // measure for page placement. A stable gutter keeps its width from
      // changing as the scrollbar comes and goes, which would refit
      // "fit-width" back and forth.
      // Touches pan it natively, but pinches zoom the document through the
      // viewer instead of zooming the whole page.
      style={{
        overflow: "auto",
        contain: "strict",
        containerType: "size",
        scrollbarGutter: "stable",
        touchAction: "pan-x pan-y",
        ...style,
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a focusable scroll container is what lets keyboard users scroll it.
      tabIndex={0}
      role="document"
      aria-label={label}
    >
      {/* React hoists and deduplicates this into <head>. */}
      <style href="parapdf-viewer" precedence="parapdf">
        {VIEWER_CSS}
      </style>
      {annotationEditing ? (
        <Suspense fallback={null}>
          <EditorStyles />
        </Suspense>
      ) : null}
      {/* The viewer sizes this element imperatively so zoom can restore the scroll position first. */}
      <div ref={contentRef} className="parapdf-pages" style={{ position: "relative" }}>
        {pages}
      </div>
    </div>
  );
}

interface PdfPageProps {
  viewer: Viewer;
  index: number;
  /** Accessible name of the page. */
  label: string;
  top: number;
  /** Space between pages and around the document, in CSS pixels. */
  gap: number;
  /** The width of the page's row, and the page's distance from the row's left edge. */
  rowWidth: number;
  /** The height of the page's row where rows are centered in the viewport's height, else null. */
  rowHeight: number | null;
  /** In "page" mode, a page beside the row shown: mounted, and drawn, before a flip shows it. */
  hidden: boolean;
  offset: number;
  width: number;
  height: number;
  /** CSS pixels per PDF point; pdf.js's text layer reads it as `--total-scale-factor`. */
  scale: number;
  rotation: Rotation;
  overlay: ReactNode;
}

/** The layer an overlay's portal renders into; none on the server, which mounts no pages. */
const createOverlayLayer = (): HTMLDivElement | null => {
  if (typeof document === "undefined") return null;
  const layer = document.createElement("div");
  layer.className = "parapdf-overlay-layer";
  return layer;
};

const PdfPage = memo(function PdfPage({
  viewer,
  index,
  label,
  top,
  gap,
  rowWidth,
  rowHeight,
  hidden,
  offset,
  width,
  height,
  scale,
  rotation,
  overlay,
}: PdfPageProps) {
  const hostRef = useRef<HTMLElement>(null);
  const [overlayLayer] = useState(createOverlayLayer);
  const page = useMemo(() => ({ viewer, pageIndex: index }), [viewer, index]);
  const hasOverlay = overlay !== null && overlay !== undefined && overlay !== false;

  // The renderer builds the page's canvases and layers at the start of the
  // section; the overlay's layer follows them.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return attachPage(viewer, index, host);
  }, [viewer, index]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !overlayLayer || !hasOverlay) return;
    host.append(overlayLayer);
    return () => overlayLayer.remove();
  }, [overlayLayer, hasOverlay]);

  // Overlays are placed on the unturned page, like the text layer, and
  // turn with it through the viewer CSS.
  useLayoutEffect(() => {
    if (!overlayLayer) return;
    overlayLayer.dataset.mainRotation = String(rotation);
    const turned = rotation % 180 !== 0;
    overlayLayer.style.width = `${turned ? height : width}px`;
    overlayLayer.style.height = `${turned ? width : height}px`;
  }, [overlayLayer, rotation, width, height]);

  return (
    // A labelled section is a region landmark, the role pdf.js gives its pages.
    <section
      ref={hostRef}
      data-page={index + 1}
      aria-label={label}
      style={
        {
          position: "absolute",
          // Its row centered in the viewport, at the gap when larger:
          // pageLeft() and pageTop() in layout.ts.
          top:
            rowHeight === null
              ? top
              : `calc(${top}px + max(0px, (100cqh - ${rowHeight}px) / 2 - ${gap}px))`,
          left: `calc(max(${gap}px, (100cqw - ${rowWidth}px) / 2) + ${offset}px)`,
          visibility: hidden ? "hidden" : undefined,
          width,
          height,
          background: "#fff",
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)",
          contain: "strict",
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as CSSProperties
      }
    >
      {overlayLayer && hasOverlay
        ? createPortal(<PageContext value={page}>{overlay}</PageContext>, overlayLayer)
        : null}
    </section>
  );
});
