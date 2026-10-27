export type { PdfSession } from "./document/pdf-session.ts";
export type { DocumentState, LoadProgress } from "./document/registry.ts";
export type {
  OutlineNode,
  PasswordReason,
  PdfAttachment,
  PdfInitialView,
  PdfMetadata,
  PdfPageLayout,
  PdfPageMode,
  PdfPermissions,
  PdfSource,
} from "./document/session.ts";
export type {
  AnnotationEditing,
  AnnotationEditingOptions,
  AnnotationEditingStore,
} from "./features/annotations.ts";
export { getAttachmentContent, openAttachment } from "./features/attachments.ts";
export { download, save } from "./features/download.ts";
export {
  type FormChange,
  type FormField,
  type FormFieldType,
  type FormValue,
  getFormFields,
  setFormValues,
} from "./features/forms/index.ts";
export type { FormLayers } from "./features/forms/layers.ts";
export {
  attachHistory,
  type History,
  type HistoryState,
  historyOf,
} from "./features/history.ts";
export type { InitialViewOptions } from "./features/initial-view.ts";
export { setLayerVisible } from "./features/layers.ts";
export { enforcePermissions, type Permission, permits } from "./features/permissions.ts";
export { type PrintOptions, print } from "./features/print/index.ts";
export {
  attachSearch,
  type Search,
  type SearchState,
  searchOf,
} from "./features/search/index.ts";
export type { SearchMatch, SearchOptions, TextPosition } from "./features/search/text-search.ts";
export { getSelection, type PdfRect, type PdfSelection } from "./features/selection.ts";
export {
  type DocumentText,
  getText,
  type LineBreaks,
  type PageTextContent,
  type TextOptions,
  type TextPoint,
} from "./features/text/index.ts";
export { attachThumbnail } from "./features/thumbnails/index.ts";
export { getViewState, setViewState, type ViewState } from "./features/view-state.ts";
export type { Destination } from "./pdfjs/destinations.ts";
export type { PageColors, Rotation } from "./pdfjs/draw.ts";
export type {
  AnnotationEditingState,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
  AnnotationType,
  SavedAnnotation,
  SignatureInput,
} from "./pdfjs/editor.ts";
export { pdfjsVersion } from "./pdfjs/files.ts";
export type { PdfLayer } from "./pdfjs/layers.ts";
export {
  configurePdfjs,
  type PdfjsBuild,
  type PdfjsConfig,
  type PdfjsDocumentOptions,
  preloadPdfjs,
} from "./pdfjs/loader.ts";
export {
  type AnnotationControls,
  useAnnotationEditing,
  useAnnotations,
} from "./react/annotations.ts";
export { useDocumentState, useSession, useViewState } from "./react/context.ts";
export {
  useAttachments,
  useInitialView,
  useLayers,
  useMetadata,
  useOutline,
  usePageLabels,
} from "./react/data.ts";
export { useViewer } from "./react/features.ts";
export { useFormChange, useFormFields } from "./react/forms.ts";
export { type HistoryControls, useHistory } from "./react/history.ts";
export { PdfDocument, type PdfDocumentProps } from "./react/PdfDocument.tsx";
export { PdfPageRect, type PdfPageRectProps } from "./react/PdfPageRect.tsx";
export { PdfThumbnail, type PdfThumbnailProps } from "./react/PdfThumbnail.tsx";
export { PdfThumbnails, type PdfThumbnailsProps } from "./react/PdfThumbnails.tsx";
export { PdfViewer, type PdfViewerProps, type Zoom } from "./react/PdfViewer.tsx";
export { type SearchControls, useSearch } from "./react/search.ts";
export { useSelection } from "./react/selection.ts";
export type { RenderStats } from "./render/renderer.ts";
export type { ViewerExtension } from "./view/extensions.ts";
export type { Direction, Layout, ScrollMode, SpreadMode } from "./view/layout.ts";
export type { ViewerPosition } from "./view/navigation.ts";
export type { Opening, ShownView } from "./view/options.ts";
export type { PointerTool, ViewerState, ZoomMode } from "./view/state.ts";
export type { Viewer } from "./view/viewer.ts";
