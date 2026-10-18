import { type CSSProperties, memo, type ReactNode, useLayoutEffect, useRef } from "react";
import { usePdfState, usePdfViewer } from "./context.ts";
import { VIEWER_CSS } from "./styles.ts";

export interface PdfViewportProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the scroll container. */
  label?: string;
  /** Content drawn over a page, positioned with `<PdfPageRect>`. */
  renderOverlay?: (pageIndex: number) => ReactNode;
}

/**
 * The scroll container. Only the pages in the runtime's window are mounted,
 * and scrolling re-renders this component only when that window changes.
 * It is focusable, so the browser's own keys scroll it.
 */
export function PdfViewport({
  className,
  style,
  label = "PDF document",
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
    for (let index = first; index <= last; index++) {
      pages.push(
        <PdfPage
          key={index}
          index={index}
          pageCount={pageCount}
          top={layout.tops[index] ?? 0}
          width={layout.widths[index] ?? 0}
          height={layout.heights[index] ?? 0}
          scale={layout.scale}
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
      style={{ overflow: "auto", contain: "strict", ...style }}
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
      <div ref={contentRef} style={{ position: "relative" }}>
        {pages}
      </div>
    </div>
  );
}

interface PdfPageProps {
  index: number;
  pageCount: number;
  top: number;
  width: number;
  height: number;
  /** CSS pixels per PDF point; pdf.js's text layer reads it as `--total-scale-factor`. */
  scale: number;
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
  pageCount,
  top,
  width,
  height,
  scale,
  textLayer,
  annotationLayer,
  overlay,
}: PdfPageProps) {
  const runtime = usePdfViewer();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const base = baseRef.current;
    const detail = detailRef.current;
    if (!base || !detail) return;
    return runtime.attachPage(index, base, detail, textRef.current, annotationRef.current);
  }, [runtime, index]);

  return (
    // A labelled section is a region landmark, the role pdf.js gives its pages.
    <section
      data-page={index + 1}
      aria-label={`Page ${index + 1} of ${pageCount}`}
      style={
        {
          position: "absolute",
          top,
          left: 0,
          right: 0,
          margin: "0 auto",
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
        <canvas ref={detailRef} style={layerStyle} />
      </div>
      {textLayer ? <div ref={textRef} className="parapdf-text-layer" /> : null}
      {annotationLayer ? <div ref={annotationRef} className="parapdf-annotation-layer" /> : null}
      {overlay ? (
        <div style={{ ...layerStyle, pointerEvents: "none", zIndex: 2 }}>{overlay}</div>
      ) : null}
    </section>
  );
});
