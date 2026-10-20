# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

pdf.js comes with ParaPDF: `<PdfDocument source="/manual.pdf">` is all an
application writes. ParaPDF also gains what other React PDF viewers offer and
it lacked: forms, printing, thumbnails, encrypted documents, scroll modes,
and the rest of a document viewer. This changes the API: code that passed an
engine, or switches over `status` or `zoomMode`, needs changes.

- ParaPDF depends on pdfjs-dist 6.4.299 exactly, no longer as a peer, and
  ships its worker and the files it loads on demand: CMaps, the Symbol and
  ZapfDingbats fonts, the JPEG 2000 and JBIG2 decoders, and the ICC profile
  and decoder for CMYK colors. Vite, webpack, Rsbuild, and Next.js copy them
  to the build output; esbuild, Bun, and Parcel need a copy and
  `configurePdfjs({ assetBase })`.
- `PdfDocument` no longer takes `engine`, and `createPdfjsEngine`, the
  engine types, `isRenderCancelled`, and `RenderCancelledError` are no longer
  exported. The first `PdfDocument` loads pdf.js; `configurePdfjs()` sets
  what `createPdfjsEngine` took (`enableHWA`, `documentOptions`, another
  build with `pdfjs` and `workerSrc`, `assetBase`, `rendererSrc`), and
  `preloadPdfjs()` loads pdf.js before it is needed.
- `PdfDocument` starts downloading its PDF while it renders, on the server
  too, with a preload that pdf.js's request takes over, and the shipped
  worker starts while pdf.js's module still loads. With 100 ms added to
  every request and 20 Mbit/s in Chromium, page 1 showed 115–129 ms sooner
  than with 0.2.0 set up as its README said, and within 3–16 ms of 0.2.0
  with pdf.js in the main bundle and a preload written by hand.
- `source` takes a URL as a string.
- `usePdfDocument()` returns pdf.js's `PDFDocumentProxy`, and
  `pdfjsDocumentOf()` is gone.
- Components that render `PdfDocument` need no browser-only wrapper such as
  `next/dynamic`: pdf.js loads only in the browser, and out of the bundle
  that renders the page.
- Form fields the reader can fill in, with `forms: true`, through pdf.js's
  annotation layer; `save()` returns the PDF with the values written in, and
  `download()` hands it to the browser.
- Comment popups show, styled as in pdf.js's viewer: they used to open as
  unstyled, transparent text. Their icons come from `${assetBase}web/images/`,
  which the package's `pdfjs/` directory now holds, or from
  `configurePdfjs({ imageResourcesPath })`, and are transparent without
  either: they used to request a file from the application's own origin.
- `print()` draws every page for printing, typed form values and the layers
  the viewer shows included, and opens the print dialog with only those
  pages.
- `PdfThumbnail`, drawn after the pages in view and from their drawing when
  the viewer has one; only thumbnails near view hold pixels.
- Encrypted documents: `status` is `"password"` until `submitPassword()`
  gets the right one, and `passwordReason` says whether the last one was
  wrong. Sources take a `password`, which `PdfDocument` tries again when it
  changes, and URL sources `httpHeaders` and `withCredentials`.
- Load progress (`progress`), page labels (`pageLabels`), metadata
  (`metadata`), and attachments (`attachments`, `getAttachmentContent()`,
  `openAttachment()`, and the `openAttachment` option, which also handles
  file attachment annotations).
- Layers: `layers` and `setLayerVisible()`, per viewer, which links that
  switch layers use too.
- Two-page spreads (`spread`, `setSpread()`), "fit-page" zoom, `resetScale()`,
  Ctrl or ⌘ with +, -, and 0 in the viewport, `initialPage`, and a hand tool
  (`tool`, `setTool()`, `initialTool`).
- Scroll modes, as in pdf.js (`scrollMode`, `setScrollMode()`): pages in a
  column (`"vertical"`, as before), in one row scrolled sideways
  (`"horizontal"`), in rows filling the viewport's width (`"wrapped"`), or
  one page or spread at a time (`"page"`). In `"page"` mode, `goToPage()`,
  links, search, and the keys that would scroll past the page's edge flip
  pages, and a zoomed page scrolls within itself. Spreads work in every mode.
- `nextPage()` and `previousPage()` go to the next or previous spread or
  row; links with the NextPage and PrevPage actions do the same.
- The current page stays current while all of it is in view, as in pdf.js,
  and `goToPage()`, links, `back()`, and search make the page they show
  current: at the start of a row of pages narrower than half the viewport,
  or of pages shorter than half of it, the page at the viewport's center was
  the second or third. Pages taller than the viewport, as at "fit-width",
  change pages at the center as before.
- Search options: `caseSensitive`, `entireWord`, and `matchDiacritics`.
- `getSelection()` and `usePdfSelection()`: the selected text and the
  rectangles it covers in PDF points, for highlights of your own.
- A tagged PDF's structure gives text layers their headings, lists, tables,
  and figures' alternative text for assistive technology, as in pdf.js's
  viewer.
- `pageColors` draws pages in two colors, for forced-colors mode.
- A canvas stays hidden while it is drawn again: with pdf.js's renderer
  worker (`rendererSrc`), a redraw used to show black until the worker's
  first frame arrived, over the low-resolution page or in its place.
- `ViewerState.status` has the new value `"password"`, and `ZoomMode`
  `"fit-page"`. `Layout` describes rows: `rowTops`, `rowWidths`,
  `rowHeights`, `rowFirst`, `rowLast`, `offsets`, `spread`, `scrollMode`,
  and, in `"page"` mode, the row `shown`. In `"horizontal"` and `"page"`
  mode, `tops` are before a row is centered in the viewport's height.

## 0.2.0 — 2026-10-20

Canvas budgets that an embedding app can hold to: the sharp margin follows
the viewport, and the budget counts visible pages. Two behaviors change:
`maxCanvasPixels` now limits visible pages too, and pdf.js draws on
GPU-backed canvases unless `enableHWA` is `false`.

- The pages a zoom gesture's preview brings into view, by a two-finger drag
  or by zooming out, mount and draw before the gesture commits: a long
  two-finger drag at a low zoom showed a blank band below the mounted pages
  until the fingers lifted.
- `maxDetailViewports` caps one page's detail canvas at a multiple of the
  viewport's device pixels: the margin drawn sharp around the visible area
  then follows the viewport's size, small on a phone and large on a wide
  panel. `maxDetailPixels` still caps it.
- `maxCanvasPixels` counts visible pages too: their low-resolution canvases
  always stay, and each one's sharp canvas gets a share of what they leave,
  by visible area, losing its margin first and then resolution. Visible pages
  used to keep all the detail `maxDetailPixels` allowed, whatever the budget,
  and only pages outside the viewport gave pixels back.
- `createPdfjsEngine` asks pdf.js for GPU-backed canvases unless
  `enableHWA` is `false`. It used to leave pdf.js's default, CPU-backed
  canvases.
- A detail canvas without a margin around the visible area, which a
  `maxDetailPixels` below the viewport's device pixels leaves, is drawn once:
  it was drawn again about 60 times a second while the view stood still.

## 0.1.0 — 2026-10-20

The first release, from Phase 0 of the project: the API is experimental.

- `PdfDocument`, `PdfViewport`, and `PdfPageRect`, with the hooks
  `usePdfViewer`, `usePdfState`, `usePdfSearch`, `usePdfNavigation`,
  `usePdfOutline`, and `usePdfDocument`, on a pdf.js engine from
  `createPdfjsEngine`.
- Continuous scrolling over a window of mounted pages: React renders only
  when that window or the current page changes, never per frame.
- Two canvases per page, a low-resolution base first and full device
  resolution once scrolling settles; at high zoom, full resolution only
  around the visible area. `maxDetailPixels`, `maxBasePixels`, and
  `maxCanvasPixels` bound canvas memory.
- Zoom to 10 CSS pixels per point with `setScale` and `zoomBy`, "fit-width"
  that follows resizes and turns, Ctrl or ⌘ with the wheel, trackpad and
  touch pinches, and Safari's gesture events. Rotation in quarter turns.
- pdf.js text layers for selection, drags across and beside pages included,
  and for screen readers, in the PDF's language. Whole-document search with
  the normalization of pdf.js's find controller, painted with the CSS Custom
  Highlight API.
- Internal links, named actions, and the outline, with a back stack;
  external links open in a new tab or, with `externalLinks: "disabled"`,
  stay inert.
- Overlays placed in PDF points with `PdfPageRect`.
- Viewers of the same URL or bytes share one loaded document, which survives
  React's StrictMode and quick remounts.
- `"use client"` directives; the components render on the server.
- `pdfjsDocumentOf()` for pdf.js's own `PDFDocumentProxy`.

Not yet supported: form filling, tagged-PDF structure, optional content
toggles, attachments, per-document passwords, and drawing off the main thread
with released pdfjs-dist. Gestures were checked by hand in Safari in the
iPadOS simulator; Safari on macOS and real iOS and iPadOS devices are not
verified yet.
