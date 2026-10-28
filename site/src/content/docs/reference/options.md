---
title: Options
description: The props PdfViewer takes, which set its viewer's view and options.
---

`PdfViewer`'s props set how its viewer shows the document. They are live:
change one and the viewer follows without a remount. Those the renderer is
built with (`textLayer`, `annotationLayer`, `externalLinks`, `pageColors`,
`maxConcurrentRenders`, and the budgets) rebuild the pages' layers and
canvases as a viewport that detaches and attaches again would, keeping the
position and the annotations; the others apply at once.

```tsx
<PdfViewer
  viewer={viewer}
  defaultZoom="fit-width"
  scrollMode={scrollMode}
  onScrollModeChange={setScrollMode}
  forms
/>
```

## View state

Each of these is either controlled, by its value and its change callback,
or left to the viewer, by its default. A controlled value is what the
viewer shows: it applies the value as it changes, reports every change of
its own, from the reader's gestures and keys or the viewer's methods,
through the callback, and returns to the value once React has rendered
without taking the change up. Defaults apply as the viewer opens a
document. Callbacks are called from the viewer's own store subscription:
they cost React nothing unless you set state in them.

| Prop | Default | |
|---|---|---|
| `zoom`, `defaultZoom`, `onZoomChange` | `"fit-width"` | A `Zoom`: a scale in CSS pixels per PDF point, `"fit-width"`, which keeps fitting the current page's width as the viewport resizes, or `"fit-page"`, which keeps fitting all of it. |
| `rotation`, `defaultRotation`, `onRotationChange` | `0` | The clockwise rotation of every page: `0`, `90`, `180`, or `270`. |
| `spread`, `defaultSpread`, `onSpreadChange` | `"none"` | `"odd"` or `"even"` shows pages in pairs (see [Scroll modes and spreads](/guides/layout/)). |
| `scrollMode`, `defaultScrollMode`, `onScrollModeChange` | `"vertical"` | `"horizontal"`, `"wrapped"`, or `"page"` arranges pages otherwise (see [Scroll modes and spreads](/guides/layout/)). |
| `tool`, `defaultTool`, `onToolChange` | `"select"` | What a mouse drag does: select text, or, with `"hand"`, scroll the document. |
| `defaultPage` | `0` | The zero-based page a document opens at, at the top of the viewport. |
| `onPageChange` | none | `(pageIndex) => void`: hears the current page change as the reader scrolls, follows a link, or `goToPage()` shows another. |

The current page is never controlled: `viewer.goToPage()` sets it.

## The opening

| Prop | Default | |
|---|---|---|
| `initialView` | `"options"` | `"document"` opens where and as the document asks: at its /OpenAction destination, with its zoom, its pages arranged as its /PageLayout says (see [Keeping the view](/guides/view-state/)). The page, zoom, spread, and scroll mode you set, controlled or by default, win. |
| `initialViewState` | none | A view kept from `getViewState()` to open with. Its fields win over the page, zoom, spread, and scroll mode you set and over `initialView`; those it leaves out still apply. |

Both apply once per document. A viewport that reattaches returns to where
it was instead.

## Layers on the page

| Prop | Default | |
|---|---|---|
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links, comment popups, and, with `forms`, form fields. |
| `forms` | `false` | Form fields as HTML the reader fills in, whose values `save()` writes into the document; needs `annotationLayer` (see [Forms](/guides/forms/)). Its code loads only when set. |
| `formScripts` | `false` | With `forms`, the document's scripts run in its fields: calculations, validation, formatting, and actions (see [Form scripts](/guides/forms/#form-scripts)). pdf.js's sandbox loads only for a document with scripts. |
| `annotationEditing` | `false` | Highlights, text, drawings, images, and signatures the reader creates (see [Annotations](/guides/annotations/)). Its code and styles load only when set. |
| `annotationLabels` | English | The accessible names of the annotation editor's controls, such as `{ removeInk: "線を削除" }`. |
| `pageColors` | none | `{ background, foreground }` to draw pages in two colors, for example `Canvas` and `CanvasText` in forced-colors mode. |

Set as the viewer opens a document, `forms` and `annotationEditing` make
its first layout wait for their code; set later, they attach to the open
document, and unset, they detach.

## Links and the document's wishes

| Prop | Default | |
|---|---|---|
| `destinationZoom` | `true` | `false` keeps the zoom when following links and the outline; they only scroll. |
| `direction` | the document's | `"rtl"` orders pages right to left, `"ltr"` left to right; unset, the document's `/ViewerPreferences /Direction` decides, and left to right where it says nothing (see [Right to left](/guides/layout/#right-to-left)). |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert; internal links and the outline keep working. |
| `openAttachment` | download | What opening a file attachment annotation or a link to an embedded file does: `({ filename, content }) => void`. |
| `enforcePermissions` | `false` | Follow what the document permits, as pdf.js does not by default (see [Permissions](/guides/permissions/)). |

## Layout and zoom

| Prop | Default | |
|---|---|---|
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |

## Memory and rendering

| Prop | Default | |
|---|---|---|
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas, the canvas area limit of iOS; larger pages are drawn sharp only around the visible area, still at full resolution. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size; `maxDetailPixels` still caps it. At 1 the detail holds just the viewport; below 1 the visible area loses resolution. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together. Pages outside the viewport give theirs back first, farthest first and detail before base; past the budget, visible pages lose their sharp margin and then resolution, in quarter-octave steps, but keep their low-resolution canvases, so a visible page never goes blank. |
| `maxKeptPixels` | twelve viewports | Pixels kept of the canvases of pages that leave the mounted window, so that a page the reader comes back to shows at once; the default is six viewports' worth of device pixels, and `0` keeps none. Within `maxCanvasPixels`, kept canvases count and go first. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |

`maxCanvasPixels` exists for browsers that cap all canvases together, as iOS
Safari does: past the cap, canvases there go blank. See [How it
works](/about/how-it-works/#memory).

## `PdfDocument`

`PdfDocument` takes `source`, `passwordPrompt`, and `children` alone (see
[Components](/reference/components/#pdfdocument)): everything about how
the document is shown belongs to its viewers.
