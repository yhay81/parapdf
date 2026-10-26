"use client";

import { type CSSProperties, memo, useCallback } from "react";
import type { Viewer } from "../view/viewer.ts";
import { useSelected } from "./context.ts";
import { PdfThumbnail } from "./PdfThumbnail.tsx";

export interface PdfThumbnailsProps {
  /** The viewer whose document the thumbnails show, and whose current page they mark. */
  viewer: Viewer;
  /** Each thumbnail's width in CSS pixels (default 120). */
  width?: number;
  /** Called with the zero-based page chosen; by default the viewer goes to it. */
  onSelect?: (pageIndex: number) => void;
  /** Accessible name of the list (default "Page thumbnails"). */
  label?: string;
  /**
   * Accessible name of each page's button, in the application's language
   * (default "Page 3 of 12"); its caption is the page's number.
   */
  pageLabel?: (pageNumber: number, pageCount: number) => string;
  className?: string;
  style?: CSSProperties;
}

const defaultPageLabel = (pageNumber: number, pageCount: number) =>
  `Page ${pageNumber} of ${pageCount}`;

/**
 * The pages of `viewer`'s document as a navigation list of buttons, each
 * with a thumbnail and the page's number, the current page marked: another
 * view of the same document, beside its pages. Thumbnails draw only near
 * the visible part of the list's scroll container.
 */
export function PdfThumbnails({
  viewer,
  width = 120,
  onSelect,
  label = "Page thumbnails",
  pageLabel = defaultPageLabel,
  className,
  style,
}: PdfThumbnailsProps) {
  const pageCount = useSelected(viewer.store.hot, (state) => state.layout?.sizes.length ?? 0);
  const currentPage = useSelected(viewer.store.hot, (state) => state.currentPage);
  // Stable while the props are, so that a new current page renders two items again, not all.
  const select = useCallback(
    (pageIndex: number) => (onSelect ? onSelect(pageIndex) : viewer.goToPage(pageIndex)),
    [onSelect, viewer],
  );
  return (
    <nav
      className={className ? `parapdf-thumbnails ${className}` : "parapdf-thumbnails"}
      style={style}
      aria-label={label}
    >
      <ol>
        {Array.from({ length: pageCount }, (_, pageIndex) => (
          <Item
            // biome-ignore lint/suspicious/noArrayIndexKey: pages are identified by their index.
            key={pageIndex}
            viewer={viewer}
            pageIndex={pageIndex}
            width={width}
            label={pageLabel(pageIndex + 1, pageCount)}
            current={pageIndex === currentPage}
            select={select}
          />
        ))}
      </ol>
    </nav>
  );
}

interface ItemProps {
  viewer: Viewer;
  pageIndex: number;
  width: number;
  label: string;
  current: boolean;
  select: (pageIndex: number) => void;
}

const Item = memo(function Item({ viewer, pageIndex, width, label, current, select }: ItemProps) {
  return (
    <li>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        onClick={() => select(pageIndex)}
      >
        <PdfThumbnail viewer={viewer} pageIndex={pageIndex} width={width} />
        <span aria-hidden="true">{pageIndex + 1}</span>
      </button>
    </li>
  );
});
