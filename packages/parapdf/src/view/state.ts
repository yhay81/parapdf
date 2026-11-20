import type { PageSize } from "../document/session.ts";
import { Store } from "../document/store.ts";
import type { Rotation } from "../pdfjs/draw.ts";
import type { Direction, Layout, ScrollMode, SpreadMode } from "./layout.ts";

/**
 * What a viewer shows: its view of the document, which its store publishes.
 * The document's own state is its session's (`PdfSession.state`).
 */
export interface ViewerState {
  /** The pages laid out at the current zoom; null until a document shows. */
  layout: Layout | null;
  /** Pages in the laid-out document; 0 until a document shows. */
  pageCount: number;
  /** Mounted page window: visible pages plus overscan. */
  first: number;
  last: number;
  /**
   * The page being read: the page nearest the viewport's center, except that
   * the current page stays current while all of it is in view, as in pdf.js.
   * `goToPage()`, links, `back()`, and search make the page they show
   * current, which then stays so even when it is too small to reach the
   * center, as the first page at the start of a row of pages is.
   */
  currentPage: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /**
   * "fit-width" keeps fitting the width of the current page as the viewport
   * resizes or the view turns, "fit-page" all of that page, "auto" the
   * width of a portrait page and all of a landscape one, never above 5/3;
   * "custom" keeps `scale`.
   */
  zoomMode: ZoomMode;
  /**
   * What a mouse drag does: "select" selects text, "hand" scrolls the
   * document like grabbing paper.
   */
  tool: PointerTool;
  /** Clockwise view rotation of every page. */
  rotation: Rotation;
  /** Whether pages show one per row or side by side in pairs. */
  spread: SpreadMode;
  /**
   * How pages are arranged and scrolled: in a column, in a row, in rows
   * filling the viewport's width, or one page or spread at a time.
   */
  scrollMode: ScrollMode;
  /**
   * The order of pages in a row: the `direction` option, or the document's
   * /ViewerPreferences /Direction, or "ltr".
   */
  direction: Direction;
}

export type ZoomMode = FitMode | "custom";

/** The zoom modes that fit the page to the viewport again as it resizes. */
export type FitMode = "fit-width" | "fit-page" | "auto";

export type PointerTool = "select" | "hand";

/** Keys reported to key-filtered `ViewerStore` listeners. */
export type ViewerStoreKey = keyof ViewerState | "sizes" | "externalLinks";

export const INITIAL_VIEWER_STATE: ViewerState = {
  layout: null,
  pageCount: 0,
  first: 0,
  last: -1,
  currentPage: 0,
  scale: 1,
  zoomMode: "fit-width",
  tool: "select",
  rotation: 0,
  spread: "none",
  scrollMode: "vertical",
  direction: "ltr",
};

/** Bitmask positions for the 14 fixed `ViewerStoreKey`s. */
const VIEWER_KEY_BITS: Readonly<Record<ViewerStoreKey, number>> = {
  layout: 1 << 0,
  pageCount: 1 << 1,
  first: 1 << 2,
  last: 1 << 3,
  currentPage: 1 << 4,
  scale: 1 << 5,
  zoomMode: 1 << 6,
  tool: 1 << 7,
  rotation: 1 << 8,
  spread: 1 << 9,
  scrollMode: 1 << 10,
  direction: 1 << 11,
  sizes: 1 << 12,
  externalLinks: 1 << 13,
};

const ALL_VIEWER_KEYS_MASK = (1 << 14) - 1;

function bitOf(key: PropertyKey): number {
  return typeof key === "string" ? (VIEWER_KEY_BITS[key as ViewerStoreKey] ?? 0) : 0;
}

function maskOf(keys: readonly PropertyKey[]): number {
  let mask = 0;
  for (let index = 0; index < keys.length; index++) {
    mask |= bitOf(keys[index] as PropertyKey);
  }
  return mask;
}

interface KeyedListener {
  readonly mask: number;
  readonly listener: () => void;
}

/**
 * A viewer's single key-filtered store: publishes `ViewerState` along with
 * derived unrotated `sizes` (`"sizes"` only when `layout?.sizes` changes) and
 * `externalLinks` (`"externalLinks"`), installing all snapshots atomically
 * before notifying listeners. Keyed subscribers dispatch through a 14-bit
 * mask with zero `Set` lookups or key-array scans per publish.
 */
export class ViewerStore extends Store<ViewerState> {
  #externalLinks: "new-tab" | "disabled" = "new-tab";
  #batchExternalLinks: "new-tab" | "disabled" | null = null;
  #pendingMask = 0;
  readonly #keyListeners = new Set<KeyedListener>();

  constructor(value: ViewerState = INITIAL_VIEWER_STATE) {
    super(value);
  }

  get sizes(): readonly PageSize[] | undefined {
    return this.get().layout?.sizes;
  }

  get externalLinks(): "new-tab" | "disabled" {
    return this.#externalLinks;
  }

  subscribeKeys = (keys: readonly PropertyKey[], listener: () => void): (() => void) => {
    const entry: KeyedListener = { mask: maskOf(keys), listener };
    this.#keyListeners.add(entry);
    return () => {
      this.#keyListeners.delete(entry);
    };
  };

  override update(patch: Partial<ViewerState>): boolean {
    const prev = this.get();
    if (!super.update(patch)) return false;
    const next = this.get();
    if (!Object.is(prev.layout, next.layout)) this.#pendingMask |= VIEWER_KEY_BITS.layout;
    if (!Object.is(prev.pageCount, next.pageCount)) this.#pendingMask |= VIEWER_KEY_BITS.pageCount;
    if (!Object.is(prev.first, next.first)) this.#pendingMask |= VIEWER_KEY_BITS.first;
    if (!Object.is(prev.last, next.last)) this.#pendingMask |= VIEWER_KEY_BITS.last;
    if (!Object.is(prev.currentPage, next.currentPage))
      this.#pendingMask |= VIEWER_KEY_BITS.currentPage;
    if (!Object.is(prev.scale, next.scale)) this.#pendingMask |= VIEWER_KEY_BITS.scale;
    if (!Object.is(prev.zoomMode, next.zoomMode)) this.#pendingMask |= VIEWER_KEY_BITS.zoomMode;
    if (!Object.is(prev.tool, next.tool)) this.#pendingMask |= VIEWER_KEY_BITS.tool;
    if (!Object.is(prev.rotation, next.rotation)) this.#pendingMask |= VIEWER_KEY_BITS.rotation;
    if (!Object.is(prev.spread, next.spread)) this.#pendingMask |= VIEWER_KEY_BITS.spread;
    if (!Object.is(prev.scrollMode, next.scrollMode))
      this.#pendingMask |= VIEWER_KEY_BITS.scrollMode;
    if (!Object.is(prev.direction, next.direction)) this.#pendingMask |= VIEWER_KEY_BITS.direction;
    return true;
  }

  override markChanged(key: PropertyKey): void {
    super.markChanged(key);
    this.#pendingMask |= bitOf(key);
  }

  override unmarkChanged(key: PropertyKey): void {
    super.unmarkChanged(key);
    this.#pendingMask &= ~bitOf(key);
  }

  override batch<R>(fn: () => R): R {
    const outer = !this.batching;
    if (outer) this.#batchExternalLinks = this.#externalLinks;
    return super.batch(fn);
  }

  protected override finalizeBatch(base: ViewerState): void {
    const next = this.get();
    let mask = 0;
    if (!Object.is(base.layout, next.layout)) mask |= VIEWER_KEY_BITS.layout;
    if (!Object.is(base.pageCount, next.pageCount)) mask |= VIEWER_KEY_BITS.pageCount;
    if (!Object.is(base.first, next.first)) mask |= VIEWER_KEY_BITS.first;
    if (!Object.is(base.last, next.last)) mask |= VIEWER_KEY_BITS.last;
    if (!Object.is(base.currentPage, next.currentPage)) mask |= VIEWER_KEY_BITS.currentPage;
    if (!Object.is(base.scale, next.scale)) mask |= VIEWER_KEY_BITS.scale;
    if (!Object.is(base.zoomMode, next.zoomMode)) mask |= VIEWER_KEY_BITS.zoomMode;
    if (!Object.is(base.tool, next.tool)) mask |= VIEWER_KEY_BITS.tool;
    if (!Object.is(base.rotation, next.rotation)) mask |= VIEWER_KEY_BITS.rotation;
    if (!Object.is(base.spread, next.spread)) mask |= VIEWER_KEY_BITS.spread;
    if (!Object.is(base.scrollMode, next.scrollMode)) mask |= VIEWER_KEY_BITS.scrollMode;
    if (!Object.is(base.direction, next.direction)) mask |= VIEWER_KEY_BITS.direction;
    if (!Object.is(base.layout?.sizes, this.sizes)) {
      this.markChanged("sizes");
      mask |= VIEWER_KEY_BITS.sizes;
    } else {
      this.unmarkChanged("sizes");
    }
    const prevLinks = this.#batchExternalLinks;
    this.#batchExternalLinks = null;
    if (prevLinks !== null && prevLinks !== this.#externalLinks) {
      mask |= VIEWER_KEY_BITS.externalLinks;
    } else if (prevLinks !== null) {
      this.unmarkChanged("externalLinks");
    }
    this.#pendingMask = mask;
  }

  override publish(): void {
    const mask = this.#pendingMask || ALL_VIEWER_KEYS_MASK;
    this.#pendingMask = 0;
    super.publish();
    const size = this.#keyListeners.size;
    if (size === 0) return;
    if (size === 1) {
      for (const entry of this.#keyListeners) {
        if ((entry.mask & mask) !== 0) entry.listener();
        break;
      }
      return;
    }
    for (const entry of [...this.#keyListeners]) {
      if ((entry.mask & mask) !== 0 && this.#keyListeners.has(entry)) entry.listener();
    }
  }

  override set(patch: Partial<ViewerState>): void {
    const prevSizes = this.sizes;
    const hasLayout = "layout" in patch;
    const full =
      hasLayout && patch.pageCount === undefined
        ? { ...patch, pageCount: patch.layout?.sizes.length ?? 0 }
        : patch;
    const stateChanged = this.update(full);
    const sizesChanged = hasLayout && !Object.is(prevSizes, this.sizes);
    if (sizesChanged) {
      this.markChanged("sizes");
    }
    if ((stateChanged || sizesChanged) && !this.batching) this.publish();
  }

  setExternalLinks(externalLinks: "new-tab" | "disabled"): void {
    if (this.#externalLinks === externalLinks) return;
    this.#externalLinks = externalLinks;
    this.markChanged("externalLinks");
    if (!this.batching) this.publish();
  }
}
