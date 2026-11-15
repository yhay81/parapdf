"use client";

import { type CSSProperties, useCallback } from "react";
import { attachThumbnail } from "../features/thumbnails/index.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { ViewerStoreKey } from "../view/state.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { useOptionalViewer, useStoreKeys } from "./context.ts";
import { thumbnailCanvasHeight } from "./thumbnails.ts";

const THUMBNAIL_KEYS: readonly ViewerStoreKey[] = ["sizes", "rotation"];

export interface PdfThumbnailProps {
  /**
   * The viewer whose document, rotation, and drawing slots the thumbnail
   * uses; without it, `<PdfThumbnail>` uses the viewer of the nearest
   * `<PdfView>` or `<PdfDocument>`.
   */
  viewer?: Viewer;
  /** The zero-based page to show. */
  pageIndex: number;
  /** Width in CSS pixels; the height follows the page's shape as the view turns it. */
  width: number;
  className?: string;
  style?: CSSProperties;
}

export interface ThumbnailCanvasProps {
  viewer: ViewerController;
  pageIndex: number;
  width: number;
  canvasHeight: number;
  sizeWidth: number | undefined;
  sizeHeight: number | undefined;
  rotation: Rotation;
  virtualized?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Internal zero-subscription thumbnail canvas used by `<PdfThumbnails>` (which
 * passes primitive dimensions and `virtualized`) and `<PdfThumbnail>`.
 */
export function ThumbnailCanvas({
  viewer,
  pageIndex,
  width,
  canvasHeight,
  sizeWidth,
  sizeHeight,
  rotation,
  virtualized = false,
  className,
  style,
}: ThumbnailCanvasProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: primitive dimensions and rotation trigger a redraw only when numerically changed.
  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      return attachThumbnail(
        viewer,
        pageIndex,
        canvas,
        width,
        virtualized ? { virtualized: true } : undefined,
      );
    },
    [viewer, pageIndex, width, sizeWidth, sizeHeight, rotation, virtualized],
  );

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; its button or link names the page.
    <canvas
      ref={attachCanvas}
      // Empty until drawn: a canvas's default 300 by 150 pixels would hold memory for nothing.
      width={0}
      height={0}
      className={className ? `parapdf-thumbnail ${className}` : "parapdf-thumbnail"}
      aria-hidden="true"
      style={{ display: "block", width, height: canvasHeight, background: "#fff", ...style }}
    />
  );
}

/**
 * A small picture of a page of `viewer`'s document, drawn once it comes
 * near the visible part of its scroll container and released once it
 * leaves, at a lower priority than the viewer's pages. It is a picture
 * only: wrap it in a button or link labelled with the page, as
 * `<PdfThumbnails>` does.
 */
export function PdfThumbnail({
  viewer: externalViewer,
  pageIndex,
  width,
  className,
  style,
}: PdfThumbnailProps) {
  const viewer = useOptionalViewer(externalViewer);
  const { size, rotation } = useStoreKeys(viewer.store, THUMBNAIL_KEYS, (state) => ({
    size: state.layout?.sizes[pageIndex],
    rotation: state.rotation,
  }));

  return (
    <ThumbnailCanvas
      viewer={viewer}
      pageIndex={pageIndex}
      width={width}
      canvasHeight={thumbnailCanvasHeight(size, rotation, width)}
      sizeWidth={size?.width}
      sizeHeight={size?.height}
      rotation={rotation}
      className={className}
      style={style}
    />
  );
}
