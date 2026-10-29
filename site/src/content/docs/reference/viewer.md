---
title: Viewer
description: The methods and properties of the Viewer that useViewer returns.
---

`useViewer()` returns a `Viewer`: one viewport's controller and state, for
the life of the component that called it. Give it to a `PdfViewer` to show
the nearest `PdfDocument`'s document with it, and to the hooks and
functions that act through it. Its view state is in `viewer.store` and
[`useViewState()`](/reference/state/#view-state).

A viewer keeps its view and annotations while its `PdfViewer` unmounts, as
when a tab hides it, and shows the document again where it was when a
`PdfViewer` shows it again. It shows a `PdfDocument`'s document until that
`PdfDocument` unmounts or opens another source, until it is given to a
`PdfViewer` of another document, or until the component that created it
unmounts.

The methods below act on a document laid out in an attached viewport;
before that, they do nothing. The view a document opens with is
`PdfViewer`'s (see [Options](/reference/options/)).

## Pages and zoom

| Method | |
|---|---|
| `goToPage(index)` | Shows the zero-based page from its top: its row at the viewport's top, or, in `"horizontal"` mode, the page at its left; `"page"` mode shows its row. The page becomes current. |
| `nextPage()`, `previousPage()` | Move by a whole page, spread, or row of pages; `"page"` mode flips to it. |
| `zoomBy(factor)` | Multiplies the scale by `factor`. |
| `setScale(scale, anchor?)` | A scale in CSS pixels per point, keeping the point under `anchor` (viewport coordinates, the center by default) in place; or `"fit-width"`, which fits the current page's width and keeps fitting it as the viewport resizes or the view turns; `"fit-page"`, which fits all of that page; or `"auto"`, which fits a portrait page's width and all of a landscape page, never above 5/3, as pdf.js's viewer opens documents. |
| `resetScale()` | Back to the zoom the document opened with (`zoom` or `defaultZoom`), as Ctrl or ⌘ with 0 does. |
| `rotate(degrees?)` | Turns every page by `degrees`, a multiple of 90, clockwise when positive; 90 by default. |
| `setRotation(rotation)` | Shows every page turned clockwise by `0`, `90`, `180`, or `270` degrees. |
| `setSpread(spread)` | `"none"`, `"odd"`, or `"even"` (see [Scroll modes and spreads](/guides/layout/)); the current page stays in view, from its top. |
| `setScrollMode(mode)` | `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"`; the current page stays in view, from its top. |
| `setTool(tool)` | `"select"` or `"hand"`: what a mouse drag does. |

A `PdfViewer` that controls one of these values reports the change through
its callback and returns to its value unless you take the change up (see
[Options](/reference/options/#view-state)).

## Navigation and views

| Method | |
|---|---|
| `goToDestination(dest, signal?)` | Shows a named or explicit destination (pdf.js's `Destination`), with the zoom it asks for unless `destinationZoom` is false; resolves to false when it is invalid or null, or the optional `AbortSignal` aborts before it is resolved. The history feature keeps the position before a completed jump. |
| `show(view)` | Shows a `ShownView`: `rotation`, `spread`, `scrollMode`, `scale`, and a `target`, a page and a point of it in PDF points to put at the viewport's top-left corner. Fields left out keep the viewer's; a page out of range and a scale beyond the limits are clamped. `setViewState()` is built on it. |
| `revealRect(pageIndex, rect)` | Scrolls so that `rect` (`x`, `y`, `width`, `height` in PDF points from the page's unturned top-left corner) sits in the upper third of the viewport; the page becomes current. Search shows its matches this way. |
| `position()` | Where the viewer shows its document, as `{ pageIndex, x, y, current, scale, zoomMode }`: the page at the viewport's top-left corner and where that corner is as a share of the page, which survive zoom changes, with the current page and zoom; null without a layout. |
| `restorePosition(position)` | Shows a `position()` again, with its zoom; a fitted zoom fits the viewport as it is now. |

Back and forward are the history's: [`useHistory(viewer)`](/guides/navigation/).
Search, printing, saving, text, and the rest are functions that take the
viewer (see [Components and hooks](/reference/components/#functions)).

## State and the document

| Property | |
|---|---|
| `store` | The view state: `get()`, `subscribe(listener)`, and `store.hot` and `store.cold`, the parts that change while the reader scrolls or zooms and those that do not, published apart (see [State](/reference/state/#view-state)). |
| `session` | The open document's session, once it has loaded, else null: pdf.js's `proxy`, `pageCount`, the pages, and what features read from the document. |
| `permissions` | What the open document permits, everything when it is not encrypted; null until it has loaded. |
| `layers` | Which of the open document's layers show, once known. |
| `sourceName` | The file name the document's URL gives, which `download()` uses; null for bytes. |
| `scroller`, `content` | The scroll container and the element that holds the pages, while a viewport is attached. |
| `signal` | Aborted while no viewport is attached. |
| `workSignal` | What the viewer does for its open document stops with it: aborts when the document closes or the viewport detaches; null while no document is open. |
| `textLayer`, `annotationLayer`, `pageColors` | The options as `PdfViewer` set them. |

## Measuring

| Member | |
|---|---|
| `stats` | Render counters for the current document: `base`, `detail`, `trimmed` (canvases cleared to stay within `maxCanvasPixels`), `kept` (layers shown again from kept canvases), and the DOM layers built. |
| `keptPixels` | Pixels of the canvases kept from pages that left the mounted window (`maxKeptPixels`). |
| `firstPaintAt` | `performance.now()` when the first page first showed pixels, or null. |
| `hasPixels(index)` | Whether a page shows pixels. |
| `blankFraction()` | The share of the viewport covered by pages that show no pixels yet. |
| `sharpness()` | The resolution of the visible pages' pixels as a share of full device resolution, weighted by visible area: 1 is sharp everywhere, 0 blank. |

## Extending the viewer

Features are built on the same surface as ParaPDF's own: search, history,
forms, and annotation editing attach to a viewer through these, and the
viewer knows none of them by name.

| Member | |
|---|---|
| `extend(extension)` | Registers a `ViewerExtension` and returns the function that removes it. Its optional hooks hear the document about to be laid out (`prepare`) or ready (`ready`, with a signal that aborts when the document closes or the viewport detaches), a viewport attaching (`viewport`) or detaching (`detaching`), the document closing (`closed`), a page's text layer built or removed (`textLayer`), a page's annotation layer built or removed (`annotationLayer`), a link or outline jump about to happen (`jumping`), a named action the viewer does not handle (`namedAction`), and layers shown or hidden (`layersChanged`). Hooks for what already happened are called at once. |
| `defer(loading)` | Makes the next document's first layout wait for `loading`, a feature loading that changes how pages are drawn. |
| `renderer` | The renderer of the open document's pages, once it has loaded. Its per-page resolution diagnostic is `pageSharpness(index, area, needed)`, where `area` is in PDF points and `needed` is device pixels per PDF point. |
| `textLayers` | The text layers of the mounted pages that have one, by page. |
| `annotationLayers` | The annotation layers of the mounted pages that have one, by page. |
| `setFormLayers(enabled)` | Shows form fields as HTML in the annotation layers instead of drawing them; pages already drawn are drawn again. |
| `setAnnotationEditor(editor)` | Gives the pages an annotation editor's layers, or, with null, takes them down. |
| `claimPointer(claimed)` | While claimed, a mouse drag is a feature's, such as an annotation tool's, not the hand tool's. |
| `invalidateContent()` | What the pages show changed, such as form values: every page is drawn again. |
| `openFile({ filename, content })` | Opens an embedded file as activating its annotation does, by the `openAttachment` option or as a download. |
