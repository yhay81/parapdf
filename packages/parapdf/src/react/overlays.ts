"use client";

import {
  createElement,
  Fragment,
  type ReactNode,
  type ReactPortal,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Viewer } from "../view/viewer.ts";
import { PageContext, useOptionalViewer } from "./context.ts";

interface OverlayRenderer {
  readonly id: string;
  readonly render: (pageIndex: number) => ReactNode;
}

interface PageOverlayHost {
  host: HTMLElement;
  layer: HTMLDivElement | null;
  rotation: Rotation;
  width: number;
  height: number;
  hasRendered: boolean;
}

const EMPTY_RENDERERS: readonly OverlayRenderer[] = [];
const getEmptyRenderers = (): readonly OverlayRenderer[] => EMPTY_RENDERERS;
const getNullLayer = (): HTMLDivElement | null => null;

const hasOverlayNode = (node: ReactNode): boolean =>
  node !== null && node !== undefined && node !== false;

const createOverlayLayer = (): HTMLDivElement | null => {
  if (typeof document === "undefined") return null;
  const layer = document.createElement("div");
  layer.className = "parapdf-overlay-layer";
  return layer;
};

function applyLayerGeometry(
  layer: HTMLDivElement,
  rotation: Rotation,
  width: number,
  height: number,
): void {
  layer.dataset.mainRotation = String(rotation);
  const turned = rotation % 180 !== 0;
  layer.style.width = `${turned ? height : width}px`;
  layer.style.height = `${turned ? width : height}px`;
}

class OverlayStore {
  readonly #hosts = new Map<number, PageOverlayHost>();
  readonly #layers = new Map<number, HTMLDivElement>();
  readonly #portalCounts = new Map<number, number>();
  readonly #portalListeners = new Map<number, Set<() => void>>();
  readonly #rendererListeners = new Set<() => void>();
  #renderers: readonly OverlayRenderer[] = EMPTY_RENDERERS;
  #nextId = 0;

  nextRendererId(): string {
    return `overlay-${++this.#nextId}`;
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
  }

  removeRenderer(id: string): void {
    const next = this.#renderers.filter((entry) => entry.id !== id);
    if (next.length === this.#renderers.length) return;
    this.#renderers = next.length === 0 ? EMPTY_RENDERERS : next;
    this.#notifyRenderers();
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

  portalLayer(pageIndex: number): HTMLDivElement | null {
    if ((this.#portalCounts.get(pageIndex) ?? 0) <= 0) return null;
    return this.#hosts.get(pageIndex)?.layer ?? null;
  }

  claimPortal(pageIndex: number): () => void {
    this.#portalCounts.set(pageIndex, (this.#portalCounts.get(pageIndex) ?? 0) + 1);
    const before = this.#hosts.get(pageIndex)?.layer ?? null;
    this.#syncHostLayer(pageIndex);
    if ((this.#hosts.get(pageIndex)?.layer ?? null) !== before || before !== null) {
      this.#notifyPortal(pageIndex);
    }
    return () => {
      const remaining = (this.#portalCounts.get(pageIndex) ?? 0) - 1;
      if (remaining > 0) this.#portalCounts.set(pageIndex, remaining);
      else this.#portalCounts.delete(pageIndex);
      this.#syncHostLayer(pageIndex);
      this.#notifyPortal(pageIndex);
    };
  }

  ensureLayer(pageIndex: number): HTMLDivElement | null {
    let layer = this.#layers.get(pageIndex) ?? null;
    if (!layer) {
      layer = createOverlayLayer();
      if (layer) this.#layers.set(pageIndex, layer);
    }
    return layer;
  }

  attachHost(
    pageIndex: number,
    host: HTMLElement,
    rotation: Rotation,
    width: number,
    height: number,
    hasRendered: boolean,
  ): () => void {
    this.#hosts.set(pageIndex, {
      host,
      layer: null,
      rotation,
      width,
      height,
      hasRendered,
    });
    this.#syncHostLayer(pageIndex);
    if ((this.#portalCounts.get(pageIndex) ?? 0) > 0) this.#notifyPortal(pageIndex);
    return () => {
      const current = this.#hosts.get(pageIndex);
      if (current?.host !== host) return;
      current.layer?.remove();
      this.#hosts.delete(pageIndex);
      this.#layers.delete(pageIndex);
      if ((this.#portalCounts.get(pageIndex) ?? 0) > 0) this.#notifyPortal(pageIndex);
    };
  }

  syncHostGeometry(
    pageIndex: number,
    rotation: Rotation,
    width: number,
    height: number,
    hasRendered: boolean,
  ): void {
    const entry = this.#hosts.get(pageIndex);
    if (!entry) return;
    entry.rotation = rotation;
    entry.width = width;
    entry.height = height;
    entry.hasRendered = hasRendered;
    this.#syncHostLayer(pageIndex);
  }

  #syncHostLayer(pageIndex: number): void {
    const entry = this.#hosts.get(pageIndex);
    if (!entry) return;
    const needed = entry.hasRendered || (this.#portalCounts.get(pageIndex) ?? 0) > 0;
    if (!needed) {
      if (entry.layer) {
        entry.layer.remove();
        entry.layer = null;
      }
      return;
    }
    const layer = entry.layer ?? this.ensureLayer(pageIndex);
    if (!layer) return;
    entry.layer = layer;
    applyLayerGeometry(layer, entry.rotation, entry.width, entry.height);
    if (layer.parentNode !== entry.host) entry.host.append(layer);
  }
}

const overlayStores = new WeakMap<Viewer, OverlayStore>();

export function overlayStoreOf(viewer: Viewer): OverlayStore {
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
export function PdfPageOverlay({ page, viewer, children }: PdfPageOverlayProps) {
  const resolved = useOptionalViewer(viewer);
  const store = overlayStoreOf(resolved);
  const pageIndex = Number.isFinite(page) ? Math.trunc(page) : -1;
  const active = pageIndex >= 0 && hasOverlayNode(children);
  const pageContext = useMemo(() => ({ viewer: resolved, pageIndex }), [resolved, pageIndex]);

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
  const layer = useSyncExternalStore(
    subscribe,
    () => (active ? store.portalLayer(pageIndex) : null),
    getNullLayer,
  );

  if (!layer || !active) return null;
  return createPortal(createElement(PageContext, { value: pageContext }, children), layer);
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

/** Internal hook `memo(PdfPage)` uses to host `<PdfPageOverlays>` and `<PdfPageOverlay>` portals. */
export function usePageOverlays(
  viewer: Viewer,
  index: number,
  hostRef: RefObject<HTMLElement | null>,
  pageContext: { viewer: Viewer; pageIndex: number },
  rotation: Rotation,
  width: number,
  height: number,
): ReactPortal | null {
  const store = overlayStoreOf(viewer);
  const renderers = useSyncExternalStore(
    store.subscribeRenderers,
    store.getRenderers,
    getEmptyRenderers,
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

  const layer = hasRendered ? store.ensureLayer(index) : null;
  const latestGeometry = useRef({ rotation, width, height, hasRendered });
  latestGeometry.current = { rotation, width, height, hasRendered };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const {
      rotation: initialRotation,
      width: initialWidth,
      height: initialHeight,
      hasRendered: initialHasRendered,
    } = latestGeometry.current;
    return store.attachHost(
      index,
      host,
      initialRotation,
      initialWidth,
      initialHeight,
      initialHasRendered,
    );
  }, [store, index, hostRef]);

  useLayoutEffect(() => {
    store.syncHostGeometry(index, rotation, width, height, hasRendered);
  }, [store, index, rotation, width, height, hasRendered]);

  return layer && hasRendered
    ? createPortal(createElement(PageContext, { value: pageContext }, rendered), layer)
    : null;
}
