"use client";

import type { Layout } from "./layout.ts";

type PageLabel = (pageNumber: number, pageCount: number) => string;

interface HostLifecycle {
  attach(index: number, host: HTMLElement): void;
  detach(index: number): void;
  recoverFocus(host: HTMLElement): void;
}

const defaultPageLabel = (pageNumber: number, pageCount: number) =>
  `Page ${pageNumber} of ${pageCount}`;

function stylePageHost(host: HTMLElement, layout: Layout, index: number, centered: boolean): void {
  const top = layout.tops[index] ?? 0;
  const gap = layout.gap;
  const rowWidth = layout.rowWidths[index] ?? 0;
  const rowHeight = centered ? (layout.rowHeights[index] ?? 0) : null;
  const hidden = layout.shown !== null && (index < layout.shown.first || index > layout.shown.last);
  const offset = layout.offsets[index] ?? 0;
  const width = layout.widths[index] ?? 0;
  const height = layout.heights[index] ?? 0;
  const { style } = host;
  style.top =
    rowHeight === null
      ? `${top}px`
      : `calc(${top}px + max(0px, (100cqh - ${rowHeight}px) / 2 - ${gap}px))`;
  style.left = `calc(max(${gap}px, (100cqw - ${rowWidth}px) / 2) + ${offset}px)`;
  style.visibility = hidden ? "hidden" : "";
  style.width = `${width}px`;
  style.height = `${height}px`;
  style.setProperty("--scale-factor", String(layout.scale));
}

/** The ordered page sections in one viewport, including their labels and mount notifications. */
export class PageHosts {
  readonly #hosts = new Map<number, HTMLElement>();
  readonly #listeners = new Map<number, Set<() => void>>();
  readonly #lifecycle: HostLifecycle;
  #label: PageLabel = defaultPageLabel;
  #layout: Layout | null = null;

  constructor(lifecycle: HostLifecycle) {
    this.#lifecycle = lifecycle;
  }

  get mounted(): ReadonlyMap<number, HTMLElement> {
    return this.#hosts;
  }

  /** The layout last applied to the mounted sections. Cleared on detach. */
  get layout(): Layout | null {
    return this.#layout;
  }

  setLabel(label: PageLabel = defaultPageLabel, pageCount: number): void {
    if (this.#label === label) return;
    this.#label = label;
    for (const [index, host] of this.#hosts) {
      host.setAttribute("aria-label", label(index + 1, pageCount));
    }
  }

  subscribe(index: number, listener: () => void): () => void {
    let set = this.#listeners.get(index);
    if (!set) {
      set = new Set();
      this.#listeners.set(index, set);
    }
    set.add(listener);
    return () => {
      const current = this.#listeners.get(index);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(index);
    };
  }

  #notify(index: number): void {
    const set = this.#listeners.get(index);
    if (!set || set.size === 0) return;
    if (set.size === 1) {
      for (const listener of set) {
        listener();
        break;
      }
      return;
    }
    for (const listener of [...set]) {
      if (set.has(listener)) listener();
    }
  }

  #remove(index: number, host: HTMLElement): void {
    this.#hosts.delete(index);
    this.#lifecycle.detach(index);
    host.remove();
    this.#notify(index);
  }

  clear(): void {
    if (this.#hosts.size > 0) {
      for (const [index, host] of [...this.#hosts]) this.#remove(index, host);
    }
    this.#layout = null;
  }

  /** Attach each entering page before the renderer plans this frame's drawings. */
  sync(content: HTMLElement | null, layout: Layout, first: number, last: number): void {
    const doc = content?.ownerDocument;
    if (!content || !doc?.createElement || !content.append) return;
    if (last < first) {
      this.clear();
      return;
    }
    const layoutChanged = this.#layout !== layout;
    const pageCount = layout.sizes.length;
    const pageCountChanged = (this.#layout?.sizes.length ?? -1) !== pageCount;
    const centered = layout.scrollMode === "horizontal" || layout.shown !== null;

    for (const [index, host] of [...this.#hosts]) {
      if (index < first || index > last) {
        this.#lifecycle.recoverFocus(host);
        this.#remove(index, host);
      }
    }

    let nextHost = first;
    let anchor: HTMLElement | null = null;
    for (let index = first; index <= last; index++) {
      const existing = this.#hosts.get(index);
      if (existing) {
        if (layoutChanged) {
          stylePageHost(existing, layout, index, centered);
          if (pageCountChanged) {
            existing.setAttribute("aria-label", this.#label(index + 1, pageCount));
          }
        }
        continue;
      }
      const host = doc.createElement("section");
      host.setAttribute("data-page", String(index + 1));
      host.setAttribute("aria-label", this.#label(index + 1, pageCount));
      host.tabIndex = -1;
      stylePageHost(host, layout, index, centered);
      // A run of missing pages all goes before the same surviving host.
      if (nextHost <= index || (anchor && anchor.parentNode !== content)) {
        anchor = null;
        for (nextHost = index + 1; nextHost <= last; nextHost++) {
          const candidate = this.#hosts.get(nextHost);
          if (candidate?.parentNode === content) {
            anchor = candidate;
            break;
          }
        }
      }
      if (anchor) content.insertBefore(host, anchor);
      else content.append(host);
      this.#hosts.set(index, host);
      this.#lifecycle.attach(index, host);
      this.#notify(index);
    }
    this.#layout = layout;
  }
}
