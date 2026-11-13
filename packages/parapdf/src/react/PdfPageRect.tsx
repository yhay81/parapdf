"use client";

import { type CSSProperties, type ReactNode, type Ref, use } from "react";
import { PageContext, useSelected } from "./context.ts";

export interface PdfPageRectProps {
  /** Rectangle in PDF points from the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Receives the positioned DOM element, for anchoring popovers or tooltips. */
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Positions children over the page of the `<PdfPageOverlay>` or
 * `<PdfPageOverlays>` it is rendered in, in PDF points. Coordinates become
 * percentages of the page box, so zooming resizes the overlay through layout
 * alone and never needs to render it again.
 */
export function PdfPageRect({
  x,
  y,
  width,
  height,
  ref,
  className,
  style,
  children,
}: PdfPageRectProps) {
  const page = use(PageContext);
  if (!page) {
    throw new Error("PdfPageRect must be rendered inside <PdfPageOverlay> or <PdfPageOverlays>");
  }
  const { viewer, pageIndex } = page;
  const size = useSelected(viewer.store.hot, (state) => state.layout?.sizes[pageIndex]);
  if (!size || size.width === 0 || size.height === 0) return null;
  return (
    <div
      ref={ref}
      className={className}
      style={{
        position: "absolute",
        left: `${(x / size.width) * 100}%`,
        top: `${(y / size.height) * 100}%`,
        width: `${(width / size.width) * 100}%`,
        height: `${(height / size.height) * 100}%`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
