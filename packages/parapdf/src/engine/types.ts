/**
 * The narrow engine boundary. The runtime only ever talks to an engine through
 * these types, so another engine can be measured without touching React code.
 */

/** Page size in PDF points (1/72 in), rotation already applied. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * Where a document comes from. A URL source may carry the request's headers
 * and credentials mode, and any source the password of an encrypted
 * document: the engine tries it first and asks for another (see
 * `OpenOptions.password`) only when it is wrong.
 */
export type PdfSource =
  | {
      url: string;
      httpHeaders?: Readonly<Record<string, string>>;
      withCredentials?: boolean;
      password?: string;
    }
  | { data: ArrayBuffer | Uint8Array; password?: string };

/** Why an encrypted document asks for a password: none was given, or the last one was wrong. */
export type PasswordReason = "required" | "incorrect";

export interface OpenOptions {
  /** Bytes received so far, and the document's size when the server reported it. */
  onProgress?(loaded: number, total: number | null): void;
  /**
   * Asked whenever an encrypted document needs a password. Resolve with the
   * password to try, or with null to stop opening it: `open` then rejects.
   * Without this callback, an encrypted document fails to open.
   */
  password?(reason: PasswordReason): Promise<string | null>;
  /** Aborting stops loading and frees what the engine holds for the document. */
  signal?: AbortSignal;
}

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
  /**
   * "print" draws what a printout shows, with the values typed into form
   * fields; "display" (the default) what a screen shows.
   */
  intent?: "display" | "print";
  /**
   * The container of this page's annotation layer when it shows form fields
   * as HTML (`AnnotationLayerRequest.forms`): the drawing leaves the fields
   * out, and what the layer needs drawn for them goes to it.
   */
  formLayer?: HTMLElement;
  /** Colors to draw the page in instead of its own, for high-contrast reading. */
  colors?: PageColors;
  /** Which layers to draw; the document's default when absent. */
  layers?: LayerState;
}

/** A page drawn in two colors: its background and everything else. */
export interface PageColors {
  background: string;
  foreground: string;
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
  /**
   * Receives a tagged page's structure, after the text: elements with ARIA
   * roles (headings, lists, tables, figures with their alternative text)
   * that take the text layer's runs in through `aria-owns`. It should be
   * accessible but not rendered, as a canvas's fallback content is.
   */
  structure?: HTMLElement;
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
  /** A file attachment annotation or a link to an embedded file was activated. */
  openAttachment?(attachment: { filename: string; content: Uint8Array }): void;
  /** A link that shows and hides layers was activated; the action is the engine's own. */
  setLayers?(action: unknown): void;
}

/**
 * A layer (optional content group) of the document, or a heading that only
 * groups the layers under it.
 */
export interface PdfLayer {
  /** Null for a heading. */
  id: string | null;
  name: string;
  /** Whether the layer shows; true for a heading. */
  visible: boolean;
  /** Layers listed under this one. */
  children: readonly PdfLayer[];
}

/**
 * Which of a document's layers show, for one viewer: renders and annotation
 * layers that get it draw what it shows, and its changes apply to the next
 * ones.
 */
export interface LayerState {
  /** The document's layers in its own order, with their visibility now; empty when it has none. */
  layers(): readonly PdfLayer[];
  /** Show or hide a layer. Showing one of a set of exclusive layers hides the others. */
  setVisible(id: string, visible: boolean): void;
  /** Apply a link's action from `LinkHandlers.setLayers`. */
  apply(action: unknown): void;
}

/** The document's information dictionary and XMP metadata, as far as it has them. */
export interface PdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  /** The version in the file's header, such as "1.7". */
  pdfVersion: string | null;
  /** The document's natural language (/Lang), such as "ja". */
  language: string | null;
}

/** A file embedded in the document. */
export interface PdfAttachment {
  /** Identifies it for `getAttachmentContent`. */
  id: string;
  /** The file's name without a path. */
  filename: string;
  description: string | null;
}

export interface AnnotationLayerRequest {
  pageIndex: number;
  /**
   * Receives positioned links, comment popups, and, with `forms`, form
   * fields; sized by the `--total-scale-factor` CSS variable.
   */
  container: HTMLElement;
  /** CSS pixels per PDF point. */
  cssScale: number;
  rotation?: Rotation;
  links: LinkHandlers;
  /**
   * Show form fields as HTML that the reader can fill in. The page's renders
   * then pass this container as their `formLayer`.
   */
  forms?: boolean;
  /** Hide the annotations of hidden layers; the document's default when absent. */
  layers?: LayerState;
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
  /** Each page's label, such as "iv" or "A-3"; null when the PDF defines none. */
  getPageLabels(): Promise<readonly string[] | null>;
  getMetadata(): Promise<PdfMetadata>;
  /** The document's embedded files; empty when it has none. */
  getAttachments(): Promise<readonly PdfAttachment[]>;
  getAttachmentContent(id: string): Promise<Uint8Array | null>;
  /** The document's bytes, with what was typed into its form fields saved in them. */
  save(): Promise<Uint8Array>;
  /** A new state of the document's layers, as the document shows them by default. */
  createLayerState(): Promise<LayerState>;
  resolveDestination(dest: DestinationRef): Promise<ResolvedDestination | null>;
  /** Drop cached parsing results for a page that left the mounted window. */
  releasePage(pageIndex: number): void;
  destroy(): Promise<void>;
}

export interface PdfEngine {
  readonly name: string;
  open(source: PdfSource, options?: OpenOptions): Promise<PdfEngineDocument>;
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
