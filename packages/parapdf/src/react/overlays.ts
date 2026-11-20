"use client";

import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Fragment, jsx } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import type { PageSize } from "../document/session.ts";
import { createSlotKey } from "../document/store.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { PageContext, useLayoutSnapshot, useOptionalViewer } from "./context.ts";

export interface OverlayRenderer {
  readonly id: string;
  readonly render: (pageIndex: number) => ReactNode;
}

export interface PortalTarget {
  readonly layer: HTMLDivElement;
  readonly size: PageSize | undefined;
}

export interface OverlayActivity {
  readonly renderers: readonly OverlayRenderer[];
  readonly portalPages: ReadonlySet<number>;
}

const EMPTY_RENDERERS: readonly OverlayRenderer[] = [];
const EMPTY_PORTAL_PAGES: ReadonlySet<number> = new Set<number>();
const INACTIVE_OVERLAYS: OverlayActivity = {
  renderers: EMPTY_RENDERERS,
  portalPages: EMPTY_PORTAL_PAGES,
};
let nextRendererId = 0;

const hasOverlayNode = (node: ReactNode): boolean =>
  node !== null && node !== undefined && node !== false;

function notifyListeners(set: ReadonlySet<() => void>): void {
  if (set.size === 0) return;
  if (set.size === 1) {
    for (const listener of set) {
      listener();
      break;
    }
    return;
  }
  for (const listener of [...set]) listener();
}

class OverlayStore {
  readonly #targets = new Map<number, PortalTarget>();
  readonly #portalCounts = new Map<number, number>();
  readonly #portalListeners = new Map<number, Set<() => void>>();
  readonly #activeListeners = new Set<() => void>();
  #renderers: readonly OverlayRenderer[] = EMPTY_RENDERERS;
  #activity: OverlayActivity = INACTIVE_OVERLAYS;

  nextRendererId(): string {
    // An overlay keeps its identity when its viewer prop changes.
    return `overlay-${++nextRendererId}`;
  }

  readonly isActive = (): boolean => this.#activity !== INACTIVE_OVERLAYS;

  readonly getActivity = (): OverlayActivity => this.#activity;

  readonly subscribeActive = (listener: () => void): (() => void) => {
    this.#activeListeners.add(listener);
    return () => {
      this.#activeListeners.delete(listener);
    };
  };

  #syncActivity(portalMembershipChanged: boolean): void {
    const renderers = this.#renderers;
    const hasPortals = this.#portalCounts.size > 0;
    if (renderers.length === 0 && !hasPortals) {
      if (this.#activity === INACTIVE_OVERLAYS) return;
      this.#activity = INACTIVE_OVERLAYS;
    } else if (
      !portalMembershipChanged &&
      this.#activity !== INACTIVE_OVERLAYS &&
      this.#activity.renderers === renderers
    ) {
      return;
    } else {
      const portalPages = portalMembershipChanged
        ? hasPortals
          ? new Set(this.#portalCounts.keys())
          : EMPTY_PORTAL_PAGES
        : this.#activity.portalPages;
      this.#activity = { renderers, portalPages };
    }
    notifyListeners(this.#activeListeners);
  }

  hasLayer(pageIndex: number): boolean {
    return this.#targets.has(pageIndex);
  }

  hasPortalClaim(pageIndex: number): boolean {
    return (this.#portalCounts.get(pageIndex) ?? 0) > 0;
  }

  readonly getRenderers = (): readonly OverlayRenderer[] => this.#renderers;

  setRenderer(id: string, render: (pageIndex: number) => ReactNode): void {
    const index = this.#renderers.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      if (Object.is(this.#renderers[index]?.render, render)) return;
      const next = [...this.#renderers];
      next[index] = { id, render };
      this.#renderers = next;
    } else {
      this.#renderers = [...this.#renderers, { id, render }];
    }
    this.#syncActivity(false);
  }

  removeRenderer(id: string): void {
    const next = this.#renderers.filter((entry) => entry.id !== id);
    if (next.length === this.#renderers.length) return;
    this.#renderers = next.length === 0 ? EMPTY_RENDERERS : next;
    this.#syncActivity(false);
  }

  subscribePortal(pageIndex: number, listener: () => void): () => void {
    let set = this.#portalListeners.get(pageIndex);
    if (!set) {
      set = new Set();
      this.#portalListeners.set(pageIndex, set);
    }
    set.add(listener);
    return () => {
      const current = this.#portalListeners.get(pageIndex);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.#portalListeners.delete(pageIndex);
    };
  }

  #notifyPortal(pageIndex: number): void {
    const set = this.#portalListeners.get(pageIndex);
    if (set) notifyListeners(set);
  }

  portalTarget(pageIndex: number): PortalTarget | null {
    if ((this.#portalCounts.get(pageIndex) ?? 0) <= 0) return null;
    return this.#targets.get(pageIndex) ?? null;
  }

  claimPortal(pageIndex: number): () => void {
    const prevCount = this.#portalCounts.get(pageIndex) ?? 0;
    this.#portalCounts.set(pageIndex, prevCount + 1);
    if (prevCount === 0) {
      this.#notifyPortal(pageIndex);
      this.#syncActivity(true);
    }
    return () => {
      const remaining = (this.#portalCounts.get(pageIndex) ?? 0) - 1;
      if (remaining > 0) {
        this.#portalCounts.set(pageIndex, remaining);
        return;
      }
      this.#portalCounts.delete(pageIndex);
      this.#notifyPortal(pageIndex);
      this.#syncActivity(true);
    };
  }

  attachLayer(pageIndex: number, layer: HTMLDivElement, size: PageSize | undefined): () => void {
    this.#targets.set(pageIndex, { layer, size });
    if ((this.#portalCounts.get(pageIndex) ?? 0) > 0) this.#notifyPortal(pageIndex);
    return () => {
      const current = this.#targets.get(pageIndex);
      if (current?.layer !== layer) return;
      this.#targets.delete(pageIndex);
      if ((this.#portalCounts.get(pageIndex) ?? 0) > 0) this.#notifyPortal(pageIndex);
    };
  }
}

const OVERLAY_SLOT = createSlotKey<OverlayStore>("parapdf.overlays");

export function overlayStoreOf(viewer: ViewerController): OverlayStore {
  return viewer.slot(OVERLAY_SLOT, () => new OverlayStore());
}

export interface PdfPageOverlayProps {
  /** Zero-based page index this overlay renders onto while that page is mounted. */
  page: number;
  /**
   * The viewer whose page shows this overlay; without it, `<PdfPageOverlay>`
   * uses the viewer of the nearest `<PdfView>` or `<PdfDocument>` (`useViewer()`).
   */
  viewer?: Viewer;
  /**
   * Overlay elements positioned with `<PdfPageRect>`. Takes plain `ReactNode`
   * children (no render callback), so Server Components can pass streamed JSX
   * directly through it.
   */
  children?: ReactNode;
}

const getNullTarget = (): PortalTarget | null => null;
const getInactiveOverlays = (): OverlayActivity => INACTIVE_OVERLAYS;

/**
 * Renders `children` through a portal into page `page`'s overlay layer above
 * its canvas and text while that page is in the viewer's mounted window, and
 * unmounts them cleanly while the page is off screen. Position children in PDF
 * points with `<PdfPageRect>`.
 */
export function PdfPageOverlay({ page, viewer, children }: PdfPageOverlayProps): ReactNode {
  const resolved = useOptionalViewer(viewer);
  const store = overlayStoreOf(resolved);
  const pageIndex = Number.isFinite(page) ? Math.trunc(page) : -1;
  const active = pageIndex >= 0 && hasOverlayNode(children);
  const subscribePortal = useCallback(
    (onStoreChange: () => void) => {
      const release = store.claimPortal(pageIndex);
      const unsubscribe = store.subscribePortal(pageIndex, onStoreChange);
      return () => {
        unsubscribe();
        release();
      };
    },
    [store, pageIndex],
  );
  const getTarget = useCallback(() => store.portalTarget(pageIndex), [store, pageIndex]);
  const target = useLayoutSnapshot(active ? subscribePortal : null, getTarget, getNullTarget);

  const pageContext = useMemo(
    () => (target ? { pageIndex, size: target.size } : null),
    [pageIndex, target],
  );

  if (!target || !pageContext || !active) return null;
  return createPortal(jsx(PageContext, { value: pageContext, children }), target.layer);
}

export interface PdfPageOverlaysProps {
  /**
   * The viewer whose mounted pages render these overlays; without it,
   * `<PdfPageOverlays>` uses the viewer of the nearest `<PdfView>` or
   * `<PdfDocument>` (`useViewer()`).
   */
  viewer?: Viewer;
  /**
   * Called inside each mounted page's memoized component with its zero-based
   * page index. Evaluating per page keeps existing pages memoized as the
   * mounted window shifts during scrolling.
   */
  children: (pageIndex: number) => ReactNode;
}

/**
 * Renders dynamic overlays across every mounted page of a viewer. Each mounted
 * page evaluates `children(pageIndex)` inside its own memoized subtree, so
 * scrolling the mounted window never re-evaluates overlays on pages that stay
 * mounted. Position overlay elements in PDF points with `<PdfPageRect>`.
 */
export function PdfPageOverlays({ viewer, children }: PdfPageOverlaysProps) {
  const resolved = useOptionalViewer(viewer);
  const store = overlayStoreOf(resolved);
  const idRef = useRef<string | null>(null);
  idRef.current ??= store.nextRendererId();
  const id = idRef.current;

  useLayoutEffect(() => {
    store.setRenderer(id, children);
  }, [store, id, children]);

  useLayoutEffect(() => () => store.removeRenderer(id), [store, id]);

  return null;
}

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
}: PdfPageRectProps): ReactNode {
  const page = use(PageContext);
  if (!page) {
    throw new Error("PdfPageRect must be rendered inside <PdfPageOverlay> or <PdfPageOverlays>");
  }
  const { size } = page;
  if (!size || size.width === 0 || size.height === 0) return null;
  return jsx("div", {
    ref,
    className,
    style: {
      position: "absolute",
      left: `${(x / size.width) * 100}%`,
      top: `${(y / size.height) * 100}%`,
      width: `${(width / size.width) * 100}%`,
      height: `${(height / size.height) * 100}%`,
      ...style,
    },
    children,
  });
}

/**
 * Subscribe in `useLayoutEffect` to which pages of `viewer` need an overlay
 * layer (`<PdfPageOverlays>` or `<PdfPageOverlay>`), so warm mounts flush
 * overlay layers synchronously before paint.
 */
export function useOverlayActivity(viewer: ViewerController): OverlayActivity {
  const store = overlayStoreOf(viewer);
  return useLayoutSnapshot(store.subscribeActive, store.getActivity, getInactiveOverlays);
}

export interface PdfPageOverlayLayerProps {
  viewer: ViewerController;
  index: number;
  size: PageSize | undefined;
  rotation: Rotation;
  width: number;
  height: number;
  renderers: readonly OverlayRenderer[];
  hasPortal: boolean;
}

/**
 * PageOverlayPortal renders this layer inside its page host. It renders dynamic
 * overlay content and publishes the same element as the target for fixed overlays.
 */
export function PdfPageOverlayLayer({
  viewer,
  index,
  size,
  rotation,
  width,
  height,
  renderers,
  hasPortal,
}: PdfPageOverlayLayerProps): ReactNode {
  const store = overlayStoreOf(viewer);

  let rendered: ReactNode = null;
  let hasRendered = false;
  if (renderers.length === 1) {
    const node = renderers[0]?.render(index);
    if (hasOverlayNode(node)) {
      rendered = node;
      hasRendered = true;
    }
  } else if (renderers.length > 1) {
    const nodes: ReactNode[] = [];
    for (const entry of renderers) {
      const node = entry.render(index);
      if (hasOverlayNode(node)) nodes.push(jsx(Fragment, { children: node }, entry.id));
    }
    if (nodes.length > 0) {
      rendered = nodes;
      hasRendered = true;
    }
  }

  const pageContext = useMemo(() => ({ pageIndex: index, size }), [index, size]);
  const attachLayer = useCallback(
    (layer: HTMLDivElement | null) => {
      if (!layer) return;
      return store.attachLayer(index, layer, size);
    },
    [store, index, size],
  );

  if (!hasRendered && !hasPortal) return null;
  const turned = rotation % 180 !== 0;
  return jsx("div", {
    ref: attachLayer,
    className: "parapdf-overlay-layer",
    "data-main-rotation": String(rotation),
    style: {
      width: turned ? height : width,
      height: turned ? width : height,
    },
    children: hasRendered ? jsx(PageContext, { value: pageContext, children: rendered }) : null,
  });
}
