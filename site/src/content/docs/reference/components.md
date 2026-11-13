---
title: Components and hooks
description: Everything the parapdf package exports.
---

## Components

### `PdfDocument`

Opens `source` as it renders, or joins the session another `PdfDocument`
opened of it, and renders its children at once, giving them its
`PdfSession` ([`useSession()`](/reference/state/#the-session)) and its
default `Viewer` ([`useViewer()`](/reference/viewer/)). Nothing
suspends before the first page draws. Every `PdfViewer` and `PdfThumbnails`
inside it shows its document. It holds the document while it is mounted and
shown: the document closes a second after no `PdfDocument` holds it any
more, and one React hides (`<Activity>`) and shows again opens it again.

| Prop | |
|---|---|
| `source` | The document: its URL, `{ url }`, `{ data }` with its bytes, or `{ range }` with a pdf.js transport (see [Sources](/reference/sources/)). It reopens when its URL, request headers, credentials mode, or password change or, for data and transports, when they are another object or the password changes; a new object for the same URL keeps the open document. A URL's fragment, such as `#page=3`, opens it where it points, and a new fragment moves its viewers there (see [Sources](/reference/sources/#sessions)). |
| `viewer` | A `Viewer` from `useCreateViewer()` to provide instead of creating one of its own. |
| `passwordPrompt` | `true` by default: an encrypted document waits for a password (status `"password"`), which `useSession().submitPassword()` gives. `false` fails it at once (status `"error"`) when the source has no password or a wrong one, for this `PdfDocument` only: others of the same document may still answer. Changing it does not open the document again. |
| `onOpenAttachment` | `({ filename, content }) => void`, called when the reader opens a file attachment annotation, a link to an embedded file, or `openAttachment(session, attachment)`. By default the browser downloads the file (see [Layers and attachments](/guides/layers-attachments/#attachments)). |
| `children` | Viewers, thumbnails, and your controls. |

### `PdfView`

Provides an independent `Viewer` scope inside a `PdfDocument`, for a split
view or another pane whose controls, thumbnails, and `PdfViewer` act
together without affecting sibling panes.

| Prop | |
|---|---|
| `viewer` | A `Viewer` from `useCreateViewer()` to provide instead of creating one of its own. |
| `ref` | Receives the scope's `Viewer`. |
| `children` | Controls, thumbnails, and a `PdfViewer` for this pane. |

### `PdfViewer`

One viewport onto the nearest `PdfDocument`'s document: the scroll
container, with only the pages near the viewport mounted. Give it a
definite height. It is focusable, so the browser's own keys scroll it.
Several `PdfViewer`s may show one document, each in its own `PdfView` or
with its own `viewer`. On a
tagged PDF, each viewer's reading order refers to its own text and form
fields.

Its props are the viewer's options and stay live: changing one needs no
remount (see [Options](/reference/options/)).

| Prop | |
|---|---|
| `viewer` | The `Viewer` to show the document with; by default, the viewer of the nearest `PdfView` or `PdfDocument`. |
| `ref` | Receives the `Viewer` shown. |
| View state | `zoom`, `rotation`, `spread`, `scrollMode`, and `tool`, each controlled with its `on…Change` callback or left to the viewer with its `default…`; `defaultPage` and `onPageChange` (see [Options](/reference/options/#view-state)). |
| The opening | `initialView` and `initialViewState` (see [Options](/reference/options/#the-opening)). |
| Live options | The layers, links, layout, zoom limits, and budgets (see [Options](/reference/options/)). |
| `className`, `style` | For the scroll container. |
| `label` | Its accessible name, "PDF document" by default. |
| `pageLabel` | Each page's accessible name, `(pageNumber, pageCount) => string`, "Page 3 of 12" by default. |
| `onPageClick` | `(point: PdfPagePoint, event) => void`, called when the reader clicks a shown page (ignoring drags, non-collapsed text selections, interactive controls, and claimed pointers) with `{ pageIndex, x, y }` in unturned PDF points (see [Text, selections, and overlays](/guides/text/)). |
| `children` | Feature components (`PdfForms`, `PdfAnnotationEditor`, `PdfAutoLinks`, `PdfPermissions`), overlays (`PdfPageOverlay`, `PdfPageOverlays`), and selection popovers (`PdfSelectionPopover`) mounted for this viewer. |

### `PdfForms`

Shows form fields as interactive HTML that the reader can fill in, and
optionally runs the document's form scripts in pdf.js's QuickJS WebAssembly
sandbox (see [Forms, printing, and saving](/guides/forms/)). Needs
`annotationLayer` on `PdfViewer`.

| Prop | |
|---|---|
| `viewer` | The viewer whose form fields become interactive; by default, `useViewer()`. |
| `scripts` | `false` by default; `true` runs calculations, validation, formatting, and button actions. |
| `onChange` | `(change: FormChange) => void`, called with `{ name, value }` as the reader types or a script changes a field. |

### `PdfAnnotationEditor`

Enables annotation editing on the viewer's pages (`useAnnotations()`), and
renders the editor's stylesheet synchronously (`<style precedence="parapdf">`;
see [Annotations](/guides/annotations/)).

| Prop | |
|---|---|
| `viewer` | The viewer whose pages edit annotations; by default, `useViewer()`. |
| `labels` | Accessible names of the editor's controls (`Partial<AnnotationLabels>`), English by default. |
| `tool`, `defaultTool`, `onToolChange` | Controlled or initial annotation tool (`"none"`, `"highlight"`, `"freetext"`, `"ink"`, `"stamp"`, `"signature"`). |

### `PdfAutoLinks`

Turns URLs and e-mail addresses in the viewer's pages' text into links of
their annotation layers, leaving out those the file already links (see
[Addresses in the text](/guides/navigation/#addresses-in-the-text)). Needs
`textLayer` and `annotationLayer` on `PdfViewer`, and follows `externalLinks`.

| Prop | |
|---|---|
| `viewer` | The viewer whose text addresses become links; by default, `useViewer()`. |

### `PdfPermissions`

Follows what the viewer's document permits: copying, printing, annotating,
and filling form fields (see [Permissions](/guides/permissions/)).

| Prop | |
|---|---|
| `viewer` | The viewer whose document permissions are enforced; by default, `useViewer()`. |

### `PdfThumbnails`

The pages of a viewer's document as a window-virtualized navigation list of
buttons, each with a thumbnail and the page's label (from the PDF's `pageLabels`
once read, without suspending, or its one-based number), its current page marked
with `aria-current="page"` and scrolled into view. Only items near the visible
part of the list's scroll container mount in the DOM and hold pixels, drawing at
a lower priority than the viewer's pages and following the viewer's rotation
(see [Thumbnails](/guides/thumbnails/)).

| Prop | |
|---|---|
| `id` | Optional DOM id on the `<nav>` landmark (for `aria-controls`). |
| `viewer` | The viewer whose document the thumbnails show and whose current page they mark; by default, the viewer of the nearest `PdfView` or `PdfDocument`. |
| `width` | Each thumbnail's width in CSS pixels, 120 by default. |
| `onSelect` | `(pageIndex) => void`, called with the page chosen; by default the viewer goes to it. |
| `label` | The list's accessible name, "Page thumbnails" by default. |
| `pageLabel` | Each button's accessible name, `(pageNumber, pageCount, label) => string`; `"Page iv"` when the PDF defines page labels, or `"Page 3 of 12"` when it does not. |
| `children` | `(item: ThumbnailItem) => ReactNode`, rendering custom contents inside each mounted `<li>` while keeping virtualization, page labels, and current-page auto-scroll. |
| `className`, `style` | For the list's `<nav>` element. |

The active thumbnail stays visible after the list measures its items, when
`width` changes, and when pages rotate. If PDF page labels cannot be read,
page numbers remain available.

### `PdfThumbnail`

One thumbnail, for lists of your own: a canvas drawn once it comes near
the visible part of its scroll container and released once it leaves. It
is a picture only, hidden from assistive technology: wrap it in a button or
link labelled with the page, as `PdfThumbnails` does.

| Prop | |
|---|---|
| `viewer` | The viewer whose document, rotation, and drawing slots it uses; by default, the viewer of the nearest `PdfView` or `PdfDocument`. |
| `pageIndex` | The zero-based page. |
| `width` | Width in CSS pixels; the height follows the page's shape as the view turns it. |
| `className`, `style` | For the canvas. |

### `PdfOutline`

The document's outline (bookmarks) as a nested `<nav><ol>…</ol></nav>`, reading
`useOutline()` (render it under a `<Suspense>` boundary apart from `PdfViewer`),
jumping internal destinations through `viewer.goToDestination(item.dest)`,
applying the PDF's `bold` and `italic` flags, following `viewer.externalLinks`
(`"new-tab"` or `"disabled"`), and returning `null` when the document has no
outline (see [Links, outline, and navigation](/guides/navigation/)). The default
renderer provides expand/collapse buttons for nested branches, including
when `defaultExpanded={false}`.

| Prop | |
|---|---|
| `id` | Optional DOM id on the `<nav>` landmark (for `aria-controls`). |
| `viewer` | The viewer that internal outline entries jump through and whose `externalLinks` policy external URLs follow; by default, `useViewer()`. |
| `label` | The `<nav>` landmark's accessible name, `"Document outline"` by default. |
| `defaultExpanded` | Whether entries with nested children start expanded, `true` by default. |
| `onNavigate` | `(item: OutlineNode) => boolean \| Promise<boolean>`, overriding internal destination jumps. |
| `renderItem` | `(item: OutlineNode, helpers: OutlineItemHelpers) => ReactNode`, rendering custom `<li>` contents around `helpers.link`, `helpers.children`, and `helpers.toggle()`. |
| `className`, `style` | For the `<nav>` element. |

### `PdfPageOverlay`

Renders `children` through a portal into page `page`'s overlay layer above its
canvas and text while that page is in the viewer's mounted window, and unmounts
them cleanly while off screen (see [Text, selections, and overlays](/guides/text/)).
Because it takes plain `ReactNode` `children` rather than a render callback,
Server Components can pass streamed JSX directly through it.

| Prop | |
|---|---|
| `page` | Zero-based page index this overlay renders onto while mounted. |
| `viewer` | The viewer whose page hosts the overlay; by default, `useViewer()`. |
| `children` | Overlay elements positioned with `PdfPageRect`. |

### `PdfPageOverlays`

Renders dynamic overlays across every mounted page of a viewer, evaluating
`children(pageIndex)` inside each page's memoized subtree so scrolling the
mounted window never re-evaluates overlays on pages that remain mounted.
Overlays stay visible under StrictMode and Activity; changing `viewer` moves
only that component's overlays and preserves others already in the target viewer.

| Prop | |
|---|---|
| `viewer` | The viewer whose mounted pages render these overlays; by default, `useViewer()`. |
| `children` | `(pageIndex: number) => ReactNode`, placed with `PdfPageRect`. |

### `PdfPageRect`

Positions its children over the page of the `PdfPageOverlay` or
`PdfPageOverlays` it is rendered in. Coordinates become percentages of the page
box, so zooming resizes the overlay through layout alone and never renders it
again. A point is 1/72 inch, including on pages that set a different PDF
user-space unit (`/UserUnit`). Rendered anywhere else, it throws.

| Prop | |
|---|---|
| `x`, `y`, `width`, `height` | The rectangle in PDF points from the page's top-left corner, unturned by the view. |
| `ref` | Receives the positioned `HTMLDivElement`, for anchoring popovers or tooltips. |
| `className`, `style`, `children` | |

### `PdfSelectionPopover`

Portals floating selection UI (such as a copy or highlight toolbar) to
`document.body` outside page `contain: "strict"` clipping, following scroll,
zoom previews, layout changes, and rotation imperatively without per-frame React
state commits, and keeping the browser's text selection intact when clicking
non-editable toolbar buttons inside it.

| Prop | |
|---|---|
| `viewer` | The viewer whose selection anchors the popover; by default, `useViewer()`. |
| `placement` | Preferred side, `"top"` (default) or `"bottom"`; flips automatically when viewport space is tighter on that side. |
| `offset` | Distance in CSS pixels from the selection, `8` by default. |
| `className`, `style` | For the popover container. |
| `children` | `(selection: PdfSelection) => ReactNode`; returning `null`, `undefined`, or `false` hides the popover. |

## Hooks

`useCreateViewer()` works anywhere; hooks that take an optional `viewer`
read the nearest `PdfView` or `PdfDocument` when none is passed, and work
outside them when given one; those that take none read the nearest
`PdfDocument`.

| Hook | Returns |
|---|---|
| `useViewer()` | The `Viewer` of the nearest `PdfView` or `PdfDocument` (see [Viewer](/reference/viewer/)). |
| `useCreateViewer()` | A `Viewer` for the life of the calling component, to pass to `PdfDocument`, `PdfView`, `PdfViewer`, and hooks outside their scope. It keeps its view and annotations while its `PdfViewer` unmounts and while React hides the calling component or the `PdfDocument` (`<Activity>`), and goes with the calling component. |
| `useViewState(viewer?)`, `useViewState(selector, viewer?)` | The viewer's `ViewerState`, tracking read fields when called without `selector` and comparing `selector`'s result shallowly otherwise, rendering again only when what it reads changes (see [State](/reference/state/#view-state)). |
| `useSession()` | The nearest `PdfDocument`'s `PdfSession` (see [State](/reference/state/#the-session)). |
| `useDocumentState()`, `useDocumentState(selector)` | The document's `DocumentState` (status, error, password request, progress, page count, permissions), tracking read fields when called without `selector` and comparing `selector`'s result shallowly otherwise (see [State](/reference/state/#document-state)). |
| `useOutline()` | The outline (bookmarks) as `OutlineNode`s: `title`, `dest`, `url`, `bold`, `italic`, and `items`; empty when the document has none. |
| `usePageLabels()` | Each page's label, such as `"iv"` or `"A-3"`; null when the document defines none. |
| `useMetadata()` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language, with the file name the server gives (`Content-Disposition`), the file's length, whether it is linearized (Fast Web View), and the fingerprint, which identifies the document for a view an application keeps; null when they cannot be read. |
| `useAttachments()` | The embedded files, empty when there are none (see [Layers and attachments](/guides/layers-attachments/)). |
| `useComments()` | The file's comments in page order, empty when there are none (see [Annotations](/guides/annotations/#the-files-comments)). |
| `useLayers()` | The layers (optional content) and which show, following `setLayerVisible()` in any viewer of the document. |
| `useFormFields()` | The form fields with their values as first read; `getFormFields()` reads them again (see [Forms](/guides/forms/)). |
| `useInitialView()` | How the document asks to be shown: its /OpenAction destination, /PageLayout, and /PageMode; null when it cannot be read (see [Keeping the view](/guides/view-state/)). |
| `useSave(session?)` | `{ save, download, saving }` for the nearest `PdfDocument`'s `PdfSession` (or `session`), with `saving` true while a save or download is running (see [Forms, printing, and saving](/guides/forms/)). |
| `usePrint(viewer?)` | `{ print, printing, progress, cancel }` for the viewer, tracking `{ done, total }` while pages render for printing and cancelling cleanly via `cancel()` or unmount (see [Forms, printing, and saving](/guides/forms/)). |
| `useSearch(viewer?)`, `useSearch(selector, viewer?)` | The viewer's search state with referentially stable `search(query, options)`, `next()`, `previous()`, and `clear()`, tracking read fields when called without `selector` and comparing `selector`'s result shallowly otherwise (see [Search](/guides/search/)). |
| `useHistory(viewer?)`, `useHistory(selector, viewer?)` | Referentially stable `back()` and `forward()` with `canGoBack` and `canGoForward` for the viewer's link and outline jumps, tracking read fields or comparing `selector`'s result shallowly (see [Navigation](/guides/navigation/)). |
| `useAnnotations(viewer?)` | The annotation tool, state, and styles with the methods that change them (`AnnotationControls`). Always non-null (`state` and `styles` are null until `PdfAnnotationEditor` starts editing), tracking read fields so components reading only methods never re-render on annotation changes (see [Annotations](/guides/annotations/)). |
| `useFormChange(listener, viewer?)` | Nothing: calls `listener` with `{ name, value }` for each value the reader enters into a form field, as they type. Needs `PdfForms`. |
| `useSelection(viewer?)` | The selection in the viewer (`text`, `pages`, `start`, `end`, and a virtual `anchor` whose `getBoundingClientRect()` follows scroll, zoom, and rotation), or null; it follows a drag at most once a frame (see [Text, selections, and overlays](/guides/text/)). |

The seven hooks of the document's data suspend until it is read: render
them under a `<Suspense>` boundary of your own, apart from the viewer. A
read that fails gives the empty value instead of throwing, and so does a
document that failed to open or waits for a password; once the password is
answered, the hooks suspend again and read it.

The document opens as `PdfDocument` renders, not once it has mounted, so
React may wait for these hooks where it mounts nothing meanwhile: the
boundary may be above the `PdfDocument`, and a `source` changed in a
transition (`startTransition`) keeps showing the document before it until
the next one's data is read. A document a render opened and no
`PdfDocument` came to hold, as when React abandons a transition for
another, closes ten seconds after it loaded.

## Functions

Document operations take the `PdfSession` from `useSession()` and work even
without a mounted `PdfViewer`; viewport operations take the `Viewer` from
`useViewer()`. Because the package has no side effects, unused functions are
tree-shaken out of your bundle.

| Function | |
|---|---|
| `save(session, options?)` | Resolves to the PDF's bytes with form values and every viewer's annotations written in; null while no document is ready. `pages` saves the pages chosen instead, as pdf.js's `extractPages()` takes them: of this document, of other documents' bytes, and images (see [Forms, printing, and saving](/guides/forms/)). |
| `download(session, options?)` | Saves as `save()` does, with `pages`, and hands the bytes to the browser as a download, named by default as the server names the file (`Content-Disposition`), or else after the document's URL, unless `filename` names it. |
| `getText(session, options?)` | Resolves to the document's text, all of it or between pages or points (`from`, `to`, `lineBreaks`, `signal`; see [Text](/guides/text/)). |
| `getFormFields(session)` | Resolves to every form field and its current value. |
| `setFormValues(session, values)` | Sets fields by name; resolves to the names it set. |
| `setLayerVisible(session, id, visible)` | Shows or hides a layer, in every viewer of the document. |
| `getAttachmentContent(session, id)` | Resolves to an embedded file's bytes, or null. |
| `openAttachment(session, attachment)` | Opens an embedded file as `PdfDocument`'s `onOpenAttachment` prop says, by default as a download. |
| `print(viewer, options?)` | Draws every page for printing and opens the browser's print dialog; `options` are `resolution` (150 dpi by default), `autoRotate` (true by default: a page whose orientation differs from the first page's prints turned to the sheet), `onProgress(done, total)`, and `signal`. Fails when `<PdfPermissions />` is mounted and the document forbids printing (see [Forms, printing, and saving](/guides/forms/)). |
| `permits(viewer, what)` | Whether the document permits `"print"`, `"copy"`, `"annotate"`, or `"fillForms"`; always true while `<PdfPermissions />` is not mounted. |

## pdf.js

| Export | |
|---|---|
| `configurePdfjs(config)` | Changes how pdf.js loads, before the first `PdfDocument` renders (see [Configuring pdf.js](/setup/pdfjs/)). |
| `preloadDocument(source)` | Starts loading pdf.js, preloading `source`'s URL (outside WebKit and header-carrying requests), and opening `source` in the shared document registry ahead of `PdfDocument` mounting (for example on route hover). |
| `preloadPdfjs()` | Starts loading pdf.js and its worker early without opening a document. |
| `pdfjsVersion` | The version of pdf.js the package ships. |
| `legacyBuild` | From `parapdf/legacy`: pdf.js's legacy build, for `configurePdfjs({ build })`. |

Every type the API uses is exported as well, such as `PdfViewerProps`,
`PdfViewProps`, `Zoom`, `Viewer`, `ViewerState`, `DocumentState`,
`PdfSession`, `ViewState`, `PdfSource`, `SearchMatch`, `FormField`, and
`SavedAnnotation`.
