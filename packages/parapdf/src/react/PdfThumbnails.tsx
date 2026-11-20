"use client";

import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PageSize } from "../document/session.ts";
import { attachThumbnail } from "../features/thumbnails/index.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { ViewerState, ViewerStoreKey } from "../view/state.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { useOptionalViewer, useStoreKeys } from "./context.ts";
import {
  computeThumbnailOffsets,
  computeThumbnailRange,
  DEFAULT_THUMBNAIL_EXTRA_HEIGHT,
  findThumbnailScroller,
  scrollOffsetForThumbnail,
  type ThumbnailItem,
  type ThumbnailListLayout,
  thumbnailCanvasHeight,
  useOptionalPageLabels,
} from "./thumbnails.ts";

export interface PdfThumbnailsProps {
  /** Optional DOM id on the `<nav>` landmark (for `aria-controls`). */
  id?: string;
  /**
   * The viewer whose document the thumbnails show, and whose current page
   * they mark; without it, `<PdfThumbnails>` uses the viewer of the nearest
   * `<PdfView>` or `<PdfDocument>`.
   */
  viewer?: Viewer;
  /** Each thumbnail's width in CSS pixels (default 120). */
  width?: number;
  /** Called with the zero-based page chosen; by default the viewer goes to it. */
  onSelect?: (pageIndex: number) => void;
  /** Accessible name of the list (default "Page thumbnails"). */
  label?: string;
  /**
   * Accessible name of each page's button, in the application's language.
   * Receives the one-based `pageNumber`, `pageCount`, and the resolved `label`
   * (the PDF's page label such as `"iv"`, or `String(pageNumber)`). By default
   * `"Page iv"` when the PDF defines page labels, or `"Page 3 of 12"` when it
   * does not.
   */
  pageLabel?: (pageNumber: number, pageCount: number, label: string) => string;
  /**
   * Renders each mounted list item's contents inside its `<li>`. When omitted,
   * renders a `<button>` with `item.thumbnail` and `item.label`.
   */
  children?: (item: ThumbnailItem) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface ScrollMetrics {
  scroller: HTMLElement | null;
  listContentStart: number;
  viewportHeight: number;
  paddingTop: number;
}

function measureScrollMetrics(ol: HTMLOListElement, scroller: HTMLElement | null): ScrollMetrics {
  const paddingTop = Number.parseFloat(getComputedStyle(ol).paddingTop) || 0;
  if (scroller) {
    const listContentStart =
      ol.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      scroller.clientTop +
      scroller.scrollTop +
      paddingTop;
    return {
      scroller,
      listContentStart,
      viewportHeight: scroller.clientHeight,
      paddingTop,
    };
  }
  return {
    scroller: null,
    listContentStart: 0,
    viewportHeight: typeof window === "undefined" ? 0 : window.innerHeight,
    paddingTop,
  };
}

function windowFromScrollMetrics(
  ol: HTMLOListElement,
  layout: ThumbnailListLayout,
  pageCount: number,
  metrics: ScrollMetrics,
): { first: number; last: number } {
  const relativeScrollTop = metrics.scroller
    ? metrics.scroller.scrollTop - metrics.listContentStart
    : -(ol.getBoundingClientRect().top + metrics.paddingTop);
  const viewportHeight = metrics.scroller
    ? metrics.viewportHeight
    : typeof window === "undefined"
      ? 0
      : window.innerHeight;
  const range = computeThumbnailRange(layout, pageCount, relativeScrollTop, viewportHeight);
  return { first: range.first, last: range.last };
}

const THUMBNAIL_VIEWER_KEYS: readonly ViewerStoreKey[] = [
  "pageCount",
  "rotation",
  "sizes",
  "currentPage",
];

function selectThumbnailViewerState(state: ViewerState) {
  return {
    pageCount: state.pageCount,
    rotation: state.rotation,
    sizes: state.layout?.sizes,
    currentPage: state.currentPage,
  };
}

/**
 * The pages of `viewer`'s document as a window-virtualized navigation list,
 * each item showing a thumbnail and the page's label (from the PDF's
 * `pageLabels` once read, without suspending, or its one-based number), with
 * the current page marked and scrolled into view. Only items near the visible
 * part of the scroll container mount in the DOM and hold pixels.
 */
export function PdfThumbnails({
  id,
  viewer: externalViewer,
  width = 120,
  onSelect,
  label = "Page thumbnails",
  pageLabel,
  children: renderItem,
  className,
  style,
}: PdfThumbnailsProps) {
  const viewer = useOptionalViewer(externalViewer);
  const { pageCount, rotation, sizes, currentPage } = useStoreKeys(
    viewer.store,
    THUMBNAIL_VIEWER_KEYS,
    selectThumbnailViewerState,
  );
  const pageLabels = useOptionalPageLabels(viewer);

  const navRef = useRef<HTMLElement>(null);
  const olRef = useRef<HTMLOListElement>(null);
  const scrollMetricsRef = useRef<ScrollMetrics | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const [chrome, setChrome] = useState({
    extraHeight: DEFAULT_THUMBNAIL_EXTRA_HEIGHT,
    rowGap: 0,
    measuredVersion: 0,
  });

  // Reset custom item height measurements when document, width, or rotation changes.
  const layoutIdentityRef = useRef({ sizes, width, rotation, hasCustom: Boolean(renderItem) });
  if (
    layoutIdentityRef.current.sizes !== sizes ||
    layoutIdentityRef.current.width !== width ||
    layoutIdentityRef.current.rotation !== rotation ||
    layoutIdentityRef.current.hasCustom !== Boolean(renderItem)
  ) {
    layoutIdentityRef.current = { sizes, width, rotation, hasCustom: Boolean(renderItem) };
    measuredHeightsRef.current = new Map();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: measuredVersion bumps when measuredHeightsRef mutates.
  const listLayout = useMemo(
    () =>
      computeThumbnailOffsets(
        pageCount,
        sizes,
        rotation,
        width,
        chrome.extraHeight,
        chrome.rowGap,
        renderItem ? measuredHeightsRef.current : undefined,
      ),
    [
      pageCount,
      sizes,
      rotation,
      width,
      chrome.extraHeight,
      chrome.rowGap,
      chrome.measuredVersion,
      renderItem,
    ],
  );

  const initialWindow = useMemo(
    () => computeThumbnailRange(listLayout, pageCount, 0, 0),
    [listLayout, pageCount],
  );
  const [bounds, setBounds] = useState<{ first: number; last: number } | null>(null);
  const boundsRef = useRef<{ first: number; last: number } | null>(bounds);
  boundsRef.current = bounds;

  const activeFirst =
    pageCount <= 0
      ? 0
      : bounds && bounds.last >= bounds.first && bounds.first < pageCount
        ? bounds.first
        : initialWindow.first;
  const activeLast =
    pageCount <= 0
      ? -1
      : bounds && bounds.last >= bounds.first && bounds.first < pageCount
        ? Math.min(pageCount - 1, bounds.last)
        : initialWindow.last;

  const topSpacer = pageCount > 0 ? (listLayout.offsets[activeFirst] ?? 0) : 0;
  const lastBottom =
    pageCount > 0 && activeLast >= 0
      ? (listLayout.offsets[activeLast + 1] ?? 0) -
        (activeLast < pageCount - 1 ? listLayout.rowGap : 0)
      : 0;
  const bottomSpacer = pageCount > 0 ? Math.max(0, listLayout.totalHeight - lastBottom) : 0;

  const latestRef = useRef({
    listLayout,
    pageCount,
    initialFirst: initialWindow.first,
    initialLast: initialWindow.last,
  });
  latestRef.current = {
    listLayout,
    pageCount,
    initialFirst: initialWindow.first,
    initialLast: initialWindow.last,
  };

  const applyBounds = useCallback((next: { first: number; last: number }) => {
    const prev = boundsRef.current;
    const curFirst = prev ? prev.first : latestRef.current.initialFirst;
    const curLast = prev ? prev.last : latestRef.current.initialLast;
    if (curFirst === next.first && curLast === next.last) return;
    boundsRef.current = next;
    setBounds(next);
  }, []);

  const syncWindowFromScroll = useCallback(() => {
    const ol = olRef.current;
    const metrics = scrollMetricsRef.current;
    const { listLayout: currentLayout, pageCount: count } = latestRef.current;
    if (!ol || !metrics || count <= 0) return;
    applyBounds(windowFromScrollMetrics(ol, currentLayout, count, metrics));
  }, [applyBounds]);

  // Resolve the scroll container once and cache its geometry across scroll events.
  const hasPages = pageCount > 0;
  const overflowStyle = style?.overflow;
  const overflowYStyle = style?.overflowY;
  // biome-ignore lint/correctness/useExhaustiveDependencies: overflow style or className changes can alter which element scrolls vertically.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ol = olRef.current;
    if (!nav || !ol || !hasPages) {
      scrollMetricsRef.current = null;
      return;
    }
    const scroller = findThumbnailScroller(nav);
    scrollMetricsRef.current = measureScrollMetrics(ol, scroller);

    const refreshOnResize = () => {
      const prevHeight = scrollMetricsRef.current?.viewportHeight ?? 0;
      const next = measureScrollMetrics(ol, scroller);
      scrollMetricsRef.current = next;
      if (prevHeight <= 0 && next.viewportHeight > 0) {
        setChrome((prev) => ({ ...prev, measuredVersion: prev.measuredVersion + 1 }));
      }
      syncWindowFromScroll();
    };

    if (scroller) {
      scroller.addEventListener("scroll", syncWindowFromScroll, { passive: true });
      const observer = new ResizeObserver(refreshOnResize);
      observer.observe(scroller);
      if (scroller !== nav) observer.observe(nav);
      return () => {
        scroller.removeEventListener("scroll", syncWindowFromScroll);
        observer.disconnect();
      };
    }
    window.addEventListener("scroll", syncWindowFromScroll, { passive: true });
    window.addEventListener("resize", refreshOnResize);
    return () => {
      window.removeEventListener("scroll", syncWindowFromScroll);
      window.removeEventListener("resize", refreshOnResize);
    };
  }, [hasPages, className, overflowStyle, overflowYStyle, syncWindowFromScroll]);

  // Measure `<li>` chrome/rowGap when unmeasured or custom, align `currentPage` when view geometry changed, and sync the mounted window.
  const chromeMeasuredRef = useRef<{
    pageCount: number;
    sizes: readonly PageSize[] | undefined;
    rotation: Rotation;
    width: number;
    className: string | undefined;
  } | null>(null);
  const alignKeyRef = useRef<{
    currentPage: number;
    pageCount: number;
    sizes: readonly PageSize[] | undefined;
    rotation: Rotation;
    width: number;
    extraHeight: number;
    rowGap: number;
  } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const ol = olRef.current;
    if (!nav || !ol || pageCount <= 0) return;

    const prevChromeKey = chromeMeasuredRef.current;
    const needsUniformMeasure =
      !prevChromeKey ||
      prevChromeKey.pageCount !== pageCount ||
      prevChromeKey.sizes !== sizes ||
      prevChromeKey.rotation !== rotation ||
      prevChromeKey.width !== width ||
      prevChromeKey.className !== className;

    let nextExtra = chrome.extraHeight;
    let nextRowGap = chrome.rowGap;
    let measuredChanged = false;

    if (activeLast >= activeFirst && (needsUniformMeasure || renderItem !== undefined)) {
      if (needsUniformMeasure) {
        nextRowGap = Number.parseFloat(getComputedStyle(ol).rowGap) || 0;
      }
      const items = ol.children;
      let sawSizedItem = false;
      for (let i = 0; i < items.length; i++) {
        const element = items[i] as HTMLElement | undefined;
        if (!element) continue;
        const attr = element.getAttribute("data-page-index");
        if (attr === null) continue;
        const pageIndex = Number(attr);
        if (!needsUniformMeasure && measuredHeightsRef.current.has(pageIndex)) continue;
        const height = element.getBoundingClientRect().height;
        if (height <= 0) continue;
        sawSizedItem = true;
        if (i === 0 && needsUniformMeasure) {
          const canvasHeight = thumbnailCanvasHeight(sizes?.[pageIndex], rotation, width);
          nextExtra = Math.max(0, height - canvasHeight);
        }
        if (renderItem) {
          const previous = measuredHeightsRef.current.get(pageIndex);
          if (previous === undefined || Math.abs(previous - height) > 0.5) {
            measuredHeightsRef.current.set(pageIndex, height);
            measuredChanged = true;
          }
        } else {
          break;
        }
      }
      if (sawSizedItem && needsUniformMeasure) {
        chromeMeasuredRef.current = { pageCount, sizes, rotation, width, className };
      }
    }

    const chromeChanged =
      Math.abs(nextExtra - chrome.extraHeight) > 0.5 ||
      Math.abs(nextRowGap - chrome.rowGap) > 0.5 ||
      measuredChanged;

    const effectiveLayout = chromeChanged
      ? computeThumbnailOffsets(
          pageCount,
          sizes,
          rotation,
          width,
          nextExtra,
          nextRowGap,
          renderItem ? measuredHeightsRef.current : undefined,
        )
      : listLayout;

    if (chromeChanged) {
      latestRef.current.listLayout = effectiveLayout;
      setChrome((prev) => ({
        extraHeight: nextExtra,
        rowGap: nextRowGap,
        measuredVersion: measuredChanged ? prev.measuredVersion + 1 : prev.measuredVersion,
      }));
    }

    const prevAlign = alignKeyRef.current;
    const shouldAlign =
      !prevAlign ||
      prevAlign.currentPage !== currentPage ||
      prevAlign.pageCount !== pageCount ||
      prevAlign.sizes !== sizes ||
      prevAlign.rotation !== rotation ||
      prevAlign.width !== width ||
      Math.abs(prevAlign.extraHeight - nextExtra) > 0.5 ||
      Math.abs(prevAlign.rowGap - nextRowGap) > 0.5;

    if (!shouldAlign && !chromeChanged && !needsUniformMeasure && scrollMetricsRef.current) {
      return;
    }

    const scroller = scrollMetricsRef.current
      ? scrollMetricsRef.current.scroller
      : findThumbnailScroller(nav);
    const metrics = measureScrollMetrics(ol, scroller);
    scrollMetricsRef.current = metrics;

    if (shouldAlign && (!scroller || metrics.viewportHeight > 0)) {
      alignKeyRef.current = {
        currentPage,
        pageCount,
        sizes,
        rotation,
        width,
        extraHeight: nextExtra,
        rowGap: nextRowGap,
      };
      if (scroller) {
        const target = scrollOffsetForThumbnail(
          effectiveLayout,
          pageCount,
          currentPage,
          metrics.listContentStart,
          scroller.scrollTop,
          metrics.viewportHeight,
        );
        if (target !== null) scroller.scrollTop = target;
      }
    }

    applyBounds(windowFromScrollMetrics(ol, effectiveLayout, pageCount, metrics));
  }, [
    activeFirst,
    activeLast,
    currentPage,
    pageCount,
    sizes,
    rotation,
    width,
    className,
    renderItem,
    chrome.extraHeight,
    chrome.rowGap,
    listLayout,
    applyBounds,
  ]);

  // Stable while the props are, so that a new current page renders two items again, not all.
  const select = useCallback(
    (pageIndex: number) => (onSelect ? onSelect(pageIndex) : viewer.goToPage(pageIndex)),
    [onSelect, viewer],
  );

  const hasCustomLabels = pageLabels !== null;
  const listStyle =
    topSpacer > 0 || bottomSpacer > 0
      ? {
          ...(topSpacer > 0 ? { borderTop: `${topSpacer}px solid transparent` } : {}),
          ...(bottomSpacer > 0 ? { borderBottom: `${bottomSpacer}px solid transparent` } : {}),
        }
      : undefined;

  const mountedCount =
    pageCount > 0 && activeLast >= activeFirst ? activeLast - activeFirst + 1 : 0;

  return (
    <nav
      ref={navRef}
      id={id}
      className={className ? `parapdf-thumbnails ${className}` : "parapdf-thumbnails"}
      style={style}
      aria-label={label}
    >
      <ol ref={olRef} style={listStyle}>
        {Array.from({ length: mountedCount }, (_, offset) => {
          const pageIndex = activeFirst + offset;
          const pageNumber = pageIndex + 1;
          const displayLabel = pageLabels?.[pageIndex] ?? String(pageNumber);
          const size = sizes?.[pageIndex];
          const buttonAriaLabel = pageLabel
            ? pageLabel(pageNumber, pageCount, displayLabel)
            : hasCustomLabels
              ? `Page ${displayLabel}`
              : `Page ${pageNumber} of ${pageCount}`;
          return (
            <Item
              key={pageIndex}
              viewer={viewer}
              pageIndex={pageIndex}
              pageCount={pageCount}
              width={width}
              canvasHeight={thumbnailCanvasHeight(size, rotation, width)}
              sizeWidth={size?.width}
              sizeHeight={size?.height}
              rotation={rotation}
              displayLabel={displayLabel}
              ariaLabel={buttonAriaLabel}
              current={pageIndex === currentPage}
              select={select}
              renderItem={renderItem}
            />
          );
        })}
      </ol>
    </nav>
  );
}

interface ItemProps {
  viewer: ViewerController;
  pageIndex: number;
  pageCount: number;
  width: number;
  canvasHeight: number;
  sizeWidth: number | undefined;
  sizeHeight: number | undefined;
  rotation: Rotation;
  displayLabel: string;
  ariaLabel: string;
  current: boolean;
  select: (pageIndex: number) => void;
  renderItem: ((item: ThumbnailItem) => ReactNode) | undefined;
}

const Item = memo(function Item({
  viewer,
  pageIndex,
  pageCount,
  width,
  canvasHeight,
  sizeWidth,
  sizeHeight,
  rotation,
  displayLabel,
  ariaLabel,
  current,
  select,
  renderItem,
}: ItemProps) {
  const handleSelect = useCallback(() => select(pageIndex), [select, pageIndex]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: primitive dimensions and rotation trigger a redraw only when numerically changed.
  const attachHost = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) return;
      return attachThumbnail(viewer, pageIndex, host, width);
    },
    [viewer, pageIndex, width, sizeWidth, sizeHeight, rotation],
  );
  const thumbnail = (
    <div ref={attachHost} aria-hidden="true" style={{ width, height: canvasHeight }} />
  );
  return (
    <li data-page-index={pageIndex} aria-setsize={pageCount} aria-posinset={pageIndex + 1}>
      {renderItem ? (
        renderItem({
          pageIndex,
          pageNumber: pageIndex + 1,
          pageCount,
          label: displayLabel,
          current,
          width,
          ariaLabel,
          select: handleSelect,
          thumbnail,
        })
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          aria-current={current ? "page" : undefined}
          onClick={handleSelect}
        >
          {thumbnail}
          <span aria-hidden="true">{displayLabel}</span>
        </button>
      )}
    </li>
  );
});
