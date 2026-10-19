/**
 * The narrow engine boundary. The runtime only ever talks to an engine through
 * these types, so another engine can be measured without touching React code.
 */

/** Page size in PDF points (1/72 in), rotation already applied. */
export interface PageSize {
  width: number;
  height: number;
}

export type PdfSource = { url: string } | { data: ArrayBuffer | Uint8Array };

/** A rectangle of a page in pixels at a render's scale. */
export interface RenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clockwise view rotation in degrees, on top of any rotation the page itself has. */
export type Rotation = 0 | 90 | 180 | 270;

export interface RenderRequest {
  pageIndex: number;
  /** Device pixels per PDF point. */
  scale: number;
  rotation?: Rotation;
  canvas: HTMLCanvasElement;
  /** Draw only this part of the page; the canvas takes its size. The whole page when absent. */
  region?: RenderRegion;
}

export interface RenderTask {
  /** Resolves once the pixels are on `canvas`; rejects with a cancellation error after `cancel`. */
  readonly promise: Promise<void>;
  cancel(): void;
}

/** The text of one page as positioned runs, in content order. */
export interface PageText {
  readonly items: readonly string[];
  /** Whether a line ends after each item. */
  readonly endsLine: readonly boolean[];
  /**
   * Approximate box of each item in PDF points from the page's top-left corner,
   * with the page's own rotation applied but no view rotation:
   * `[x, y, width, height]` per item. Used to scroll to matches before a
   * page's text layer exists.
   */
  readonly boxes: Float32Array;
}

export interface TextLayerRequest {
  pageIndex: number;
  /**
   * Receives the positioned text runs; sized by the `--total-scale-factor`
   * CSS variable. The engine sets its `lang` to the language the runs are
   * sized in: the PDF's, or the language it inherits when the PDF has none.
   */
  container: HTMLElement;
  /** CSS pixels per PDF point. */
  cssScale: number;
  rotation?: Rotation;
}

export interface TextLayerHandle {
  /** One element per item of `PageText.items`, in the same order. */
  readonly elements: readonly HTMLElement[];
  /** Re-measure the runs for a new zoom level, or turn them with the view. */
  update(cssScale: number, rotation: Rotation): void;
}

export interface TextLayerTask {
  readonly promise: Promise<TextLayerHandle>;
  cancel(): void;
}

/** An engine-specific link target (a named or explicit PDF destination). */
export type DestinationRef = unknown;

/**
 * Where a destination points: a page and an optional point in PDF points from
 * its top-left corner, with the page's own rotation applied but no view rotation.
 */
export interface ResolvedDestination {
  pageIndex: number;
  x: number | null;
  y: number | null;
}

export interface OutlineNode {
  title: string;
  /** Internal target, or null when the entry links elsewhere or nowhere. */
  dest: DestinationRef | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: readonly OutlineNode[];
}

/** How activated links leave the annotation layer: always through the runtime. */
export interface LinkHandlers {
  navigate(dest: DestinationRef): void;
  /** PDF named actions such as `NextPage` or `GoBack`. */
  namedAction(action: string): void;
  /** Links to other documents open in a new tab (the default) or stay inert. */
  externalLinks?: "new-tab" | "disabled";
}

export interface AnnotationLayerRequest {
  pageIndex: number;
  /** Receives positioned link elements; sized by the `--total-scale-factor` CSS variable. */
  container: HTMLElement;
  /** CSS pixels per PDF point. */
  cssScale: number;
  rotation?: Rotation;
  links: LinkHandlers;
}

export interface AnnotationLayerHandle {
  update(cssScale: number, rotation: Rotation): void;
}

export interface AnnotationLayerTask {
  readonly promise: Promise<AnnotationLayerHandle>;
  cancel(): void;
}

export interface PdfEngineDocument {
  readonly pageCount: number;
  /**
   * The engine's own document object, for features ParaPDF does not wrap;
   * pdf.js engines hold a PDFDocumentProxy here (see pdfjsDocumentOf).
   */
  readonly native: unknown;
  /** The page's size in PDF points with its own rotation applied. */
  pageSize(pageIndex: number): Promise<PageSize>;
  render(request: RenderRequest): RenderTask;
  getText(pageIndex: number): Promise<PageText>;
  /** Build a selectable, searchable, screen-reader-visible text layer. */
  renderTextLayer(request: TextLayerRequest): TextLayerTask;
  /** Build focusable link elements for the page's link annotations. */
  renderAnnotationLayer(request: AnnotationLayerRequest): AnnotationLayerTask;
  /** The document outline (bookmarks); empty when the PDF has none. */
  getOutline(): Promise<readonly OutlineNode[]>;
  resolveDestination(dest: DestinationRef): Promise<ResolvedDestination | null>;
  /** Drop cached parsing results for a page that left the mounted window. */
  releasePage(pageIndex: number): void;
  destroy(): Promise<void>;
}

export interface PdfEngine {
  readonly name: string;
  open(source: PdfSource): Promise<PdfEngineDocument>;
}

export class RenderCancelledError extends Error {
  override readonly name = "RenderCancelledError";
}

const cancellationNames = new Set([
  "RenderCancelledError",
  // pdf.js names for a cancelled page render and a cancelled text layer.
  "RenderingCancelledException",
  "AbortException",
]);

export const isRenderCancelled = (error: unknown): boolean =>
  error instanceof Error && cancellationNames.has(error.name);
