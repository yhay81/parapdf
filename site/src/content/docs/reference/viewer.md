---
title: Viewer
description: The methods of the viewer runtime that usePdfViewer returns.
---

`usePdfViewer()` returns the viewer runtime (`PdfViewerRuntime`). Its
methods change the view; its state is in `viewer.store` and
[`usePdfState`](/reference/state/).

## Pages and zoom

| Method | |
|---|---|
| `goToPage(index)` | Shows the zero-based page. |
| `nextPage()`, `previousPage()` | Move by a whole spread or row. |
| `zoomBy(factor)` | Multiplies the scale by `factor`. |
| `setScale(scale)` | A scale in CSS pixels per point, `"fit-width"`, or `"fit-page"`. |
| `resetScale()` | Back to `initialScale`. |
| `rotate(degrees)`, `setRotation(rotation)` | Turn the view clockwise, in quarter turns. |
| `setSpread(spread)` | `"none"`, `"odd"`, or `"even"` (see [Spreads](/guides/layout/#spreads)). |
| `setScrollMode(mode)` | `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"` (see [Scroll modes](/guides/layout/)). |
| `setTool(tool)` | `"select"` or `"hand"`: what a mouse drag does. |

## Navigation and view states

| Method | |
|---|---|
| `goToDestination(dest)` | Shows a named or explicit destination, with its zoom unless `destinationZoom` is false; resolves to whether it found it. |
| `back()`, `forward()` | Return to the positions before and after link and outline jumps (see [Navigation](/guides/navigation/)). |
| `getViewState()` | Where and how the document is shown, as a plain object, or null before it is (see [Keeping the view](/guides/view-state/)). |
| `setViewState(view)` | Shows such a view again. |

## Search and text

| Method | |
|---|---|
| `search(query, options)`, `nextMatch()`, `previousMatch()`, `clearSearch()` | The search that `usePdfSearch()` wraps (see [Search](/guides/search/)). |
| `getText(options)` | Resolves to the document's text, all of it or between pages or points (see [Text](/guides/text/)). |
| `getSelection()` | The selection in the viewer, in PDF points, or null. |

## Forms, saving, and printing

| Method | |
|---|---|
| `save()` | Resolves to the PDF's bytes with form values and annotations written in. |
| `download(filename?)` | Hands those bytes to the browser as a download. |
| `print(options)` | Draws every page for printing and opens the print dialog (see [Forms, printing, and saving](/guides/forms/)). |
| `getFormFields()` | Resolves to every form field and its value. |
| `setFormValues(values)` | Sets fields by name; resolves to the names it set. |
| `onFormChange(listener)` | Hears each value the reader enters; returns the function that stops it. |

## Annotations

| Method | |
|---|---|
| `setAnnotationTool(tool)` | `"none"`, `"highlight"`, `"freetext"`, `"ink"`, `"stamp"`, or `"signature"`. |
| `setAnnotationStyle(tool, style)` | `color`, `thickness`, `opacity`, or `fontSize` of the selected annotations, or of the next ones. |
| `undoAnnotation()`, `redoAnnotation()` | |
| `deleteSelectedAnnotations()`, `selectAllAnnotations()` | |
| `addImage(image, options)`, `addSignature(signature, options)` | Add an image or a signature; resolve to whether it is ready. |
| `exportAnnotations()`, `importAnnotations(annotations)` | Keep the annotations apart from the PDF and add them again. |

See [Annotations](/guides/annotations/).

## The document

| Method | |
|---|---|
| `submitPassword(password)` | Answers a password request; null gives up (see [Encrypted documents](/guides/encrypted/)). |
| `setLayerVisible(id, visible)` | Shows or hides a layer (see [Layers and attachments](/guides/layers-attachments/)). |
| `getAttachmentContent(id)` | Resolves to an embedded file's bytes. |
| `openAttachment(attachment)` | Opens an embedded file as the `openAttachment` option says, by default as a download. |
