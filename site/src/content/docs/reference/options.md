---
title: Options
description: The ViewerOptions that PdfDocument takes.
---

`<PdfDocument options={…}>` takes `ViewerOptions`. They are read when the
component mounts; give it a new `key` to change them.

## Opening

| Option | Default | |
|---|---|---|
| `initialScale` | `"fit-width"` | A scale in CSS pixels per point, `"fit-width"`, which keeps fitting the page width as the viewport resizes, or `"fit-page"`, which keeps fitting all of it. |
| `initialPage` | `0` | The zero-based page shown first. |
| `initialViewState` | none | A view kept from `getViewState()` to open with (see [Keeping the view](/guides/view-state/)). |
| `initialView` | `"options"` | `"document"` opens where and as the document asks (see [The document's initial view](/guides/view-state/#the-documents-initial-view)). |
| `spread` | `"none"` | `"odd"` or `"even"` shows pages in pairs (see [Spreads](/guides/layout/#spreads)). |
| `scrollMode` | `"vertical"` | `"horizontal"`, `"wrapped"`, or `"page"` arranges pages otherwise (see [Scroll modes](/guides/layout/)). |
| `initialTool` | `"select"` | `"hand"` makes a mouse drag scroll the document from the start. |
| `passwordPrompt` | `true` | `false` fails an encrypted document at once instead of waiting for a password (see [Encrypted documents](/guides/encrypted/)). |

## Layout and zoom

| Option | Default | |
|---|---|---|
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |

## Layers on the page

| Option | Default | |
|---|---|---|
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links, comment popups, and, with `forms`, form fields. |
| `forms` | `false` | Form fields the reader can fill in (see [Forms](/guides/forms/)). |
| `annotationEditing` | `false` | Highlights, text, drawings, images, and signatures the reader creates (see [Annotations](/guides/annotations/)). |
| `annotationLabels` | English | The accessible names of the annotation editor's controls, such as `{ removeInk: "線を削除" }`. |
| `pageColors` | none | `{ background, foreground }` to draw pages in two colors, for example `Canvas` and `CanvasText` in forced-colors mode. |

## Links and the document's wishes

| Option | Default | |
|---|---|---|
| `destinationZoom` | `true` | `false` keeps the zoom when following links and the outline. |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert. |
| `openAttachment` | download | What opening an embedded file does: `({ filename, content }) => void`. |
| `enforcePermissions` | `false` | Follow what the document permits (see [Permissions](/guides/permissions/)). |

## Memory and rendering

| Option | Default | |
|---|---|---|
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas; larger pages are drawn sharp only around the visible area. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together. Pages outside the viewport give theirs back first; past the budget, visible pages lose their sharp margin and then resolution, but keep their low-resolution canvases. A page drawn sharp again, after a zoom for example, keeps its old sharp canvas until the new one is complete when both fit, and shows its low-resolution one meanwhile when they do not. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |

`maxCanvasPixels` exists for browsers that cap all canvases together, as iOS
Safari does: past the cap, canvases there go blank. See [How it
works](/about/how-it-works/#memory).
