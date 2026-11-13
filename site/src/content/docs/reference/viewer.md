---
title: Viewer
description: The methods and properties of the Viewer that useViewer returns.
---

`useViewer()` returns the `Viewer` of the nearest `PdfView` or
`PdfDocument`: one viewport's imperative handle and snapshot. To hold a viewer
from above `PdfDocument` or across several `PdfView`s, pass a `ref` to
`PdfViewer` or `PdfView`, or create one with `useCreateViewer()` and pass it
as `viewer` to `PdfDocument`, `PdfView`, `PdfViewer`, and the hooks that
take an optional `viewer`. Components subscribe to its view state with
[`useViewState()`](/reference/state/#view-state), and event handlers read its
current snapshot from `viewer.state`.

A viewer keeps its view and annotations while its `PdfViewer` unmounts, as
when a tab hides it, and shows the document again where it was when a
`PdfViewer` shows it again. It shows a `PdfDocument`'s document until that
`PdfDocument` unmounts or opens another source, until it is given to a
`PdfViewer` of another document, or until its owner (`PdfDocument`,
`PdfView`, or the component that called `useCreateViewer()`) unmounts.

While React hides the `PdfDocument` or the viewer's owner and keeps their
state (`<Activity>`), the viewer lets go of the document and shows nothing:
`viewer.state.layout` is null. It keeps the view, the history, a finished
search, and the annotations, and shows them again with the document once React
shows both.

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
| `viewState()` | Where and how the document is shown, as a plain `ViewState` object to store or put in a URL, or null without a layout (see [Keeping the view](/guides/view-state/)). |
| `setViewState(view)` | Shows a `Partial<ViewState>` again; fields left out stay as they are, and values out of range are clamped or ignored. |
| `revealRect(pageIndex, rect)` | Scrolls so that `rect` (`x`, `y`, `width`, `height` in PDF points from the page's unturned top-left corner) sits in the upper third of the viewport; the page becomes current. Search shows its matches this way. |
| `pointAt(point)` | Maps a client coordinate (`{ clientX, clientY }`, such as a `MouseEvent` or `PointerEvent`) to `{ pageIndex, x, y }` in unturned PDF points from the page's top-left corner (`PdfPageRect`'s coordinates); returns `null` when outside the viewport or in the space between or beside pages. |
| `position()` | Where the viewer shows its document, as `{ pageIndex, x, y, current, scale, zoomMode }`: the page at the viewport's top-left corner and where that corner is as a share of the page, which survive zoom changes, with the current page and zoom; null without a layout. |
| `restorePosition(position)` | Shows a `position()` again, with its zoom; a fitted zoom fits the viewport as it is now. |

Back and forward are the history's: [`useHistory()`](/guides/navigation/).
Search, printing, saving, text, and the rest are hooks and functions (see
[Components and hooks](/reference/components/)).

## State and DOM

| Property | |
|---|---|
| `state` | The current `ViewerState` snapshot, for synchronous reads in event handlers and effects (use [`useViewState()`](/reference/state/#view-state) to re-render when it changes). |
| `scroller`, `content` | The scroll container and the element that holds the pages, while a viewport is attached. |
| `externalLinks` | `"new-tab"` or `"disabled"`, as `PdfViewer` set it (live across `PdfOutline`, `PdfAutoLinks`, and annotation layers). |

## Measuring

| Member | |
|---|---|
| `stats` | Render counters for the current document: `base`, `detail`, `trimmed` (canvases cleared to stay within `maxCanvasPixels`), `kept` (layers shown again from kept canvases), and the DOM layers built. |
| `keptPixels` | Pixels of the canvases kept from pages that left the mounted window (`maxKeptPixels`). |
| `firstPaintAt` | `performance.now()` when the first page first showed pixels, or null. |
| `hasPixels(index)` | Whether a page shows pixels. |
| `blankFraction()` | The share of the viewport covered by pages that show no pixels yet. |
| `sharpness()` | The resolution of the visible pages' pixels as a share of full device resolution, weighted by visible area: 1 is sharp everywhere, 0 blank. |
