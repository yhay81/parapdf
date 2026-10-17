import { type CSSProperties, memo, type ReactNode, useLayoutEffect, useRef } from "react";
import { usePdfState, usePdfViewer } from "./context.ts";

export interface PdfViewportProps {
  className?: string;
  style?: CSSProperties;
  /** Content drawn over a page, positioned with `<PdfPageRect>`. */
  renderOverlay?: (pageIndex: number) => ReactNode;
}

/**
 * The scroll container. Only the pages in the runtime's window are mounted,
 * and scrolling re-renders this component only when that window changes.
 */
export function PdfViewport({ className, style, renderOverlay }: PdfViewportProps) {
  const runtime = usePdfViewer();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const layout = usePdfState((state) => state.layout);
  const first = usePdfState((state) => state.first);
  const last = usePdfState((state) => state.last);

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
          top={layout.tops[index] ?? 0}
          width={layout.widths[index] ?? 0}
          height={layout.heights[index] ?? 0}
          overlay={renderOverlay?.(index)}
        />,
      );
    }
  }

  return (
    <div
      ref={scrollerRef}
      className={className}
      style={{ overflow: "auto", contain: "strict", ...style }}
    >
      {/* The runtime sizes this element imperatively so zoom can restore the scroll position first. */}
      <div ref={contentRef} style={{ position: "relative" }}>
        {pages}
      </div>
    </div>
  );
}

interface PdfPageProps {
  index: number;
  top: number;
  width: number;
  height: number;
  overlay: ReactNode;
}

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const PdfPage = memo(function PdfPage({ index, top, width, height, overlay }: PdfPageProps) {
  const runtime = usePdfViewer();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const base = baseRef.current;
    const detail = detailRef.current;
    if (!base || !detail) return;
    return runtime.attachPage(index, base, detail);
  }, [runtime, index]);

  return (
    <div
      data-page={index + 1}
      style={{
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
      }}
    >
      <canvas ref={baseRef} style={layerStyle} />
      <canvas ref={detailRef} style={layerStyle} />
      {overlay ? <div style={{ ...layerStyle, pointerEvents: "none" }}>{overlay}</div> : null}
    </div>
  );
});
