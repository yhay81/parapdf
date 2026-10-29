import type { DocumentSession } from "../document/session.ts";
import type { ResolvedDestination } from "../pdfjs/destinations.ts";
import type { PageColors, Rotation } from "../pdfjs/draw.ts";
import { DEFAULT_BUDGETS } from "../render/planner.ts";
import type { RendererOptions } from "../render/renderer.ts";
import type { Direction, ScrollMode, SpreadMode } from "./layout.ts";
import type { FitMode, PointerTool } from "./state.ts";

/** A view for `show()`: what it leaves out stays as the viewer shows it. */
export interface ShownView {
  rotation?: Rotation;
  spread?: SpreadMode;
  scrollMode?: ScrollMode;
  /** CSS pixels per PDF point, or the fit that keeps the zoom. */
  scale?: number | FitMode;
  /**
   * The point of a page to show at the viewport's top-left corner, in PDF
   * points from its unturned top-left corner, with the zoom its `view` asks
   * for when `scale` is left out (and `destinationZoom` is on). Without a
   * point, the page shows from its top; without a target, the current page.
   */
  target?: ResolvedDestination;
}

/** How a document opens in a viewer; see `ViewerOptions.opening`. */
export interface Opening {
  /** The arrangement of the first layout. */
  spread?: SpreadMode;
  scrollMode?: ScrollMode;
  /** A view to show, which wins over `initialPage` and `destination`. */
  view?: ShownView;
  /** Where to open, with the zoom it asks for, unless `initialPage` is set. */
  destination?: ResolvedDestination;
}

/**
 * How a viewer shows documents, set by its `PdfViewer`'s props. They change
 * while it shows one (`setViewerOptions()`); the initial ones apply as it
 * opens a document.
 */
export interface ViewerOptions {
  /** Space between pages in CSS pixels. */
  gap?: number;
  /** One page per row (the default), or pairs side by side, at first; see `setSpread()`. */
  initialSpread?: SpreadMode;
  /** How pages are arranged and scrolled at first (default "vertical"); see `setScrollMode()`. */
  initialScrollMode?: ScrollMode;
  /** The clockwise rotation of every page at first (default 0); see `setRotation()`. */
  initialRotation?: Rotation;
  /** Pages mounted beyond each edge of the viewport. */
  overscan?: number;
  maxConcurrentRenders?: number;
  /**
   * A scale in CSS pixels per point, "fit-width" (the default) to keep
   * fitting the page width, "fit-page" to keep fitting the whole page, or
   * "auto" to keep fitting as pdf.js's viewer opens documents.
   */
  initialScale?: number | FitMode;
  /** The zero-based page shown first, at the top of the viewport (default 0). */
  initialPage?: number;
  /**
   * The order of pages in a row, as the view state's `direction` holds it:
   * "rtl" puts the earlier page of a spread on the right and runs rows from
   * right to left. Unset, the document's /ViewerPreferences /Direction
   * decides, and "ltr" where it says nothing.
   */
  direction?: Direction;
  /** What a mouse drag does at first (default "select"); see `setTool()`. */
  initialTool?: PointerTool;
  /**
   * How each document opens, read beside its first page's size: the
   * initial view feature makes it from `initialView` and `initialViewState`.
   * A viewport that reattaches returns to where it was instead.
   */
  opening?: (session: DocumentSession) => Promise<Opening | null>;
  /**
   * Whether links and the outline take the zoom their destination asks for
   * (default true), as in pdf.js: a factor, the page's width or height, the
   * whole page, or a rectangle that fills the viewport. With false, they
   * keep the zoom and only scroll.
   */
  destinationZoom?: boolean;
  minScale?: number;
  maxScale?: number;
  /** Build selectable, searchable text layers (default true). */
  textLayer?: boolean;
  /**
   * Build annotation layers (default true): focusable links, comment popups,
   * and, with `forms`, form fields.
   */
  annotationLayer?: boolean;
  /**
   * Draw pages in these two colors instead of their own, for example
   * `{ background: "Canvas", foreground: "CanvasText" }` in forced-colors mode.
   */
  pageColors?: PageColors;
  /**
   * What links to other documents do: open in a new tab (the default), or
   * nothing, for apps that must not lead away from the document. Internal
   * links and the outline keep working.
   */
  externalLinks?: "new-tab" | "disabled";
  /**
   * Called when the reader opens a file attachment annotation or a link to
   * an embedded file. By default the browser downloads the file.
   */
  openAttachment?: (attachment: { filename: string; content: Uint8Array }) => void;
  /**
   * The most pixels one page's detail canvas holds (default 16 777 216, the
   * canvas area limit of iOS). A page larger at full resolution gets detail
   * only for its visible area plus a margin, still at full resolution.
   */
  maxDetailPixels?: number;
  /**
   * The most pixels one page's detail canvas holds, as a multiple of the
   * viewport's device pixels (default unlimited): the margin drawn around the
   * visible area then follows the viewport's size, small on a phone and large
   * on a wide desktop panel. maxDetailPixels still caps it. At 1 the detail
   * holds just the viewport; below 1 the visible area loses resolution.
   */
  maxDetailViewports?: number;
  /** The most pixels one page's base canvas holds (default 2 097 152). */
  maxBasePixels?: number;
  /**
   * The most pixels all of this viewer's canvases hold together (default
   * unlimited), for memory-capped browsers such as iOS Safari. Visible pages
   * come first: after their bases, each visible page's detail gets a share of
   * the rest by visible area, losing its margin first and then resolution, in
   * quarter-octave steps down to its base's. Pages outside the viewport
   * render only within what is left and give their pixels back, farthest
   * first and detail before base. Visible bases are never given back, so a
   * visible page never goes blank, and a budget smaller than they are is
   * exceeded by them.
   */
  maxCanvasPixels?: number;
  /**
   * The most pixels kept of the canvases of pages that leave the mounted
   * window, so that a page the reader comes back to, by a link's back, by
   * scrolling back, or by flipping back, shows at once instead of being
   * drawn again (default twelve viewports' worth of device pixels; 0 keeps
   * none). Within `maxCanvasPixels`, they count as canvases and go first.
   */
  maxKeptPixels?: number;
}

/** The options the renderer is built with: changing one builds it again. */
const RENDERER_OPTIONS = [
  "textLayer",
  "annotationLayer",
  "externalLinks",
  "pageColors",
  "maxConcurrentRenders",
  "maxDetailPixels",
  "maxDetailViewports",
  "maxBasePixels",
  "maxCanvasPixels",
  "maxKeptPixels",
] as const satisfies readonly (keyof ViewerOptions)[];

/** Whether two `pageColors` options draw alike: applications pass them inline. */
const samePageColors = (a: PageColors | undefined, b: PageColors | undefined): boolean =>
  a === b || (!!a && !!b && a.background === b.background && a.foreground === b.foreground);

/**
 * What the options the renderer is built with are when left out, which
 * setting them to changes nothing; `maxKeptPixels` follows the viewport.
 */
const RENDERER_DEFAULTS: Partial<ViewerOptions> = {
  textLayer: true,
  annotationLayer: true,
  externalLinks: "new-tab",
  maxConcurrentRenders: 2,
  ...DEFAULT_BUDGETS,
};

/** Whether going from `previous` to `next` builds the renderer again. */
export const rendererChanged = (previous: ViewerOptions, next: ViewerOptions): boolean =>
  RENDERER_OPTIONS.some((name) =>
    name === "pageColors"
      ? !samePageColors(previous.pageColors, next.pageColors)
      : !Object.is(
          previous[name] ?? RENDERER_DEFAULTS[name],
          next[name] ?? RENDERER_DEFAULTS[name],
        ),
  );

/**
 * What the renderer is built with of `options`: the ones `rendererChanged()`
 * compares, but `externalLinks`, which reaches it through the viewer's link
 * handlers.
 */
export const rendererOptions = (options: ViewerOptions): RendererOptions => ({
  maxConcurrent: options.maxConcurrentRenders ?? 2,
  textLayer: options.textLayer ?? true,
  annotationLayer: options.annotationLayer ?? true,
  maxDetailPixels: options.maxDetailPixels,
  maxDetailViewports: options.maxDetailViewports,
  maxBasePixels: options.maxBasePixels,
  maxCanvasPixels: options.maxCanvasPixels,
  maxKeptPixels: options.maxKeptPixels,
  ...(options.pageColors ? { pageColors: options.pageColors } : {}),
});
