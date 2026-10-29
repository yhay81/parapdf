---
title: Components and hooks
description: Everything the parapdf package exports.
---

## Components

### `PdfDocument`

Opens `source`, or joins the session another `PdfDocument` opened of it,
and renders its children at once, giving them its `PdfSession`
([`useSession()`](/reference/state/#the-session)). Nothing suspends before
the first page draws. Every `PdfViewer` and `PdfThumbnails` inside it shows
its document; the document closes a second after no `PdfDocument` holds it
any more.

| Prop | |
|---|---|
| `source` | The document: its URL, `{ url }`, or `{ data }` with its bytes (see [Sources](/reference/sources/)). It reopens when its URL, request headers, credentials mode, or password change or, for data, when the bytes are another object or the password changes; a new object for the same URL keeps the open document. A URL's fragment, such as `#page=3`, opens it where it points, and a new fragment moves its viewers there (see [Sources](/reference/sources/#sessions)). |
| `passwordPrompt` | `true` by default: an encrypted document waits for a password (status `"password"`), which `useSession().submitPassword()` gives. `false` fails it at once (status `"error"`) when the source has no password or a wrong one, for this `PdfDocument` only: others of the same document may still answer. Changing it does not open the document again. |
| `children` | Viewers, thumbnails, and your controls. |

### `PdfViewer`

One viewport onto the nearest `PdfDocument`'s document: the scroll
container, with only the pages near the viewport mounted. Give it a
definite height. It is focusable, so the browser's own keys scroll it.
Several `PdfViewer`s may show one document, each with its own view.

Its props are the viewer's options and stay live: changing one needs no
remount (see [Options](/reference/options/)).

| Prop | |
|---|---|
| `viewer` | The viewer to show the document with, from `useViewer()`, for the hooks and functions that act through it; without it, `PdfViewer` uses one of its own, which goes when it unmounts. |
| View state | `zoom`, `rotation`, `spread`, `scrollMode`, and `tool`, each controlled with its `on…Change` callback or left to the viewer with its `default…`; `defaultPage` and `onPageChange` (see [Options](/reference/options/#view-state)). |
| The opening | `initialView` and `initialViewState` (see [Options](/reference/options/#the-opening)). |
| Live options | The layers, forms, annotation editing, links, permissions, layout, zoom limits, and budgets (see [Options](/reference/options/)). |
| `className`, `style` | For the scroll container. |
| `label` | Its accessible name, "PDF document" by default. |
| `pageLabel` | Each page's accessible name, `(pageNumber, pageCount) => string`, "Page 3 of 12" by default. |
| `renderOverlay` | `(pageIndex) => ReactNode`, drawn over each mounted page through a portal into a layer above its drawing and text, and placed with `PdfPageRect` (see [Text, selections, and overlays](/guides/text/)). |

### `PdfThumbnails`

The pages of a viewer's document as a navigation list of buttons, each with
a thumbnail and the page's number, its current page marked with
`aria-current="page"`. Thumbnails draw only near the visible part of the
list's scroll container, at a lower priority than the viewer's pages, and
follow the viewer's rotation (see [Thumbnails](/guides/thumbnails/)).

| Prop | |
|---|---|
| `viewer` | The viewer whose document the thumbnails show and whose current page they mark. Required. |
| `width` | Each thumbnail's width in CSS pixels, 120 by default. |
| `onSelect` | `(pageIndex) => void`, called with the page chosen; by default the viewer goes to it. |
| `label` | The list's accessible name, "Page thumbnails" by default. |
| `pageLabel` | Each button's accessible name, `(pageNumber, pageCount) => string`, "Page 3 of 12" by default. |
| `className`, `style` | For the list's `<nav>` element. |

### `PdfThumbnail`

One thumbnail, for lists of your own: a canvas drawn once it comes near
the visible part of its scroll container and released once it leaves. It
is a picture only, hidden from assistive technology: wrap it in a button or
link labelled with the page, as `PdfThumbnails` does.

| Prop | |
|---|---|
| `viewer` | The viewer whose document, rotation, and drawing slots it uses. Required. |
| `pageIndex` | The zero-based page. |
| `width` | Width in CSS pixels; the height follows the page's shape as the view turns it. |
| `className`, `style` | For the canvas. |

### `PdfPageRect`

Positions its children over the page of the overlay it is rendered in,
inside `renderOverlay`. Coordinates become percentages of the page box, so
zooming resizes the overlay through layout alone and never renders it
again. Rendered anywhere else, it throws.

| Prop | |
|---|---|
| `x`, `y`, `width`, `height` | The rectangle in PDF points from the page's top-left corner, unturned by the view. |
| `style`, `children` | |

## Hooks

`useViewer()` works anywhere; the others that take a viewer work anywhere
too, and those that take none read the nearest `PdfDocument`.

| Hook | Returns |
|---|---|
| `useViewer()` | A `Viewer` for the life of the calling component: give it to a `PdfViewer` and to the hooks and functions that act through it (see [Viewer](/reference/viewer/)). It keeps its view and annotations while its `PdfViewer` unmounts, and closes its document once the calling component unmounts. |
| `useViewState(viewer, selector)` | The selected part of the viewer's view state, rendering again only when it changes (see [State](/reference/state/#view-state)). |
| `useSession()` | The nearest `PdfDocument`'s `PdfSession` (see [State](/reference/state/#the-session)). |
| `useDocumentState(selector)` | The selected part of the document's state: status, error, password request, progress, page count, and permissions (see [State](/reference/state/#document-state)). |
| `useOutline()` | The outline (bookmarks), empty when the document has none. |
| `usePageLabels()` | Each page's label, such as `"iv"` or `"A-3"`; null when the document defines none. |
| `useMetadata()` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language, with the file name the server gives (`Content-Disposition`), the file's length, whether it is linearized (Fast Web View), and the fingerprint, which identifies the document for a view an application keeps; null when they cannot be read. |
| `useAttachments()` | The embedded files, empty when there are none (see [Layers and attachments](/guides/layers-attachments/)). |
| `useLayers()` | The layers (optional content) and which show, following `setLayerVisible()` in any viewer of the document. |
| `useFormFields()` | The form fields with their values as first read; `getFormFields()` reads them again (see [Forms](/guides/forms/)). |
| `useInitialView()` | How the document asks to be shown: its /OpenAction destination, /PageLayout, and /PageMode; null when it cannot be read (see [Keeping the view](/guides/view-state/)). |
| `useSearch(viewer)` | The viewer's search state with `search(query, options)`, `next()`, `previous()`, and `clear()` (see [Search](/guides/search/)). |
| `useHistory(viewer)` | `back()`, `forward()`, `canGoBack`, and `canGoForward` for the viewer's link and outline jumps (see [Navigation](/guides/navigation/)). |
| `useAnnotations(viewer)` | With `annotationEditing`, the annotation tool, state, and styles with the methods that change them; null until the editing code loads, and without the option (see [Annotations](/guides/annotations/)). |
| `useAnnotationEditing(viewer)` | The annotation editing feature itself, with its `store`; null as for `useAnnotations()`. |
| `useFormChange(viewer, listener)` | Nothing: calls `listener` with `{ name, value }` for each value the reader enters into a form field, as they type. Needs `forms`. |
| `useSelection(viewer)` | The selection in the viewer, its text and its rectangles in PDF points, or null; it follows a drag at most once a frame (see [Text, selections, and overlays](/guides/text/)). |

The seven hooks of the document's data suspend until it is read: render
them under a `<Suspense>` boundary of your own, apart from the viewer. A
read that fails gives the empty value instead of throwing.

## Functions

Each takes the viewer it acts through.

| Function | |
|---|---|
| `print(viewer, options?)` | Draws every page for printing and opens the browser's print dialog; `options` are `resolution` (150 dpi by default), `autoRotate` (true by default: a page whose orientation differs from the first page's prints turned to the sheet), `onProgress(done, total)`, and `signal`. Fails when the viewer follows permissions and the document forbids printing (see [Forms, printing, and saving](/guides/forms/)). |
| `save(viewer)` | Resolves to the PDF's bytes with form values and every viewer's annotations written in; null while no document is open. |
| `download(viewer, filename?)` | Saves as `save()` does and hands the bytes to the browser as a download, named by default as the server names the file (`Content-Disposition`), or else after the document's URL. |
| `getText(viewer, options?)` | Resolves to the document's text, all of it or between pages or points (`from`, `to`, `lineBreaks`, `signal`; see [Text](/guides/text/)). |
| `getSelection(viewer)` | The selection, as `useSelection()` gives it, or null. |
| `getViewState(viewer)` | Where and how the document is shown, as a plain object, or null before it is (see [Keeping the view](/guides/view-state/)). |
| `setViewState(viewer, view)` | Shows such a view again; the fields it leaves out stay as they are. |
| `getFormFields(viewer)` | Resolves to every form field and its current value. |
| `setFormValues(viewer, values)` | Sets fields by name; resolves to the names it set. |
| `setLayerVisible(viewer, id, visible)` | Shows or hides a layer, in every viewer of the document. |
| `getAttachmentContent(viewer, id)` | Resolves to an embedded file's bytes, or null. |
| `openAttachment(viewer, attachment)` | Opens an embedded file as the viewer's `openAttachment` option says, by default as a download. |
| `enforcePermissions(viewer)` | Follows what the viewer's documents permit, as the `enforcePermissions` prop does; returns the function that stops. |
| `permits(viewer, what)` | Whether the document permits `"print"`, `"copy"`, `"annotate"`, or `"fillForms"`; always true while the viewer does not follow permissions. |
| `searchOf(viewer)`, `historyOf(viewer)` | The viewer's own search and history, which `useSearch()` and `useHistory()` show, attached on first use. |
| `attachSearch(viewer)`, `attachHistory(viewer)` | A search or history of its own for the viewer; its `detach()` takes it off. |
| `attachThumbnail(viewer, pageIndex, canvas, width)` | Draws a thumbnail into a canvas of yours, as `PdfThumbnail` does; returns the function that releases it. |

## pdf.js

| Export | |
|---|---|
| `configurePdfjs(config)` | Changes how pdf.js loads, before the first `PdfDocument` renders (see [Configuring pdf.js](/setup/pdfjs/)). |
| `preloadPdfjs()` | Starts loading pdf.js and its worker early. |
| `pdfjsVersion` | The version of pdf.js the package ships. |
| `legacyBuild` | From `parapdf/legacy`: pdf.js's legacy build, for `configurePdfjs({ build })`. |

Every type the API uses is exported as well, such as `PdfViewerProps`,
`Zoom`, `Viewer`, `ViewerState`, `DocumentState`, `PdfSession`, `ViewState`,
`PdfSource`, `SearchMatch`, `FormField`, and `SavedAnnotation`.
