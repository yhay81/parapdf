import type * as Pdfjs from "pdfjs-dist";
import type { AnnotationLayerEditing } from "./annotation-layer.ts";
import type { PageColors, Rotation } from "./draw.ts";
import type { StructTreeBuilder } from "./struct-tree.ts";

/*
 * The types of the annotation editor that `editor.ts` makes, which the rest
 * of ParaPDF and applications import: the `AnnotationEditor` the renderer
 * builds the pages' editor layers with and the annotation editing feature
 * drives, and the data it takes and gives. Importing them loads none of the
 * editor.
 */

/**
 * What a pointer does on the pages while annotations are edited: create
 * one kind of annotation, or, with "none", nothing: annotations created
 * before still show, but cannot be selected. While a tool is chosen, those
 * the file holds that pdf.js edits can be selected too.
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
  /** The annotation selected when the reader selected one alone, else null. */
  selected: SelectedAnnotation | null;
}

/** What an image says to assistive technology, in the PDF too. */
export interface AnnotationAltText {
  text: string;
  /** The image only decorates the page: assistive technology skips it. */
  decorative: boolean;
}

/** The one annotation selected: what `setComment` and `setAltText` change. */
export interface SelectedAnnotation {
  /** Its id while this viewer edits it, to tell one selected from another. */
  id: string;
  pageIndex: number;
  type: AnnotationType;
  /**
   * Its comment, which the PDF saves as the annotation's popup note; null
   * without one, and for text annotations, whose text is their content.
   */
  comment: string | null;
  /** Images' alone: their alternative text, null for other kinds. */
  altText: AnnotationAltText | null;
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
 * session. `data` is pdf.js's: keep it as it is.
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
  /**
   * Pages are to be drawn again, as `layerEditing.editing` says (see
   * `AnnotationLayerEditing`): a tool was chosen, or the tool went back to
   * none, or imported annotations took the place of the file's.
   */
  onRedraw(): void;
}

export interface AnnotationLayerElements {
  pageIndex: number;
  /** Receives the page's annotations being edited; laid out unturned and turned by pdf.js. */
  container: HTMLElement;
  /**
   * Receives the drawings of highlights and freehand lines, under the text
   * layer: the page's canvases' parent, unturned.
   */
  drawings: HTMLElement;
  /** The page's text layer, whose selections become highlights; null without one. */
  textLayer: HTMLElement | null;
  /**
   * The page's annotation layer, built with `layerEditing`, whose
   * annotations of the kinds pdf.js edits become editors while a tool is
   * chosen; null without one.
   */
  annotationLayer: Pdfjs.AnnotationLayer | null;
  /** The page's structure tree, which labels the images among them. */
  structTree: StructTreeBuilder | null;
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
 * Other viewers of the document edit theirs beside them, in the same
 * annotation storage: saving and printing include them all.
 */
export interface AnnotationEditor {
  readonly state: AnnotationEditingState;
  readonly styles: AnnotationStyles;
  /** What the pages' annotation layers and drawings are built with. */
  readonly layerEditing: AnnotationLayerEditing;
  setTool(tool: AnnotationTool): Promise<void>;
  /** Restyle the selected annotations, or with none selected, the next ones `tool` creates. */
  setStyle<T extends keyof AnnotationStyles>(tool: T, style: Partial<AnnotationStyles[T]>): void;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  selectAll(): void;
  /**
   * Set the selected annotation's comment, or with null or "", remove it,
   * as one undo step; false when one annotation alone is not selected, or
   * it is text, which takes no comment.
   */
  setComment(comment: string | null): boolean;
  /**
   * Set the selected image's alternative text, as one undo step; false
   * when one image alone is not selected.
   */
  setAltText(altText: AnnotationAltText): boolean;
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
  /** Every annotation created, and those of the file changed, as data `import` takes. */
  export(): SavedAnnotation[];
  /**
   * Add annotations `export` gave, on mounted pages or not, without an undo
   * step; a changed annotation of the file takes its place.
   */
  import(annotations: readonly SavedAnnotation[]): Promise<number>;
  /** The view zoomed or turned. */
  setView(cssScale: number, rotation: Rotation): void;
  /** The page keyboard shortcuts and pasting act on. */
  setCurrentPage(pageIndex: number): void;
  renderLayer(elements: AnnotationLayerElements): AnnotationEditorLayerTask;
  /**
   * Ends editing. Its annotations, and its changes to the file's, leave the
   * document's storage, unless `keep`: they stay there, saved and printed
   * with the document as those of unmounted pages are, until the function
   * it returns removes them.
   */
  destroy(keep?: boolean): () => void;
}
