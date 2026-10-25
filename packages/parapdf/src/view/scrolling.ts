"use client";

import type { ScrollerSize, ScrollMode, Viewport } from "./layout.ts";

/** Scrolling faster than this (CSS px/ms) defers full-resolution renders. */
export const SETTLE_VELOCITY = 2;
/** Scrolling is considered stopped after this many milliseconds without events. */
export const SETTLE_DELAY = 120;

/**
 * How fast the shown content moves along the direction pages follow each
 * other: full-resolution work waits while it moves fast.
 */
export interface Motion {
  /** The shown content's top, or left in "horizontal" mode, at its last move, in CSS pixels. */
  position: number;
  /** `performance.now()` at that move. */
  at: number;
  /** CSS pixels per millisecond, smoothed over moves that follow each other quickly. */
  velocity: number;
}

/** The shown content moved to `position` at `now`. */
export function move(motion: Motion, position: number, now: number): void {
  const elapsed = now - motion.at;
  if (elapsed > 0) {
    const instant = (position - motion.position) / elapsed;
    motion.velocity = elapsed > SETTLE_DELAY ? instant : motion.velocity * 0.6 + instant * 0.4;
  }
  motion.position = position;
  motion.at = now;
}

/** Where `viewport` is along the direction pages follow each other in `scrollMode`. */
export const positionOf = (
  scrollMode: ScrollMode,
  viewport: { left: number; top: number },
): number => (scrollMode === "horizontal" ? viewport.left : viewport.top);

export const viewportOf = (scroller: HTMLElement): Viewport => ({
  left: scroller.scrollLeft,
  top: scroller.scrollTop,
  width: scroller.clientWidth,
  height: scroller.clientHeight,
  scrollerWidth: scroller.clientWidth,
  scrollerHeight: scroller.clientHeight,
});

export const sizeOf = (scroller: HTMLElement): ScrollerSize => ({
  width: scroller.clientWidth,
  height: scroller.clientHeight,
});

/** Which edges of its scroll range the scroller is at. */
export interface Edges {
  atTop: boolean;
  atBottom: boolean;
  atLeft: boolean;
  atRight: boolean;
}

/**
 * Which edges of its scroll range `scroller` is at. Within a pixel:
 * zooming leaves fractional scroll positions. The far edges are where the
 * browser stops scrolling, which a stable scrollbar gutter puts short of
 * the scroll size less the client size: by 15 px in Chromium on Linux,
 * where → never flipped a row wider than the viewport.
 */
export function scrollEdges(scroller: HTMLElement): Edges {
  const { scrollLeft, scrollTop } = scroller;
  scroller.scrollTo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const maxLeft = scroller.scrollLeft;
  const maxTop = scroller.scrollTop;
  scroller.scrollTo(scrollLeft, scrollTop);
  return {
    atTop: scrollTop <= 1,
    atBottom: scrollTop >= maxTop - 1,
    atLeft: scrollLeft <= 1,
    atRight: scrollLeft >= maxLeft - 1,
  };
}
