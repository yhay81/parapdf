"use client";

import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { attachThumbnail } from "../features/thumbnails/index.ts";
import { turnedSize } from "../view/layout.ts";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfThumbnailProps {
  /** The zero-based page to show. */
  pageIndex: number;
  /** Width in CSS pixels; the height follows the page's shape as the view turns it. */
  width: number;
  className?: string;
  style?: CSSProperties;
}

/** A US Letter page's height over its width, until the page's own size is known. */
const LETTER_RATIO = 11 / 8.5;

/**
 * A small picture of a page, drawn once it comes near the visible part of
 * its scroll container and released once it leaves, at a lower priority
 * than the pages in the viewport. It is a picture only: wrap it in a button
 * or link labelled with the page, for example to `goToPage()`.
 */
export function PdfThumbnail({ pageIndex, width, className, style }: PdfThumbnailProps) {
  const runtime = usePdfViewer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = usePdfState((state) => state.layout?.sizes[pageIndex]);
  const rotation = usePdfState((state) => state.rotation);
  const turned = size ? turnedSize(size, rotation) : null;
  const height =
    turned && turned.width > 0 ? (width * turned.height) / turned.width : width * LETTER_RATIO;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new size or rotation draws the page again.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachThumbnail(runtime, pageIndex, canvas, width);
  }, [runtime, pageIndex, width, size, rotation]);

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; its button or link names the page.
    <canvas
      ref={canvasRef}
      // Empty until drawn: a canvas's default 300 by 150 pixels would hold memory for nothing.
      width={0}
      height={0}
      className={className ? `parapdf-thumbnail ${className}` : "parapdf-thumbnail"}
      aria-hidden="true"
      style={{ display: "block", width, height, background: "#fff", ...style }}
    />
  );
}
