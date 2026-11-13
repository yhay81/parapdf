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
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useSelected } from "./context.ts";
import { PdfThumbnail } from "./PdfThumbnail.tsx";
import {
  computeThumbnailOffsets,
  computeThumbnailRange,
  DEFAULT_THUMBNAIL_EXTRA_HEIGHT,
  findThumbnailScroller,
  scrollOffsetForThumbnail,
  type ThumbnailItem,
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
  const pageCount = useSelected(viewer.store.cold, (state) => state.pageCount);
  const rotation = useSelected(viewer.store.cold, (state) => state.rotation);
  const sizes = useSelected(viewer.store.hot, (state) => state.layout?.sizes);
  const currentPage = useSelected(viewer.store.hot, (state) => state.currentPage);
  const pageLabels = useOptionalPageLabels(viewer);

  const navRef = useRef<HTMLElement>(null);
  const olRef = useRef<HTMLOListElement>(null);
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

  const latestRef = useRef({ listLayout, pageCount });
  latestRef.current = { listLayout, pageCount };

  const syncWindowFromScroll = useCallback(() => {
    const nav = navRef.current;
    const ol = olRef.current;
    const { listLayout: currentLayout, pageCount: count } = latestRef.current;
    if (!nav || !ol || count <= 0) return;
    const scroller = findThumbnailScroller(nav);
    const paddingTop = Number.parseFloat(getComputedStyle(ol).paddingTop) || 0;
    let relativeScrollTop = 0;
    let viewportHeight = 0;
    if (scroller) {
      const listContentStart =
        ol.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        paddingTop;
      relativeScrollTop = scroller.scrollTop - listContentStart;
      viewportHeight = scroller.clientHeight;
    } else {
      relativeScrollTop = -(ol.getBoundingClientRect().top + paddingTop);
      viewportHeight = window.innerHeight;
    }
    const next = computeThumbnailRange(currentLayout, count, relativeScrollTop, viewportHeight);
    setBounds((prev) =>
      prev && prev.first === next.first && prev.last === next.last
        ? prev
        : { first: next.first, last: next.last },
    );
  }, []);

  // Subscribe to scroll and resize on the list's scroll container without per-frame commits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate range whenever listLayout or pageCount changes.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || pageCount <= 0) return;
    const scroller = findThumbnailScroller(nav);
    syncWindowFromScroll();
    if (scroller) {
      scroller.addEventListener("scroll", syncWindowFromScroll, { passive: true });
      const observer = new ResizeObserver(syncWindowFromScroll);
      observer.observe(scroller);
      return () => {
        scroller.removeEventListener("scroll", syncWindowFromScroll);
        observer.disconnect();
      };
    }
    window.addEventListener("scroll", syncWindowFromScroll, { passive: true });
    window.addEventListener("resize", syncWindowFromScroll);
    return () => {
      window.removeEventListener("scroll", syncWindowFromScroll);
      window.removeEventListener("resize", syncWindowFromScroll);
    };
  }, [pageCount, listLayout, syncWindowFromScroll]);

  // Measure rendered `<li>` chrome and rowGap synchronously before paint so totalHeight is exact.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when mounted range or item geometry changes.
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol || pageCount <= 0 || activeLast < activeFirst) return;
    const nextRowGap = Number.parseFloat(getComputedStyle(ol).rowGap) || 0;
    let nextExtra = chrome.extraHeight;
    let measuredChanged = false;
    const items = ol.children;
    for (let i = 0; i < items.length; i++) {
      const element = items[i] as HTMLElement | undefined;
      if (!element) continue;
      const attr = element.getAttribute("data-page-index");
      if (attr === null) continue;
      const pageIndex = Number(attr);
      const height = element.getBoundingClientRect().height;
      if (height <= 0) continue;
      if (i === 0) {
        const canvasHeight = thumbnailCanvasHeight(sizes?.[pageIndex], rotation, width);
        nextExtra = Math.max(0, height - canvasHeight);
      }
      if (renderItem) {
        const previous = measuredHeightsRef.current.get(pageIndex);
        if (previous === undefined || Math.abs(previous - height) > 0.5) {
          measuredHeightsRef.current.set(pageIndex, height);
          measuredChanged = true;
        }
      }
    }
    if (
      Math.abs(nextExtra - chrome.extraHeight) > 0.5 ||
      Math.abs(nextRowGap - chrome.rowGap) > 0.5 ||
      measuredChanged
    ) {
      setChrome((prev) => ({
        extraHeight: nextExtra,
        rowGap: nextRowGap,
        measuredVersion: measuredChanged ? prev.measuredVersion + 1 : prev.measuredVersion,
      }));
    }
  }, [activeFirst, activeLast, pageCount, sizes, rotation, width, renderItem]);

  // Keep the active page's thumbnail scrolled into view (`block: "nearest"`), even if unmounted.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ol = olRef.current;
    if (!nav || !ol || pageCount <= 0) return;
    const scroller = findThumbnailScroller(nav);
    if (!scroller) return;
    const paddingTop = Number.parseFloat(getComputedStyle(ol).paddingTop) || 0;
    const listContentStart =
      ol.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      paddingTop;
    const target = scrollOffsetForThumbnail(
      latestRef.current.listLayout,
      pageCount,
      currentPage,
      listContentStart,
      scroller.scrollTop,
      scroller.clientHeight,
    );
    if (target !== null) {
      scroller.scrollTop = target;
      syncWindowFromScroll();
    }
  }, [currentPage, pageCount, syncWindowFromScroll]);

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
  viewer: Viewer;
  pageIndex: number;
  pageCount: number;
  width: number;
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
  displayLabel,
  ariaLabel,
  current,
  select,
  renderItem,
}: ItemProps) {
  const thumbnail = <PdfThumbnail viewer={viewer} pageIndex={pageIndex} width={width} />;
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
          select: () => select(pageIndex),
          thumbnail,
        })
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          aria-current={current ? "page" : undefined}
          onClick={() => select(pageIndex)}
        >
          {thumbnail}
          <span aria-hidden="true">{displayLabel}</span>
        </button>
      )}
    </li>
  );
});
