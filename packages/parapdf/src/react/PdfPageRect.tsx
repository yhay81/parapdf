"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePdfState } from "./context.ts";

export interface PdfPageRectProps {
  pageIndex: number;
  /** Rectangle in PDF points from the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Positions children over a page in PDF points. Coordinates become
 * percentages of the page box, so zooming resizes the overlay through layout
 * alone and never needs to re-render it.
 */
export function PdfPageRect({ pageIndex, x, y, width, height, style, children }: PdfPageRectProps) {
  const size = usePdfState((state) => state.layout?.sizes[pageIndex]);
  if (!size || size.width === 0 || size.height === 0) return null;
  return (
    <div
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
