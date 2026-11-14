"use client";

import {
  type CSSProperties,
  createElement,
  Fragment,
  type ReactNode,
  type Ref,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { PageSize } from "../document/session.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Viewer, ViewerController } from "../view/viewer.ts";
import { PageContext, useOptionalViewer } from "./context.ts";

interface OverlayRenderer {
  readonly id: string;
  readonly render: (pageIndex: number) => ReactNode;
}

export interface PortalTarget {
  readonly layer: HTMLDivElement;
  readonly size: PageSize | undefined;
}

export interface OverlayActivity {
  readonly allPages: boolean;
  readonly portalPages: ReadonlySet<number>;
}

const EMPTY_RENDERERS: readonly OverlayRenderer[] = [];
const EMPTY_PORTAL_PAGES: ReadonlySet<number> = new Set<number>();
const INACTIVE_OVERLAYS: OverlayActivity = {
  allPages: false,
  portalPages: EMPTY_PORTAL_PAGES,
};
const getEmptyRenderers = (): readonly OverlayRenderer[] => EMPTY_RENDERERS;
const getInactiveOverlays = (): OverlayActivity => INACTIVE_OVERLAYS;
const getNullTarget = (): PortalTarget | null => null;
const getFalse = (): boolean => false;
let nextRendererId = 0;

const hasOverlayNode = (node: ReactNode): boolean =>
  node !== null && node !== undefined && node !== false;

class OverlayStore {
  readonly #targets = new Map<number, PortalTarget>();
  readonly #portalCounts = new Map<number, number>();
  readonly #portalListeners = new Map<number, Set<() => void>>();
  readonly #rendererListeners = new Set<() => void>();
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
    const allPages = this.#renderers.length > 0;
    const hasPortals = this.#portalCounts.size > 0;
    if (!allPages && !hasPortals) {
      if (this.#activity === INACTIVE_OVERLAYS) return;
      this.#activity = INACTIVE_OVERLAYS;
    } else if (
      !portalMembershipChanged &&
      this.#activity !== INACTIVE_OVERLAYS &&
      this.#activity.allPages === allPages
    ) {
      return;
    } else {
      this.#activity = {
        allPages,
        portalPages: hasPortals ? new Set(this.#portalCounts.keys()) : EMPTY_PORTAL_PAGES,
      };
    }
    for (const listener of [...this.#activeListeners]) listener();
  }

  hasLayer(pageIndex: number): boolean {
    return this.#targets.has(pageIndex);
  }

  hasPortalClaim(pageIndex: number): boolean {
    return (this.#portalCounts.get(pageIndex) ?? 0) > 0;
  }

  readonly getRenderers = (): readonly OverlayRenderer[] => this.#renderers;

  readonly subscribeRenderers = (listener: () => void): (() => void) => {
    this.#rendererListeners.add(listener);
    return () => {
      this.#rendererListeners.delete(listener);
    };
  };

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
    this.#notifyRenderers();
    this.#syncActivity(false);
  }

  removeRenderer(id: string): void {
    const next = this.#renderers.filter((entry) => entry.id !== id);
    if (next.length === this.#renderers.length) return;
    this.#renderers = next.length === 0 ? EMPTY_RENDERERS : next;
    this.#notifyRenderers();
    this.#syncActivity(false);
  }

  #notifyRenderers(): void {
    for (const listener of [...this.#rendererListeners]) listener();
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
    if (!set) return;
    for (const listener of [...set]) listener();
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

const overlayStores = new WeakMap<ViewerController, OverlayStore>();

export function overlayStoreOf(viewer: ViewerController): OverlayStore {
  let store = overlayStores.get(viewer);
  if (!store) {
    store = new OverlayStore();
    overlayStores.set(viewer, store);
  }
  return store;
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

  useLayoutEffect(() => {
    if (!active) return;
    return store.claimPortal(pageIndex);
  }, [store, pageIndex, active]);

  const subscribe = useMemo(
    () =>
      active
        ? (listener: () => void) => store.subscribePortal(pageIndex, listener)
        : () => () => {},
    [store, pageIndex, active],
  );
  const target = useSyncExternalStore(
    subscribe,
    () => (active ? store.portalTarget(pageIndex) : null),
    getNullTarget,
  );
  const pageContext = useMemo(
    () => (target ? { pageIndex, size: target.size } : null),
    [pageIndex, target],
  );

  if (!target || !pageContext || !active) return null;
  return createPortal(createElement(PageContext, { value: pageContext }, children), target.layer);
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
  return createElement(
    "div",
    {
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
    },
    children,
  );
}

/** Subscribe to which pages of `viewer` need an overlay layer (`<PdfPageOverlays>` or `<PdfPageOverlay>`). */
export function useOverlayActivity(viewer: ViewerController): OverlayActivity {
  const store = overlayStoreOf(viewer);
  return useSyncExternalStore(store.subscribeActive, store.getActivity, getInactiveOverlays);
}

export interface PdfPageOverlayLayerProps {
  viewer: ViewerController;
  index: number;
  size: PageSize | undefined;
  rotation: Rotation;
  width: number;
  height: number;
}

/**
 * Rendered directly as a JSX child at the end of `<section>` inside `PdfPage`
 * while `OverlayStore` is active for this page. `<PdfPageOverlays>` renders
 * inline without portaling; `<PdfPageOverlay page={index}>` portals into the
 * same `.parapdf-overlay-layer` element published by `attachLayer`.
 */
export function PdfPageOverlayLayer({
  viewer,
  index,
  size,
  rotation,
  width,
  height,
}: PdfPageOverlayLayerProps): ReactNode {
  const store = overlayStoreOf(viewer);
  const renderers = useSyncExternalStore(
    store.subscribeRenderers,
    store.getRenderers,
    getEmptyRenderers,
  );
  const subscribeClaim = useCallback(
    (listener: () => void) => store.subscribePortal(index, listener),
    [store, index],
  );
  const hasPortal = useSyncExternalStore(
    subscribeClaim,
    () => store.hasPortalClaim(index),
    getFalse,
  );

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
      if (hasOverlayNode(node)) nodes.push(createElement(Fragment, { key: entry.id }, node));
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
  return createElement(
    "div",
    {
      ref: attachLayer,
      className: "parapdf-overlay-layer",
      "data-main-rotation": String(rotation),
      style: {
        width: turned ? height : width,
        height: turned ? width : height,
      },
    },
    hasRendered ? createElement(PageContext, { value: pageContext }, rendered) : null,
  );
}
