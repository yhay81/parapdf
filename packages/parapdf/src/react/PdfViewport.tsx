"use client";

import { type CSSProperties, memo, type ReactNode, useLayoutEffect, useRef } from "react";
import type { Rotation } from "../engine/types.ts";
import { usePdfState, usePdfViewer } from "./context.ts";
import { VIEWER_CSS } from "./styles.ts";

export interface PdfViewportProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the scroll container (default "PDF document"). */
  label?: string;
  /**
   * Accessible name of each page, in the application's language (default
   * "Page 3 of 12"). Called while rendering, for every mounted page.
   */
  pageLabel?: (pageNumber: number, pageCount: number) => string;
  /** Content drawn over a page, positioned with `<PdfPageRect>`. */
  renderOverlay?: (pageIndex: number) => ReactNode;
}

const defaultPageLabel = (pageNumber: number, pageCount: number) =>
  `Page ${pageNumber} of ${pageCount}`;

/**
 * The scroll container. Only the pages in the runtime's window are mounted,
 * and scrolling re-renders this component only when that window changes.
 * It is focusable, so the browser's own keys scroll it.
 */
export function PdfViewport({
  className,
  style,
  label = "PDF document",
  pageLabel = defaultPageLabel,
  renderOverlay,
}: PdfViewportProps) {
  const runtime = usePdfViewer();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const layout = usePdfState((state) => state.layout);
  const first = usePdfState((state) => state.first);
  const last = usePdfState((state) => state.last);
  const pageCount = usePdfState((state) => state.pageCount);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    return runtime.attachViewport(scroller, content);
  }, [runtime]);

  const pages: ReactNode[] = [];
  if (layout) {
    const { shown } = layout;
    const centered = layout.scrollMode === "horizontal" || shown !== null;
    for (let index = first; index <= last; index++) {
      pages.push(
        <PdfPage
          key={index}
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
          textLayer={runtime.textLayer}
          annotationLayer={runtime.annotationLayer}
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
      // runtime instead of zooming the whole page.
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
      {/* The runtime sizes this element imperatively so zoom can restore the scroll position first. */}
      <div ref={contentRef} className="parapdf-pages" style={{ position: "relative" }}>
        {pages}
      </div>
    </div>
  );
}

interface PdfPageProps {
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
  textLayer: boolean;
  annotationLayer: boolean;
  overlay: ReactNode;
}

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const PdfPage = memo(function PdfPage({
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
  textLayer,
  annotationLayer,
  overlay,
}: PdfPageProps) {
  const runtime = usePdfViewer();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const spareRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const structureRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const base = baseRef.current;
    const detail = detailRef.current;
    if (!base || !detail) return;
    return runtime.attachPage(
      index,
      base,
      detail,
      textRef.current,
      annotationRef.current,
      structureRef.current,
      spareRef.current,
    );
  }, [runtime, index]);

  return (
    // A labelled section is a region landmark, the role pdf.js gives its pages.
    <section
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
      {/* Pixels only; the text layer carries the content for assistive technology. */}
      <div aria-hidden="true" style={layerStyle}>
        <canvas ref={baseRef} style={layerStyle} />
        {/* Two detail canvases: a new detail is drawn into one while the other shows the old. */}
        <canvas ref={detailRef} style={layerStyle} />
        <canvas ref={spareRef} style={layerStyle} />
      </div>
      {textLayer ? (
        // A tagged page's structure, as pdf.js's viewer keeps it: a canvas's
        // fallback content is read by assistive technology but never drawn.
        <canvas ref={structureRef} className="parapdf-structure" width={0} height={0} />
      ) : null}
      {textLayer ? <div ref={textRef} className="parapdf-text-layer" /> : null}
      {annotationLayer ? <div ref={annotationRef} className="parapdf-annotation-layer" /> : null}
      {overlay ? (
        // Overlays are placed on the unturned page, like the text layer, and
        // turn with it through the viewer CSS.
        <div
          className="parapdf-overlay-layer"
          data-main-rotation={rotation}
          style={rotation % 180 === 0 ? { width, height } : { width: height, height: width }}
        >
          {overlay}
        </div>
      ) : null}
    </section>
  );
});
