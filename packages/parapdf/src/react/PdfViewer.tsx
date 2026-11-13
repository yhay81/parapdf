"use client";

import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  followFragments,
  type InitialViewOptions,
  initialViewOpening,
  openingFragment,
} from "../features/initial-view.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import type { Direction, PdfPagePoint, ScrollMode, SpreadMode } from "../view/layout.ts";
import type { ViewerOptions } from "../view/options.ts";
import type { FitMode, PointerTool, ViewerState } from "../view/state.ts";
import type { ViewState } from "../view/view-state.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { useOptionalSession, useOptionalViewer, useSelected, ViewerContext } from "./context.ts";
import { usePageOverlays } from "./overlays.ts";
import { VIEWER_CSS } from "./styles.ts";

/** A zoom: CSS pixels per PDF point, or a fit that keeps fitting as the viewport resizes. */
export type Zoom = number | FitMode;

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
   * The viewer to show the document with, from `useCreateViewer()`; without
   * it, `<PdfViewer>` uses the viewer of the nearest `<PdfView>` or
   * `<PdfDocument>` (`useViewer()`).
   */
  viewer?: Viewer;
  /** Receives the `Viewer` this viewport shows while mounted. */
  ref?: Ref<Viewer>;

  /**
   * The zoom, controlled: a scale in CSS pixels per point, "fit-width" to
   * keep fitting the width of the current page, "fit-page" to keep
   * fitting all of it, or "auto" to keep fitting as pdf.js's viewer opens
   * documents: a portrait page's width, a landscape page whole, never above
   * 5/3 (pdf.js's 125%). The viewer reports its own changes through
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
  /**
   * Hears the serializable `ViewState` change for bookmarking or restoring
   * the view (`initialViewState`): once after scrolling settles (never per
   * frame), synchronously on compound navigation, zoom, rotation, spread, or
   * scroll-mode changes, and on `pagehide` or viewport unmount when a scroll
   * has not yet settled. Never echoes the initial view on open.
   */
  onViewStateChange?: (viewState: ViewState) => void;

  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
  /**
   * Build annotation layers (default true): focusable links, comment popups,
   * and, with `<PdfForms>`, form fields.
   */
  annotationLayer?: boolean;
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
   * twelve viewports' worth of device pixels; 0 keeps none).
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
   * Called when the reader clicks a shown page (ignoring drags, non-collapsed
   * text selections, links, form controls, and active annotation drawing
   * tools), with the clicked point in unturned PDF points (`<PdfPageRect>`'s
   * coordinates) and the React mouse event.
   */
  onPageClick?: (point: PdfPagePoint, event: ReactMouseEvent<HTMLDivElement>) => void;
  /**
   * Feature components (`<PdfForms>`, `<PdfAnnotationEditor>`,
   * `<PdfAutoLinks>`, `<PdfPermissions>`), page overlays (`<PdfPageOverlay>`,
   * `<PdfPageOverlays>`), and selection popovers (`<PdfSelectionPopover>`)
   * mounted for this viewer.
   */
  children?: ReactNode;
}

const INTERACTIVE_CLICK_TARGETS =
  "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [contenteditable], .parapdf-annotation-layer section, .parapdf-editor-layer .annotationEditor, .parapdf-editor-layer .editToolbar";

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
function applyControlled(viewer: ViewerController, controlled: Partial<ViewValues>): void {
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
export function PdfViewer({ viewer: externalViewer, ref, ...props }: PdfViewerProps) {
  const viewer = useOptionalViewer(externalViewer);
  useImperativeHandle(ref, () => viewer, [viewer]);
  const viewport = <ViewerViewport {...props} viewer={viewer} />;
  return externalViewer ? <ViewerContext value={viewer}>{viewport}</ViewerContext> : viewport;
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
  onViewStateChange,
  initialView,
  initialViewState,
  textLayer,
  annotationLayer,
  destinationZoom,
  direction,
  externalLinks,
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
  onPageClick,
  children,
}: PdfViewerProps & { viewer: ViewerController }) {
  const session = useOptionalSession();
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
  const { fragment } = session;
  const options: ViewerOptions = {
    ...explicit,
    ...(initialRotation !== undefined ? { initialRotation } : {}),
    ...(initialTool !== undefined ? { initialTool } : {}),
    opening: initialViewOpening({
      initialView,
      initialViewState,
      ...explicit,
      fragment: () => openingFragment(viewer, fragment),
    }),
    textLayer,
    annotationLayer,
    destinationZoom,
    direction,
    externalLinks,
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
    viewState: onViewStateChange,
  };
  const latest = useRef({ controlled, callbacks });
  /** The view as last reported, or as the application set it: it hears no echo of its own values. */
  const reported = useRef<ViewValues | null>(null);
  // A change the application did not take up renders this again, which
  // returns the viewer to the controlled value.
  const [, reconcile] = useReducer((count: number) => count + 1, 0);

  // Options are live: the viewer compares them with those it has.
  useLayoutEffect(() => {
    latest.current = { controlled, callbacks };
    reported.current = { ...(reported.current ?? viewOf(viewer.store.get())), ...controlled };
    viewer.batchView(() => {
      viewer.configure(options);
      applyControlled(viewer, controlled);
    });
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
    return viewer.attachViewport(scroller, content);
  }, [viewer]);

  // Registered after attachViewport so viewport detach flushes unsettled
  // scroll positions before unsubscribing.
  useLayoutEffect(() => {
    const unsubscribe = viewer.onViewStateChange((view) => {
      latest.current.callbacks.viewState?.(view);
    });
    const onPageHide = () => viewer.flushViewState();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
    };
  }, [viewer]);

  // The viewer shows the session until it closes, also while this unmounts.
  useEffect(() => viewer.open(session), [viewer, session]);

  // A new fragment of the source's URL moves the viewer where it points.
  useEffect(() => {
    return followFragments(viewer, fragment);
  }, [viewer, fragment]);

  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = onPageClick
    ? (event: ReactPointerEvent<HTMLDivElement>) => {
        pointerDownRef.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      }
    : undefined;
  const handleClick = onPageClick
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        const down = pointerDownRef.current;
        pointerDownRef.current = null;
        if (event.defaultPrevented || event.button !== 0 || viewer.pointerClaimed) return;
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(INTERACTIVE_CLICK_TARGETS)) return;
        const selection = (event.currentTarget.ownerDocument ?? document).getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          viewer.content &&
          selection.anchorNode &&
          viewer.content.contains(selection.anchorNode)
        ) {
          return;
        }
        const point = viewer.pointAt(event);
        if (point) onPageClick(point, event);
      }
    : undefined;

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
        />,
      );
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: onPageClick is a pointer coordinate hook for page surfaces; interactive items inside pages keep their own accessible controls.
    <div
      ref={scrollerRef}
      className={className ? `parapdf-viewport ${className}` : "parapdf-viewport"}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
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
      {children}
      {/* The viewer sizes this element imperatively so zoom can restore the scroll position first. */}
      <div ref={contentRef} className="parapdf-pages" style={{ position: "relative" }}>
        {pages}
      </div>
    </div>
  );
}

interface PdfPageProps {
  viewer: ViewerController;
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
  /** CSS pixels per PDF point; the DOM layers apply the page's user-space unit to it. */
  scale: number;
  rotation: Rotation;
}

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
}: PdfPageProps) {
  const hostRef = useRef<HTMLElement>(null);
  const page = useMemo(() => ({ viewer, pageIndex: index }), [viewer, index]);

  // The renderer builds the page's canvases and layers at the start of the
  // section; the overlay's layer follows them.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return viewer.attachPage(index, host);
  }, [viewer, index]);

  const overlayPortal = usePageOverlays(viewer, index, hostRef, page, rotation, width, height);

  return (
    // A labelled section is a region landmark, the role pdf.js gives its pages.
    <section
      ref={hostRef}
      data-page={index + 1}
      aria-label={label}
      // Focusable, out of the tab order: the viewer moves the focus to the
      // page shown, and a screen reader reads on from it.
      tabIndex={-1}
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
          "--scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as CSSProperties
      }
    >
      {overlayPortal}
    </section>
  );
});
