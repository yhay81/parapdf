"use client";

import { CONTROLS } from "./gestures.ts";
import type { ScrollMode } from "./layout.ts";
import { scrollEdges } from "./scrolling.ts";
import type { PointerTool } from "./state.ts";

/** What Ctrl or ⌘ with + and - zooms by. */
const ZOOM_STEP = 1.25;

/** What keys and the hand tool need from the viewer. */
export interface InputHost {
  /** The scroll container, while a viewport is attached. */
  scroller(): HTMLElement | null;
  state(): { tool: PointerTool; scrollMode: ScrollMode };
  /** A feature, such as an annotation tool, takes the pointer: the hand tool leaves it alone. */
  pointerClaimed(): boolean;
  pageCount(): number;
  /** Flip to the next or previous row from the edge crossed along `axis`; whether it did. */
  flip(direction: 1 | -1, axis: "x" | "y"): boolean;
  goToPage(index: number): void;
  zoomBy(factor: number): void;
  resetScale(): void;
}

/**
 * The viewport's keys and the hand tool: Ctrl or ⌘ with +, -, and 0 zoom,
 * keys flip pages in "page" mode, and a mouse or pen drag scrolls with the
 * hand tool.
 */
export class ViewerInput {
  readonly #host: InputHost;
  /** The hand tool's drag in progress: the pointer and where it last was. */
  #grab: { pointerId: number; x: number; y: number } | null = null;

  constructor(host: InputHost) {
    this.#host = host;
  }

  /** Listen to `scroller`'s keys and drags; returns the function that stops. */
  attach(scroller: HTMLElement): () => void {
    scroller.addEventListener("pointerdown", this.#onGrabStart);
    scroller.addEventListener("pointermove", this.#onGrabMove, { passive: true });
    scroller.addEventListener("pointerup", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("pointercancel", this.#onGrabEnd, { passive: true });
    scroller.addEventListener("keydown", this.#onKeyDown);
    return () => {
      scroller.removeEventListener("pointerdown", this.#onGrabStart);
      scroller.removeEventListener("pointermove", this.#onGrabMove);
      scroller.removeEventListener("pointerup", this.#onGrabEnd);
      scroller.removeEventListener("pointercancel", this.#onGrabEnd);
      scroller.removeEventListener("keydown", this.#onKeyDown);
      this.#grab = null;
      scroller.classList.remove("parapdf-grabbing");
    };
  }

  /** End the hand tool's drag in progress, as another tool takes the pointer. */
  release(): void {
    this.#grab = null;
    this.#host.scroller()?.classList.remove("parapdf-grabbing");
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey) return;
    if (event.ctrlKey || event.metaKey) this.#zoomKey(event);
    else if (this.#host.state().scrollMode === "page") this.#pageKey(event);
  };

  /**
   * In "page" mode, keys that would scroll past an edge of the page shown
   * flip to the next or previous one and show it from the edge they crossed:
   * PageDown, Space, and ↓ at its bottom, → at its right edge, and PageUp,
   * Shift+Space, ↑, and ← back the other way. Home and End go to the first
   * and last page. Keys meant for a form field or a button stay theirs.
   */
  #pageKey(event: KeyboardEvent): void {
    const host = this.#host;
    const scroller = host.scroller();
    const target = event.target instanceof Element ? event.target : null;
    // Arrow keys move a selected annotation.
    if (!scroller || target?.closest(CONTROLS)) return;
    const { atTop, atBottom, atLeft, atRight } = scrollEdges(scroller);
    let flipped = false;
    switch (event.key) {
      case "PageDown":
      case "ArrowDown":
        flipped = atBottom && host.flip(1, "y");
        break;
      case "PageUp":
      case "ArrowUp":
        flipped = atTop && host.flip(-1, "y");
        break;
      case " ":
        flipped = event.shiftKey ? atTop && host.flip(-1, "y") : atBottom && host.flip(1, "y");
        break;
      case "ArrowRight":
        flipped = atRight && host.flip(1, "x");
        break;
      case "ArrowLeft":
        flipped = atLeft && host.flip(-1, "x");
        break;
      case "Home":
        host.goToPage(0);
        flipped = true;
        break;
      case "End":
        host.goToPage(host.pageCount() - 1);
        flipped = true;
        break;
    }
    if (flipped) event.preventDefault();
  }

  /**
   * Ctrl or ⌘ with +, -, or 0 zooms the document instead of the page while
   * focus is in the viewport, as in pdf.js's viewer.
   */
  #zoomKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "+":
      case "=":
        this.#host.zoomBy(ZOOM_STEP);
        break;
      case "-":
      case "_":
        this.#host.zoomBy(1 / ZOOM_STEP);
        break;
      case "0":
        this.#host.resetScale();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * The hand tool scrolls with a mouse or pen drag. Links, form fields, and
   * other controls keep their own behavior; touches pan natively.
   */
  #onGrabStart = (event: PointerEvent): void => {
    // An annotation tool takes the pointer over the hand tool.
    if (this.#host.state().tool !== "hand" || this.#host.pointerClaimed()) return;
    if (event.pointerType === "touch" || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest("a, button, input, select, textarea, [contenteditable]")) return;
    // Keeps the drag from selecting text or dragging images, and the press
    // from focusing the viewport, which keys then would not scroll.
    event.preventDefault();
    const scroller = this.#host.scroller();
    if (!scroller) return;
    scroller.focus({ preventScroll: true });
    this.#grab = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add("parapdf-grabbing");
  };

  #onGrabMove = (event: PointerEvent): void => {
    const grab = this.#grab;
    const scroller = this.#host.scroller();
    if (!grab || !scroller || grab.pointerId !== event.pointerId) return;
    scroller.scrollLeft -= event.clientX - grab.x;
    scroller.scrollTop -= event.clientY - grab.y;
    grab.x = event.clientX;
    grab.y = event.clientY;
  };

  #onGrabEnd = (event: PointerEvent): void => {
    if (this.#grab?.pointerId !== event.pointerId) return;
    this.release();
  };
}
