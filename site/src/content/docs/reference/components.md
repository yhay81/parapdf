---
title: Components and hooks
description: Everything the parapdf package exports.
---

## Components

### `PdfDocument`

Opens `source` and provides the viewer to its children.

| Prop | |
|---|---|
| `source` | The document: its URL, `{ url }`, or `{ data }` with its bytes (see [Sources](/reference/sources/)). It reopens when its URL, request headers, or password change or, for data, when the bytes are another object or the password changes; a new object for the same URL keeps the open document. |
| `options` | `ViewerOptions` (see [Options](/reference/options/)), read once, when the component mounts; give it a new `key` to change them. |
| `children` | The viewport and your controls. One `PdfViewport` per `PdfDocument`. |

### `PdfViewport`

The scroll container. Only the pages near the viewport are mounted. Give it a
definite height.

| Prop | |
|---|---|
| `className`, `style` | For the scroll container. |
| `label` | Its accessible name, "PDF document" by default. |
| `pageLabel` | Each page's accessible name, `(pageNumber, pageCount) => string`, "Page 3 of 12" by default. |
| `renderOverlay` | `(pageIndex) => ReactNode`, drawn over each mounted page and placed with `PdfPageRect` (see [Overlays](/guides/text/#overlays)). |

### `PdfThumbnail`

A small picture of a page, drawn once it comes near the visible part of its
scroll container and released once it leaves (see
[Thumbnails](/guides/thumbnails/)).

| Prop | |
|---|---|
| `pageIndex` | The zero-based page. |
| `width` | Width in CSS pixels; the height follows the page's shape as the view turns it. |
| `className`, `style` | For the thumbnail's element. |

### `PdfPageRect`

Positions its children over a page, inside `renderOverlay`. Coordinates
become percentages of the page box, so zooming resizes the overlay through
layout alone.

| Prop | |
|---|---|
| `pageIndex` | The zero-based page. |
| `x`, `y`, `width`, `height` | The rectangle in PDF points from the page's top-left corner, unturned by the view. |
| `style`, `children` | |

## Hooks

Call them in components inside `PdfDocument`.

| Hook | Returns |
|---|---|
| `usePdfViewer()` | The viewer runtime, whose methods change the view (see [Viewer](/reference/viewer/)). |
| `usePdfState(selector)` | The selected part of the viewer's state, re-rendering when it changes (see [State](/reference/state/)). |
| `usePdfSearch()` | The search's state with `search(query, options)`, `next()`, `previous()`, and `clear()` (see [Search](/guides/search/)). |
| `usePdfNavigation()` | `goToDestination()`, `back()`, `forward()`, `canGoBack`, and `canGoForward` (see [Navigation](/guides/navigation/)). |
| `usePdfOutline()` | The document outline, null while it loads. |
| `usePdfSelection()` | The selection in the viewer, in PDF points, or null (see [Selections](/guides/text/#selections)). |
| `usePdfFormChange(listener)` | Nothing: calls `listener` with `{ name, value }` for each value the reader enters in a form field. |
| `usePdfDocument()` | pdf.js's `PDFDocumentProxy` of the open document, or null (see [Sources](/reference/sources/#pdfjss-own-api)). |

## Functions and constants

| Export | |
|---|---|
| `configurePdfjs(config)` | Changes how pdf.js loads, before the first `PdfDocument` renders (see [Configuring pdf.js](/setup/pdfjs/)). |
| `preloadPdfjs()` | Starts loading pdf.js and its worker early. |
| `pdfjsVersion` | The version of pdf.js the package ships. |
| `legacyBuild` | From `parapdf/legacy`: pdf.js's legacy build, for `configurePdfjs({ build })`. |

Every type the API uses is exported as well, such as `ViewerOptions`,
`ViewerState`, `ViewState`, `PdfSource`, `SearchMatch`, `FormField`, and
`SavedAnnotation`.
