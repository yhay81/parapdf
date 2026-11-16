"use client";

import type { ReactNode } from "react";
import type { DocumentSession, PageSize } from "../document/session.ts";
import { createSlotKey, type ReadableStore, Store } from "../document/store.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import { clamp, turnedSize } from "../view/layout.ts";
import type { ViewerController } from "../view/viewer.ts";
import { useStoreKeys } from "./context.ts";

/** A US Letter page's height over its width, until the page's own size is known. */
const LETTER_RATIO = 11 / 8.5;

/** Default viewport height (CSS pixels) before a thumbnail scroller is measured. */
const DEFAULT_VIEWPORT_HEIGHT = 900;

/** Extra items mounted above and below the visible thumbnail range. */
export const DEFAULT_THUMBNAIL_OVERSCAN = 6;

/** Estimated button padding + label height (CSS pixels) until a mounted `<li>` is measured. */
export const DEFAULT_THUMBNAIL_EXTRA_HEIGHT = 32;

/** Data and helpers passed to `<PdfThumbnails>`'s custom `children` renderer for each mounted page. */
export interface ThumbnailItem {
  /** Zero-based page index (`0` to `pageCount - 1`). */
  readonly pageIndex: number;
  /** One-based page number (`pageIndex + 1`). */
  readonly pageNumber: number;
  /** Total number of pages in the document. */
  readonly pageCount: number;
  /**
   * The page's label from the PDF (such as `"iv"` or `"A-3"`) once read, or
   * `String(pageNumber)` when the document defines none or while labels load.
   */
  readonly label: string;
  /** Whether this page is `viewer`'s `currentPage`. */
  readonly current: boolean;
  /** Thumbnail width in CSS pixels passed to `<PdfThumbnails>`. */
  readonly width: number;
  /** Accessible name computed for this page's button. */
  readonly ariaLabel: string;
  /** Navigates to or selects this page. */
  select(): void;
  /** The rendered thumbnail element for this page at `width`. */
  readonly thumbnail: ReactNode;
}

/** Prefix-sum vertical layout of a thumbnail list, in CSS pixels. */
export interface ThumbnailListLayout {
  /** Item start offsets (`length === pageCount + 1`); `offsets[pageCount]` is `totalHeight`. */
  readonly offsets: Float64Array;
  readonly totalHeight: number;
  readonly rowGap: number;
}

/** Mounted item range `[first, last]` and virtual top/bottom spacers in CSS pixels. */
export interface ThumbnailWindow {
  readonly first: number;
  readonly last: number;
  readonly topSpacer: number;
  readonly bottomSpacer: number;
}

/** CSS height of a thumbnail canvas `width` pixels wide at `rotation`. */
export function thumbnailCanvasHeight(
  size: PageSize | undefined,
  rotation: Rotation,
  width: number,
): number {
  const turned = size ? turnedSize(size, rotation) : null;
  return turned && turned.width > 0 ? (width * turned.height) / turned.width : width * LETTER_RATIO;
}

/**
 * Prefix-sum vertical positions of `pageCount` thumbnails. Each unmeasured item
 * takes its turned canvas height plus `extraHeight`; measured `<li>` heights
 * override specific indices when custom `children` vary in height.
 */
export function computeThumbnailOffsets(
  pageCount: number,
  sizes: readonly PageSize[] | undefined,
  rotation: Rotation,
  width: number,
  extraHeight: number = DEFAULT_THUMBNAIL_EXTRA_HEIGHT,
  rowGap = 0,
  measuredHeights?: ReadonlyMap<number, number>,
): ThumbnailListLayout {
  if (pageCount <= 0) {
    return { offsets: new Float64Array(1), totalHeight: 0, rowGap };
  }
  const gap = Math.max(0, rowGap);
  const extra = Math.max(0, extraHeight);
  const offsets = new Float64Array(pageCount + 1);
  for (let i = 0; i < pageCount; i++) {
    const measured = measuredHeights?.get(i);
    const itemHeight =
      measured !== undefined
        ? measured
        : thumbnailCanvasHeight(sizes?.[i], rotation, width) + extra;
    offsets[i + 1] = (offsets[i] ?? 0) + itemHeight + (i < pageCount - 1 ? gap : 0);
  }
  return { offsets, totalHeight: offsets[pageCount] ?? 0, rowGap: gap };
}

/** Smallest item index in `0..pageCount - 1` whose bottom edge is past `y`. */
function firstAtOrAfter(layout: ThumbnailListLayout, pageCount: number, y: number): number {
  const { offsets, rowGap } = layout;
  let low = 0;
  let high = pageCount - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const bottom = (offsets[mid + 1] ?? 0) - (mid < pageCount - 1 ? rowGap : 0);
    if (bottom <= y) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Largest item index in `from..pageCount - 1` whose top edge is before `y`. */
function lastBefore(
  layout: ThumbnailListLayout,
  pageCount: number,
  from: number,
  y: number,
): number {
  const { offsets } = layout;
  let low = from;
  let high = pageCount - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if ((offsets[mid] ?? 0) < y) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Compute the mounted `[first, last]` range and exact top/bottom spacers for a
 * thumbnail list at `scrollTop` (relative to the `<ol>`'s content top) in a
 * scroll container `viewportHeight` CSS pixels tall.
 */
export function computeThumbnailRange(
  layout: ThumbnailListLayout,
  pageCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscanItems: number = DEFAULT_THUMBNAIL_OVERSCAN,
): ThumbnailWindow {
  if (pageCount <= 0) {
    return { first: 0, last: -1, topSpacer: 0, bottomSpacer: 0 };
  }
  const height = viewportHeight > 0 ? viewportHeight : DEFAULT_VIEWPORT_HEIGHT;
  const visibleTop = clamp(scrollTop, 0, Math.max(0, layout.totalHeight - height));
  const visibleBottom = visibleTop + height;
  const firstVisible = firstAtOrAfter(layout, pageCount, visibleTop);
  const lastVisible = lastBefore(layout, pageCount, firstVisible, visibleBottom);
  const pad = Math.max(0, overscanItems);
  const first = Math.max(0, firstVisible - pad);
  const last = Math.min(pageCount - 1, lastVisible + pad);
  const topSpacer = layout.offsets[first] ?? 0;
  const lastBottom = (layout.offsets[last + 1] ?? 0) - (last < pageCount - 1 ? layout.rowGap : 0);
  const bottomSpacer = Math.max(0, layout.totalHeight - lastBottom);
  return { first, last, topSpacer, bottomSpacer };
}

/**
 * Target `scroller.scrollTop` to bring `pageIndex` completely into view
 * (`block: "nearest"`), or `null` when it is already visible. Works even when
 * `pageIndex` is outside the mounted `[first, last]` window.
 */
export function scrollOffsetForThumbnail(
  layout: ThumbnailListLayout,
  pageCount: number,
  pageIndex: number,
  listContentStart: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  if (pageCount <= 0 || viewportHeight <= 0 || pageIndex < 0 || pageIndex >= pageCount) {
    return null;
  }
  const itemTop = listContentStart + (layout.offsets[pageIndex] ?? 0);
  const itemBottom =
    listContentStart +
    (layout.offsets[pageIndex + 1] ?? 0) -
    (pageIndex < pageCount - 1 ? layout.rowGap : 0);
  if (itemTop < scrollTop) {
    return Math.max(0, itemTop);
  }
  if (itemBottom > scrollTop + viewportHeight) {
    return Math.max(0, itemBottom - viewportHeight);
  }
  return null;
}

/** Whether `element` scrolls vertically on its own. */
function isVerticalScroller(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

/**
 * The scroll container for `<PdfThumbnails>`: `nav` itself when styled with
 * `overflow: auto` / `scroll`, or else its nearest vertically scrollable
 * ancestor.
 */
export function findThumbnailScroller(nav: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = nav; node; node = node.parentElement) {
    if (isVerticalScroller(node)) return node;
  }
  return null;
}

export interface PageLabelsState {
  readonly labels: readonly string[] | null;
}

const EMPTY_PAGE_LABELS: PageLabelsState = { labels: null };
const PAGE_LABELS_KEYS: readonly PropertyKey[] = ["labels"];
const PAGE_LABELS_SLOT = createSlotKey<ReadableStore<PageLabelsState>>("parapdf.pageLabels");

/**
 * Shared non-suspending store of `pageLabels()` for `viewer`, initialized on
 * first `<PdfThumbnails>` mount. Resolves warm `knownPageLabels` synchronously
 * during `prepare()` before layout publishes, and resets to `null` on close.
 */
export function pageLabelsOf(viewer: ViewerController): ReadableStore<PageLabelsState> {
  return viewer.slot(PAGE_LABELS_SLOT, () => {
    const store = new Store<PageLabelsState>(EMPTY_PAGE_LABELS);
    let activeDoc: DocumentSession | null = null;
    const syncDoc = (doc: DocumentSession) => {
      activeDoc = doc;
      if (doc.knownPageLabels !== undefined) {
        store.set({ labels: doc.knownPageLabels });
        return;
      }
      store.set(EMPTY_PAGE_LABELS);
      void doc.pageLabels().then(
        (resolved) => {
          if (activeDoc === doc) store.set({ labels: resolved });
        },
        () => {
          if (activeDoc === doc) store.set(EMPTY_PAGE_LABELS);
        },
      );
    };
    viewer.extend({
      prepare(doc) {
        if (activeDoc === doc) return;
        syncDoc(doc);
      },
      closed() {
        activeDoc = null;
        store.set(EMPTY_PAGE_LABELS);
      },
    });
    if (!activeDoc) {
      const warm = viewer.pdfSession?.openDocument();
      if (warm) syncDoc(warm);
    }
    return store;
  });
}

const selectPageLabels = (state: PageLabelsState): readonly string[] | null => state.labels;

/** Non-suspending hook returning the PDF's `pageLabels` once resolved, or `null`. */
export function useOptionalPageLabels(viewer: ViewerController): readonly string[] | null {
  return useStoreKeys(pageLabelsOf(viewer), PAGE_LABELS_KEYS, selectPageLabels);
}
