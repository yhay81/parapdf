export type { AttachmentHandler, PdfSession } from "./document/pdf-session.ts";
export type { DocumentState, LoadProgress } from "./document/registry.ts";
export type {
  DocumentPermissions,
  OutlineNode,
  PasswordReason,
  PdfAttachment,
  PdfComment,
  PdfInitialView,
  PdfMetadata,
  PdfPageLayout,
  PdfPageMode,
  PdfPageSelection,
  PdfSource,
} from "./document/session.ts";
export { getAttachmentContent, openAttachment } from "./features/attachments.ts";
export {
  type DownloadOptions,
  download,
  type SaveOptions,
  save,
} from "./features/download.ts";
export {
  type FormChange,
  type FormField,
  type FormFieldType,
  type FormValue,
  getFormFields,
  setFormValues,
} from "./features/forms/index.ts";
export type { InitialViewOptions } from "./features/initial-view.ts";
export { setLayerVisible } from "./features/layers.ts";
export { type Permission, permits } from "./features/permissions.ts";
export { type PrintOptions, print } from "./features/print/index.ts";
export type { SearchState } from "./features/search/index.ts";
export type { SearchMatch, SearchOptions, TextPosition } from "./features/search/text-search.ts";
export type { PdfRect, PdfSelection, SelectionAnchor } from "./features/selection.ts";
export {
  type DocumentText,
  getText,
  type LineBreaks,
  type PageTextContent,
  type TextOptions,
  type TextPoint,
} from "./features/text/index.ts";
export type { Destination } from "./pdfjs/destinations.ts";
export type { PageColors, Rotation } from "./pdfjs/draw.ts";
export type {
  AnnotationAltText,
  AnnotationEditingState,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
  AnnotationType,
  SavedAnnotation,
  SelectedAnnotation,
  SignatureInput,
} from "./pdfjs/editor-types.ts";
export { pdfjsVersion } from "./pdfjs/files.ts";
export type { PdfLayer } from "./pdfjs/layers.ts";
export {
  configurePdfjs,
  type PdfjsBuild,
  type PdfjsConfig,
  type PdfjsDocumentOptions,
  preloadPdfjs,
} from "./pdfjs/loader.ts";
export { type AnnotationControls, useAnnotations } from "./react/annotations.ts";
export { useDocumentState, useSession, useViewState } from "./react/context.ts";
export {
  useAttachments,
  useComments,
  useInitialView,
  useLayers,
  useMetadata,
  useOutline,
  usePageLabels,
} from "./react/data.ts";
export { useFormChange, useFormFields } from "./react/forms.ts";
export { type HistoryControls, useHistory } from "./react/history.ts";
export {
  type OutlineItemHelpers,
  PdfOutline,
  type PdfOutlineProps,
} from "./react/outline.ts";
export {
  PdfPageOverlay,
  type PdfPageOverlayProps,
  PdfPageOverlays,
  type PdfPageOverlaysProps,
} from "./react/overlays.ts";
export {
  PdfAnnotationEditor,
  type PdfAnnotationEditorProps,
} from "./react/PdfAnnotationEditor.tsx";
export { PdfAutoLinks, type PdfAutoLinksProps } from "./react/PdfAutoLinks.tsx";
export { PdfDocument, type PdfDocumentProps } from "./react/PdfDocument.tsx";
export { PdfForms, type PdfFormsProps } from "./react/PdfForms.tsx";
export { PdfPageRect, type PdfPageRectProps } from "./react/PdfPageRect.tsx";
export { PdfPermissions, type PdfPermissionsProps } from "./react/PdfPermissions.tsx";
export {
  PdfSelectionPopover,
  type PdfSelectionPopoverProps,
  type PopoverPlacement,
} from "./react/PdfSelectionPopover.tsx";
export { PdfThumbnail, type PdfThumbnailProps } from "./react/PdfThumbnail.tsx";
export { PdfThumbnails, type PdfThumbnailsProps } from "./react/PdfThumbnails.tsx";
export { PdfView, type PdfViewProps } from "./react/PdfView.tsx";
export { PdfViewer, type PdfViewerProps, type Zoom } from "./react/PdfViewer.tsx";
export { preloadDocument } from "./react/preload.ts";
export { type PrintControls, type PrintProgress, usePrint } from "./react/print.ts";
export { type SaveControls, useSave } from "./react/save.ts";
export { type SearchControls, useSearch } from "./react/search.ts";
export { useSelection } from "./react/selection.ts";
export type { ThumbnailItem } from "./react/thumbnails.ts";
export { useCreateViewer, useViewer } from "./react/viewer.ts";
export type { RenderStats } from "./render/renderer.ts";
export type {
  Direction,
  Layout,
  PdfPagePoint,
  ScrollMode,
  SpreadMode,
} from "./view/layout.ts";
export type { ViewerPosition } from "./view/navigation.ts";
export type { ShownView } from "./view/options.ts";
export type { FitMode, PointerTool, ViewerState, ZoomMode } from "./view/state.ts";
export type { ViewState } from "./view/view-state.ts";
export type { Viewer } from "./view/viewer.ts";
