"use client";

import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { PdfSessionController } from "../document/pdf-session.ts";
import type { PageSize } from "../document/session.ts";
import {
  followFragments,
  type InitialViewOptions,
  initialViewOpening,
  openingFragment,
} from "../features/initial-view.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import type { Direction, Layout, PdfPagePoint, ScrollMode, SpreadMode } from "../view/layout.ts";
import type { ViewerOptions } from "../view/options.ts";
import type { PointerTool, ViewerStoreKey } from "../view/state.ts";
import type { ViewState } from "../view/view-state.ts";
import type {
  ControlledViewValues,
  Viewer,
  ViewerControlBinding,
  ViewerController,
  Zoom,
} from "../view/viewer.ts";
import {
  useLayoutSnapshot,
  useOptionalSession,
  useOptionalViewer,
  ViewerContext,
} from "./context.ts";
import { type OverlayRenderer, PdfPageOverlayLayer, useOverlayActivity } from "./overlays.ts";
import { VIEWER_CSS } from "./styles.ts";

export type { Zoom } from "../view/viewer.ts";

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

/**
 * One viewport onto the document of the nearest `<PdfDocument>`: the
 * scroll container, with only the pages in the viewer's window mounted.
 * Scrolling renders this component again only when that window changes.
 * It is focusable, so the browser's own keys scroll it.
 */
export function PdfViewer({
  viewer: externalViewer,
  ref,
  className,
  style,
  label,
  pageLabel,
  onPageClick,
  children,
  ...controlProps
}: PdfViewerProps) {
  const viewer = useOptionalViewer(externalViewer);
  const session = useOptionalSession();
  useImperativeHandle(ref, () => viewer, [viewer]);
  const tree = (
    <>
      <ViewerViewport
        viewer={viewer}
        className={className}
        style={style}
        label={label}
        pageLabel={pageLabel}
        onPageClick={onPageClick}
      >
        {children}
      </ViewerViewport>
      <ViewerControlSync {...controlProps} viewer={viewer} session={session} />
    </>
  );
  return externalViewer ? <ViewerContext value={viewer}>{tree}</ViewerContext> : tree;
}

interface ViewerViewportProps {
  viewer: ViewerController;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  label?: string | undefined;
  pageLabel?: ((pageNumber: number, pageCount: number) => string) | undefined;
  onPageClick?: ((point: PdfPagePoint, event: ReactMouseEvent<HTMLDivElement>) => void) | undefined;
  children?: ReactNode;
}

function ViewerViewport({
  viewer,
  className,
  style,
  label = "PDF document",
  pageLabel = defaultPageLabel,
  onPageClick,
  children,
}: ViewerViewportProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    return viewer.attachViewport(scroller, content);
  }, [viewer]);

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
        if (!target || !viewer.content?.contains(target)) return;
        if (target.closest(INTERACTIVE_CLICK_TARGETS)) return;
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
      <div ref={contentRef} className="parapdf-pages">
        <ViewerPages viewer={viewer} pageLabel={pageLabel} />
      </div>
    </div>
  );
}

type ViewerControlProps = Omit<
  PdfViewerProps,
  "viewer" | "ref" | "className" | "style" | "label" | "pageLabel" | "onPageClick" | "children"
> & {
  viewer: ViewerController;
  session: PdfSessionController;
};

/**
 * Leaf control synchronizer rendered after `<ViewerViewport>`: attaches options,
 * controlled view props, callbacks, fragment following, and the session after
 * `attachViewport`, and reconciles rejected controlled changes without
 * re-rendering `<ViewerViewport>` or its children.
 */
const ViewerControlSync = memo(function ViewerControlSync({
  viewer,
  session,
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
}: ViewerControlProps): null {
  // A change the application did not take up renders only this leaf again,
  // returning the viewer to the controlled value without re-rendering the viewport.
  const [reconcileCount, reconcile] = useReducer((count: number) => count + 1, 0);
  const bindingRef = useRef<{ viewer: ViewerController; binding: ViewerControlBinding } | null>(
    null,
  );

  // Registered after attachViewport so viewport detach flushes unsettled
  // scroll positions before unsubscribing.
  useLayoutEffect(() => {
    const binding = viewer.bindControls(reconcile);
    bindingRef.current = { viewer, binding };
    return () => {
      bindingRef.current = null;
      binding.disconnect();
    };
  }, [viewer]);

  // Callbacks update in place without re-configuring the viewer or re-evaluating opening rules.
  useLayoutEffect(() => {
    const entry = bindingRef.current;
    if (entry?.viewer !== viewer) return;
    entry.binding.setCallbacks({
      zoom: onZoomChange,
      rotation: onRotationChange,
      spread: onSpreadChange,
      scrollMode: onScrollModeChange,
      tool: onToolChange,
      page: onPageChange,
      viewState: onViewStateChange,
    });
  }, [
    viewer,
    onZoomChange,
    onRotationChange,
    onSpreadChange,
    onScrollModeChange,
    onToolChange,
    onPageChange,
    onViewStateChange,
  ]);

  const initialScale = zoom ?? defaultZoom;
  const initialRotation = rotation ?? defaultRotation;
  const initialSpread = spread ?? defaultSpread;
  const initialScrollMode = scrollMode ?? defaultScrollMode;
  const initialTool = tool ?? defaultTool;
  const opening = useMemo(
    () =>
      initialViewOpening({
        initialView,
        initialViewState,
        initialScale,
        initialSpread,
        initialScrollMode,
        initialPage: defaultPage,
        controlled: {
          zoom,
          rotation,
          spread,
          scrollMode,
        },
        fragment: () => openingFragment(viewer, session),
      }),
    [
      viewer,
      session,
      initialView,
      initialViewState,
      initialScale,
      initialSpread,
      initialScrollMode,
      defaultPage,
      zoom,
      rotation,
      spread,
      scrollMode,
    ],
  );

  // Options are live: the viewer compares them with those it has.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcileCount intentionally re-runs sync when a controlled prop change was rejected by the application.
  useLayoutEffect(() => {
    const options: ViewerOptions = {
      initialScale,
      initialRotation,
      initialSpread,
      initialScrollMode,
      initialTool,
      initialPage: defaultPage,
      opening,
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
    const controlled: Partial<ControlledViewValues> = {
      zoom,
      rotation,
      spread,
      scrollMode,
      tool,
    };
    const entry = bindingRef.current;
    if (entry?.viewer === viewer) entry.binding.sync(options, controlled);
  }, [
    viewer,
    reconcileCount,
    zoom,
    initialScale,
    rotation,
    initialRotation,
    spread,
    initialSpread,
    scrollMode,
    initialScrollMode,
    tool,
    initialTool,
    defaultPage,
    opening,
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
  ]);

  // Follow the session's URL fragment and open the session, laying out synchronously when warm.
  useLayoutEffect(() => {
    const stopFragments = followFragments(viewer, session);
    viewer.open(session);
    return stopFragments;
  }, [viewer, session]);

  return null;
});

/**
 * Subscribes to `viewer.store` page-window keys in `useLayoutEffect` so warm
 * sessions opened in `<ViewerControlSync>`'s layout effect flush `<ViewerPages>`
 * synchronously before the browser paints, without waking on `currentPage`,
 * `tool`, or `externalLinks` updates.
 */
const PAGE_WINDOW_KEYS: readonly ViewerStoreKey[] = ["layout", "first", "last"];
const EMPTY_WINDOW: { layout: Layout | null; first: number; last: number } = {
  layout: null,
  first: 0,
  last: -1,
};
const getEmptyWindow = () => EMPTY_WINDOW;
const samePageWindow = (
  a: { layout: Layout | null; first: number; last: number },
  b: { layout: Layout | null; first: number; last: number },
): boolean => a.layout === b.layout && a.first === b.first && a.last === b.last;

function usePageWindow(viewer: ViewerController) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => viewer.store.subscribeKeys(PAGE_WINDOW_KEYS, onStoreChange),
    [viewer],
  );
  return useLayoutSnapshot(subscribe, viewer.store.get, getEmptyWindow, samePageWindow);
}

const ViewerPages = memo(function ViewerPages({
  viewer,
  pageLabel,
}: {
  viewer: ViewerController;
  pageLabel: (pageNumber: number, pageCount: number) => string;
}) {
  const { layout, first, last } = usePageWindow(viewer);
  const overlayActivity = useOverlayActivity(viewer);
  if (!layout) return null;
  const { shown } = layout;
  const pageCount = layout.sizes.length;
  const centered = layout.scrollMode === "horizontal" || shown !== null;
  const pages: ReactNode[] = [];
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
        size={layout.sizes[index]}
        scale={layout.scale}
        rotation={layout.rotation}
        overlayRenderers={overlayActivity.renderers}
        hasPortalOverlay={overlayActivity.portalPages.has(index)}
      />,
    );
  }
  return pages;
});

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
  size: PageSize | undefined;
  /** CSS pixels per PDF point; the DOM layers apply the page's user-space unit to it. */
  scale: number;
  rotation: Rotation;
  overlayRenderers: readonly OverlayRenderer[];
  hasPortalOverlay: boolean;
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
  size,
  scale,
  rotation,
  overlayRenderers,
  hasPortalOverlay,
}: PdfPageProps) {
  // The renderer prepends the page's canvases and layers at the start of the
  // section, leaving React's .parapdf-overlay-layer child at the end.
  const attachHost = useCallback(
    (host: HTMLElement | null) => {
      if (!host) return;
      return viewer.attachPage(index, host);
    },
    [viewer, index],
  );

  return (
    /* A labelled section is a region landmark, the role pdf.js gives its pages. */
    <section
      ref={attachHost}
      data-page={index + 1}
      aria-label={label}
      // Focusable, out of the tab order: the viewer moves the focus to the
      // page shown, and a screen reader reads on from it.
      tabIndex={-1}
      style={
        {
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
          "--scale-factor": scale,
        } as CSSProperties
      }
    >
      {overlayRenderers.length > 0 || hasPortalOverlay ? (
        <PdfPageOverlayLayer
          viewer={viewer}
          index={index}
          size={size}
          rotation={rotation}
          width={width}
          height={height}
          renderers={overlayRenderers}
          hasPortal={hasPortalOverlay}
        />
      ) : null}
    </section>
  );
});
