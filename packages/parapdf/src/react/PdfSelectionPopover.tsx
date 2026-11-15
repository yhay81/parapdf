"use client";

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PdfSelection } from "../features/selection.ts";
import type { ViewerStoreKey } from "../view/state.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer } from "./context.ts";
import {
  computePopoverPosition,
  type PopoverBox,
  type PopoverPlacement,
  useSettledSelection,
} from "./selection.ts";

export type { PopoverPlacement };

export interface PdfSelectionPopoverProps {
  /**
   * The viewer whose text selection anchors this popover; without it,
   * `<PdfSelectionPopover>` uses the viewer of the nearest `<PdfView>` or
   * `<PdfDocument>` (`useViewer()`).
   */
  viewer?: Viewer;
  /**
   * Preferred side of the selection (default `"top"`). Flips to the opposite
   * side automatically when there is not enough room inside the viewport.
   */
  placement?: PopoverPlacement;
  /** Distance in CSS pixels between the selection and the popover (default `8`). */
  offset?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Renders the popover content for the active selection. Returning `null`,
   * `undefined`, or `false` hides the popover.
   */
  children: (selection: PdfSelection) => ReactNode;
}

const EDITABLE_CONTROLS = "input, textarea, select, [contenteditable]";
const POPOVER_STORE_KEYS: readonly ViewerStoreKey[] = ["layout", "first", "last"];

/**
 * Renders floating selection UI (such as a highlight or copy toolbar) outside
 * page `contain: "strict"` clipping and tracks scroll, zoom previews, layout
 * changes, and rotation imperatively without per-frame React state commits.
 */
export function PdfSelectionPopover({
  viewer,
  placement = "top",
  offset = 8,
  className,
  style,
  children,
}: PdfSelectionPopoverProps) {
  const resolved = useOptionalViewer(viewer);
  const selection = useSettledSelection(resolved);
  const popoverRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef({ selection, placement, offset });
  latestRef.current = { selection, placement, offset };
  const updateRef = useRef<(() => void) | null>(null);

  const rendered = selection ? children(selection) : null;
  const active =
    selection !== null && rendered !== null && rendered !== undefined && rendered !== false;

  useLayoutEffect(() => {
    if (!active) {
      updateRef.current = null;
      return;
    }
    const el = popoverRef.current;
    if (!el) return;
    const hostDoc = el.ownerDocument;
    const win = hostDoc.defaultView;
    let dragging = false;

    const update = () => {
      const {
        selection: current,
        placement: currentPlacement,
        offset: currentOffset,
      } = latestRef.current;
      const scroller = resolved.scroller;
      if (!current || !scroller) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        return;
      }
      const anchorBox = current.anchor.getBoundingClientRect();
      const scrollerBox = scroller.getBoundingClientRect();
      const vpLeft = scrollerBox.left + scroller.clientLeft;
      const vpTop = scrollerBox.top + scroller.clientTop;
      const vpWidth = scroller.clientWidth || scrollerBox.width;
      const vpHeight = scroller.clientHeight || scrollerBox.height;
      const viewportBox: PopoverBox = {
        left: vpLeft,
        top: vpTop,
        right: vpLeft + vpWidth,
        bottom: vpTop + vpHeight,
        width: vpWidth,
        height: vpHeight,
      };
      const measured = el.getBoundingClientRect();
      const popWidth = el.offsetWidth || measured.width;
      const popHeight = el.offsetHeight || measured.height;
      const placed = computePopoverPosition({
        anchorBox,
        viewportBox,
        windowWidth: win?.innerWidth ?? viewportBox.right,
        windowHeight: win?.innerHeight ?? viewportBox.bottom,
        popoverWidth: popWidth,
        popoverHeight: popHeight,
        placement: currentPlacement,
        offset: currentOffset,
      });
      if (!placed) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        return;
      }

      el.dataset.placement = placed.side;
      el.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
      el.style.visibility = "visible";
      el.style.pointerEvents = dragging ? "none" : "auto";
    };
    updateRef.current = update;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || el.contains(event.target as Node | null)) return;
      dragging = true;
      el.style.pointerEvents = "none";
    };
    const onPointerEnd = () => {
      if (!dragging) return;
      dragging = false;
      update();
    };

    const scroller = resolved.scroller;
    scroller?.addEventListener("scroll", update, { passive: true });
    scroller?.addEventListener("pointerdown", onPointerDown, { passive: true });
    win?.addEventListener("scroll", update, { passive: true, capture: true });
    win?.addEventListener("resize", update, { passive: true });
    win?.addEventListener("pointerup", onPointerEnd, { passive: true });
    win?.addEventListener("pointercancel", onPointerEnd, { passive: true });
    win?.addEventListener("blur", onPointerEnd);
    const unsubscribeStore = resolved.store.subscribeKeys(POPOVER_STORE_KEYS, update);
    const unsubscribePreview = resolved.onPreviewChange(update);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(el);
    }

    return () => {
      updateRef.current = null;
      scroller?.removeEventListener("scroll", update);
      scroller?.removeEventListener("pointerdown", onPointerDown);
      win?.removeEventListener("scroll", update, { capture: true });
      win?.removeEventListener("resize", update);
      win?.removeEventListener("pointerup", onPointerEnd);
      win?.removeEventListener("pointercancel", onPointerEnd);
      win?.removeEventListener("blur", onPointerEnd);
      unsubscribeStore();
      unsubscribePreview();
      resizeObserver?.disconnect();
    };
  }, [active, resolved]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: repositions in place when selection, placement, or offset updates without tearing down active listeners or ResizeObserver.
  useLayoutEffect(() => {
    updateRef.current?.();
  }, [active, resolved, selection, placement, offset]);

  if (!active) return null;
  const hostDoc =
    resolved.scroller?.ownerDocument ?? (typeof document === "undefined" ? null : document);
  const body = hostDoc?.body ?? null;
  if (!body) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: mousedown preventDefault preserves the browser's text selection when clicking toolbar buttons inside the popover.
    <div
      ref={popoverRef}
      className={className ? `parapdf-selection-popover ${className}` : "parapdf-selection-popover"}
      data-placement={placement}
      onMouseDown={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest(EDITABLE_CONTROLS)) event.preventDefault();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 40,
        visibility: "hidden",
        pointerEvents: "none",
        willChange: "transform",
        ...style,
      }}
    >
      {rendered}
    </div>,
    body,
  );
}
