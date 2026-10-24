/**
 * How the runtime uses pdf.js: the documents it opens and what it asks of
 * them, typed for the runtime and for tests that stand in for pdf.js.
 * ParaPDF uses pdf.js alone and optimizes for it.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

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
  /** The view the destination asks for; absent when it asks for none. */
  view?: DestinationView;
}

/**
 * The zoom a destination asks for (PDF 32000-1, 12.3.2.2): a zoom factor
 * (`XYZ`, 1 for the page's printed size; null keeps the zoom), the whole
 * page (`Fit`, `FitB`), its width (`FitH`, `FitBH`) or height (`FitV`,
 * `FitBV`), or a rectangle (`FitR`) whose top-left corner is the
 * destination's point, in PDF points with the page's own rotation applied.
 */
export type DestinationView =
  | { fit: "zoom"; zoom: number | null }
  | { fit: "page" }
  | { fit: "width" }
  | { fit: "height" }
  | { fit: "rect"; width: number; height: number };

/**
 * What the document's encryption dictionary permits (PDF 32000-1, Table 22).
 * Documents that are not encrypted permit everything.
 */
export interface PdfPermissions {
  /** Whether the document restricts anything at all. */
  restricted: boolean;
  print: boolean;
  /** Printing at full resolution; without it, printing may be degraded. */
  printHighQuality: boolean;
  /** Changing the document's content other than annotations and forms. */
  modify: boolean;
  /** Copying text and graphics. */
  copy: boolean;
  /** Extracting text for accessibility. */
  copyForAccessibility: boolean;
  /** Adding and changing annotations, and filling in forms. */
  annotate: boolean;
  /** Filling in existing form fields, even without `annotate`. */
  fillForms: boolean;
  /** Inserting, deleting, and turning pages. */
  assemble: boolean;
}

/** How the document's catalog asks a viewer to arrange pages (/PageLayout). */
export type PdfPageLayout =
  | "SinglePage"
  | "OneColumn"
  | "TwoColumnLeft"
  | "TwoColumnRight"
  | "TwoPageLeft"
  | "TwoPageRight";

/** What the document's catalog asks a viewer to show beside the pages (/PageMode). */
export type PdfPageMode =
  | "UseNone"
  | "UseOutlines"
  | "UseThumbs"
  | "FullScreen"
  | "UseOC"
  | "UseAttachments";

/** How the document asks to be shown when it opens; null where it asks nothing. */
export interface PdfInitialView {
  /** Where to open: the destination of the catalog's /OpenAction. */
  destination: ResolvedDestination | null;
  pageLayout: PdfPageLayout | null;
  pageMode: PdfPageMode | null;
}

export type FormFieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "combobox"
  | "listbox"
  | "button"
  | "signature";

/**
 * A form field's value: text, the export value of the checked box or radio
 * button ("Off" when none is), or the selected options' export values.
 */
export type FormValue = string | readonly string[];

/** A form field of the document, with the widgets that show it on pages. */
export interface FormField {
  /** The fully qualified name, such as "address.city". */
  name: string;
  type: FormFieldType;
  /** The value now, with what the reader typed and `setFormValues()` set. */
  value: FormValue;
  /** The value the document starts with. */
  defaultValue: FormValue;
  readOnly: boolean;
  required: boolean;
  /** Whether a list box takes several options. */
  multiple: boolean;
  /** The options of a combo or list box. */
  options: readonly { value: string; label: string }[];
  /** The values that check one of its boxes or radio buttons. */
  exportValues: readonly string[];
  /** Where the field shows: a page and a rectangle in unturned PDF points from its top-left corner. */
  widgets: readonly {
    id: string;
    pageIndex: number;
    rect: { x: number; y: number; width: number; height: number };
  }[];
}

/** A value the reader entered into a form field. */
export interface FormChange {
  name: string;
  value: FormValue;
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

/**
 * What a pointer does on the pages while annotations are edited: create
 * one kind of annotation, or, with "none", nothing: annotations created
 * before still show, but cannot be selected.
 */
export type AnnotationTool = "none" | "highlight" | "freetext" | "ink" | "stamp" | "signature";

/** The kinds of annotation a viewer creates. */
export type AnnotationType = Exclude<AnnotationTool, "none">;

/**
 * The style each tool gives the annotations it creates, or, while some are
 * selected, the style of the last one selected. Colors are CSS hex colors
 * ("#ff0000"); thicknesses and font sizes are in PDF points.
 */
export interface AnnotationStyles {
  /** `thickness` is the width of a highlight drawn freehand, outside text. */
  highlight: { color: string; thickness: number };
  freetext: { color: string; fontSize: number };
  ink: { color: string; thickness: number; opacity: number };
}

/** What can be done with the annotations a viewer edits. */
export interface AnnotationEditingState {
  canUndo: boolean;
  canRedo: boolean;
  /** Some are selected: deleting and styling apply to them. */
  hasSelection: boolean;
  /** None was created, or every one created was deleted. */
  isEmpty: boolean;
}

/**
 * A signature to place on a page: typed text, drawn in a font of the
 * application's choice (default "serif", italic); an image, whose outline
 * is traced; or strokes drawn in a box of `width` by `height` units, each a
 * list of points as alternating x and y coordinates, y downward.
 */
export type SignatureInput =
  | { text: string; fontFamily?: string; fontStyle?: string; fontWeight?: string }
  | { image: Blob | ImageBitmap }
  | {
      strokes: readonly (readonly number[])[];
      width: number;
      height: number;
      /** Stroke width in the same units (default 1). */
      thickness?: number;
    };

/**
 * An annotation a viewer created, as JSON-compatible data the application
 * can keep and give back to `importAnnotations()`, in this or another
 * session. `data` belongs to the engine: keep it as it is.
 */
export interface SavedAnnotation {
  pageIndex: number;
  type: AnnotationType;
  data: unknown;
}

/**
 * The accessible names of the controls and annotations the editor shows,
 * in the application's language.
 */
export interface AnnotationLabels {
  highlight: string;
  freeText: string;
  /** What an empty text annotation shows until the reader types. */
  freeTextPlaceholder: string;
  ink: string;
  stamp: string;
  signature: string;
  removeHighlight: string;
  removeFreeText: string;
  removeInk: string;
  removeStamp: string;
  removeSignature: string;
  /** The button that opens a highlight's colors, and the list of them. */
  color: string;
  colors: string;
  textColor: string;
  inkColor: string;
  yellow: string;
  green: string;
  blue: string;
  pink: string;
  red: string;
  resizeTopLeft: string;
  resizeTopMiddle: string;
  resizeTopRight: string;
  resizeMiddleRight: string;
  resizeBottomRight: string;
  resizeBottomMiddle: string;
  resizeBottomLeft: string;
  resizeMiddleLeft: string;
}

export interface AnnotationEditorOptions {
  /** The scroll container: editing keys work while focus is in it. */
  container: HTMLElement;
  /** The element that holds the pages; dragging an annotation turns text selection off on it. */
  pages: HTMLElement;
  labels: AnnotationLabels;
  /** The colors pages are drawn in, which images and highlights follow. */
  pageColors?: PageColors;
  /** CSS pixels per PDF point and the view's rotation the pages show now. */
  scale: number;
  rotation: Rotation;
  onStateChange(state: AnnotationEditingState): void;
  onStylesChange(styles: AnnotationStyles): void;
  /** The editor switched tools by itself, as when the reader selects an annotation of another kind. */
  onToolChange(tool: AnnotationTool): void;
}

export interface AnnotationLayerElements {
  pageIndex: number;
  /** Receives the page's annotations being edited; laid out unturned and turned by the engine. */
  container: HTMLElement;
  /**
   * Receives the drawings of highlights and freehand lines, under the text
   * layer: the page's canvases' parent, unturned.
   */
  drawings: HTMLElement;
  /** The page's text layer, whose selections become highlights; null without one. */
  textLayer: HTMLElement | null;
  /** CSS pixels per PDF point, and the view's rotation. */
  cssScale: number;
  rotation: Rotation;
}

export interface AnnotationLayerEditor {
  /** The view turned; zooming needs nothing. */
  update(cssScale: number, rotation: Rotation): void;
  destroy(): void;
}

export interface AnnotationEditorLayerTask {
  readonly promise: Promise<AnnotationLayerEditor>;
  cancel(): void;
}

/**
 * The annotations one viewer creates and edits. Annotations stay with it
 * while their pages unmount and are shown again on the pages' new layers.
 */
export interface AnnotationEditor {
  readonly state: AnnotationEditingState;
  readonly styles: AnnotationStyles;
  setTool(tool: AnnotationTool): Promise<void>;
  /** Restyle the selected annotations, or with none selected, the next ones `tool` creates. */
  setStyle<T extends keyof AnnotationStyles>(tool: T, style: Partial<AnnotationStyles[T]>): void;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  selectAll(): void;
  /** Finish the annotation being typed or drawn, before saving or printing. */
  commit(): void;
  /**
   * Add an image to page `pageIndex`, whose annotation layer must be built,
   * centered in its visible part; false when the image cannot be read.
   */
  addImage(pageIndex: number, image: Blob | string, altText?: string): Promise<boolean>;
  /** Add a signature to page `pageIndex` as `addImage` adds an image. */
  addSignature(
    pageIndex: number,
    signature: SignatureInput,
    description?: string,
  ): Promise<boolean>;
  /** Every annotation created, as data `import` takes. */
  export(): SavedAnnotation[];
  /** Add annotations `export` gave, on mounted pages or not, without an undo step. */
  import(annotations: readonly SavedAnnotation[]): Promise<number>;
  /** The view zoomed or turned. */
  setView(cssScale: number, rotation: Rotation): void;
  /** The page keyboard shortcuts and pasting act on. */
  setCurrentPage(pageIndex: number): void;
  renderLayer(elements: AnnotationLayerElements): AnnotationEditorLayerTask;
  /** Ends editing and forgets every annotation that was not saved. */
  destroy(): void;
}

export interface PdfEngineDocument {
  readonly pageCount: number;
  /** pdf.js's own document, for its APIs ParaPDF does not wrap. */
  readonly proxy: PDFDocumentProxy;
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
  /**
   * The document's bytes, with what was typed into its form fields and the
   * annotations its editor created saved in them.
   */
  save(): Promise<Uint8Array>;
  /** A new state of the document's layers, as the document shows them by default. */
  createLayerState(): Promise<LayerState>;
  /**
   * Start editing annotations, once the editor's code has loaded. The
   * document then belongs to this editor:
   * its annotations go into the document's bytes that `save` returns, and
   * a second editor of the same document would mix them up.
   */
  createAnnotationEditor(options: AnnotationEditorOptions): Promise<AnnotationEditor>;
  resolveDestination(dest: DestinationRef): Promise<ResolvedDestination | null>;
  /** What the document permits; everything when it is not encrypted. */
  getPermissions(): Promise<PdfPermissions>;
  /** How the document asks to be shown when it opens. */
  getInitialView(): Promise<PdfInitialView>;
  /** The document's form fields, with their current values; empty when it has none. */
  getFormFields(): Promise<readonly FormField[]>;
  /**
   * Set form fields by name; returns the names it set. Form layers built
   * afterwards show the values, and `save()` writes them.
   */
  setFormValues(values: Readonly<Record<string, FormValue | boolean>>): Promise<string[]>;
  /**
   * The field and its value after the reader changed the form element of
   * the widget with id `widgetId` (its `data-element-id`); null for another element.
   */
  formChange(widgetId: string): Promise<FormChange | null>;
  /** Drop cached parsing results for a page that left the mounted window. */
  releasePage(pageIndex: number): void;
  /**
   * Draw `source`, a drawing kept from another canvas of a page of this
   * document, into `canvas`, sized to it, with the context renders draw
   * with, so that the page shows it at once and later renders draw over it.
   */
  drawKept(canvas: HTMLCanvasElement, source: HTMLCanvasElement): void;
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
