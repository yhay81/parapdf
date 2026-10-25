"use client";

import {
  type CSSProperties,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  use,
  useLayoutEffect,
  useRef,
} from "react";
import type { Rotation } from "../pdfjs/draw.ts";
import { AnnotationEditingContext, usePdfHotState, usePdfState, usePdfViewer } from "./context.ts";
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
  const layout = usePdfHotState((state) => state.layout);
  const first = usePdfHotState((state) => state.first);
  const last = usePdfHotState((state) => state.last);
  const pageCount = usePdfState((state) => state.pageCount);
  const annotationEditing = use(AnnotationEditingContext);

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
      {annotationEditing ? (
        <Suspense fallback={null}>
          <EditorStyles />
        </Suspense>
      ) : null}
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
  overlay: ReactNode;
}

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
  overlay,
}: PdfPageProps) {
  const runtime = usePdfViewer();
  const hostRef = useRef<HTMLElement>(null);

  // The renderer builds the page's canvases and layers in the section,
  // before the overlay.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return runtime.attachPage(index, host);
  }, [runtime, index]);

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
