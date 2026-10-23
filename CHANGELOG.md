# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

- In `"page"` mode, a one-finger swipe turns the page on touch screens:
  to the left or up for the next page, to the right or down back. A zoomed
  page scrolls first and turns from its edge; short or slanted swipes,
  pinches, and annotation tools do not turn pages.
- `getViewState()` returns the view as a plain object (the page and point
  at the viewport's top-left corner, zoom, rotation, spread, and scroll
  mode), and `setViewState()` and the `initialViewState` option show it
  again, for reopening where the reader left off and for shared links.
- Links and the outline take the zoom their destination asks for, as in
  pdf.js: `XYZ` with a zoom factor, `Fit`, `FitH`, `FitV`, and `FitR`, whose
  rectangle fills the viewport. `destinationZoom: false` keeps the zoom, as
  before.
- `forward()` and `canGoForward` return to where `back()` left, and the
  `GoForward` action of a PDF's links calls it; `usePdfNavigation()` has
  both. `back()` and `forward()` also restore the zoom of the position they
  return to.
- `initialView: "document"` opens a document at its /OpenAction
  destination, with its zoom, and arranges its pages as its /PageLayout
  asks; options the application sets win. The state's `documentView`
  reports the destination, the layout, and the panel its /PageMode asks
  for.
- The state's `permissions` reports what an encrypted document permits.
  With `enforcePermissions: true`, the viewer follows it: without copying,
  text cannot be selected or copied; without printing, `print()` fails;
  without annotating, annotations cannot be created, and form fields need
  permission to fill forms.
- `getFormFields()` lists the document's form fields with their values,
  `setFormValues()` sets them by name, and `onFormChange()` and
  `usePdfFormChange()` hear each value the reader enters.
- Stop retrying a failed page render with the same parameters; another zoom,
  content change, or page remount can try again. A failed sharp render can
  still fall back to the page's base drawing, including after a layer
  change: the old detail stays until the new base is ready to replace it.
- Wait for image annotations and signatures to finish loading before
  `addImage()` and `addSignature()` report success, so they can be saved or
  exported immediately; an unreadable image returns `false`.
- Keep annotation tools in sync when an image fails to load, and cancel a
  pending image or signature insertion if the reader chooses another tool
  while it loads.
- Return `false` for empty or untraceable signatures without leaving an
  editor or undo step behind.
- Keep the reading position when the background page-size pass shrinks the
  layout, before the browser clamps the old scroll position.
- Preserve a pending password prompt when another viewer opens the same
  document or the viewer remounts before its document is released.
- Retry a shared document with a changed source password, including when
  its first password request has not arrived yet and with
  `passwordPrompt: false`.
- Stop an earlier print job when a new one replaces it, cancelling its
  active render and releasing its images and print styles.
- Preserve the specified coordinate of internal destinations on PDFs whose
  own rotation is 90 or 270 degrees, including `FitH`, `FitV`, and `XYZ`
  destinations with an unspecified coordinate.
- The README's links to the license and notices work on npm: they pointed at
  files the repository keeps only at the root.
- The documentation moves to https://parapdf.yhay81.com, guides with
  examples that run and a demo to open your own PDFs in; it is the
  package's homepage.
- Keep bundlers from inlining pdf.js's files as `data:` URLs, so
  applications need no `assetsInlineLimit` setting. Vite inlines files
  under 4 KB, which put 134 of the 168 CMaps and the 11 annotation icons
  into the bundle every viewer loads: in a Vite 8.3 build that configures
  nothing, the list of the files' URLs, split into a chunk of its own,
  weighed 146,001 bytes, 52,557 with gzip, and now weighs 17,793 and 3,143.
  Rsbuild 2 inlined the icons,
  and its main chunk drops from 116,969 to 111,403 bytes with gzip. webpack
  5 and Next.js 16 inlined nothing, and their URLs stay the same. The cost:
  a PDF that needs one of those 134 CMaps now waits for one more request,
  as it already did with webpack and Next.js.

## 0.4.0 — 2026-10-20

- Annotation editing, with `annotationEditing: true`, through pdf.js's
  editors: highlights of selected text and freehand, text, drawings, images
  (`addImage()`), and signatures typed, traced from an image, or drawn by the
  application (`addSignature()`). `setAnnotationTool()` chooses the tool and
  `setAnnotationStyle()` the colors, thicknesses, and font size;
  `undoAnnotation()`, `redoAnnotation()`, `deleteSelectedAnnotations()`, and
  `selectAllAnnotations()`; the state publishes `annotationTool`,
  `annotationState`, and `annotationStyles`. Pages build the layer of their
  annotations after the text layer, during idle periods, and pages that
  mount again show them without taking focus or adding undo steps. `save()`,
  `download()`, and `print()` include them; `exportAnnotations()` returns
  them as JSON-compatible data, and `importAnnotations()` adds them again,
  on pages that are not mounted too. `annotationLabels` names the editor's
  controls in the application's language. A viewer that edits annotations
  opens its own copy of the document.
- `getText()` reads the document's text from every page, mounted or not, as
  search reads it: whole, by pages, or between two points, such as a search
  match's or a selection's ends, with line breaks kept or joined as search
  joins them.
- `getSelection()` also returns where the selection starts and ends in the
  document's text (`start`, `end`), for `getText()`.

## 0.3.1 — 2026-10-20

- In `"page"` mode, a key pressed right after a flip flips from the row
  shown: it flipped from the current page, which follows the row a frame
  later, and so could show the same row again.
- In `"page"` mode, → and ↓ flip a row wider or taller than the viewport
  once it is scrolled to its edge where scrollbars take space, as in
  Chromium on Linux: the far edge was taken as the scroll size less the
  client size, which the stable scrollbar gutter puts 15 px past where the
  browser stops, so those keys never flipped.
- A thumbnail keeps one size whether it is copied from its page's drawing
  or drawn: a drawn one came out a pixel shorter, rounded down as pdf.js
  sizes a render where the copy rounded to the nearest pixel.

## 0.3.0 — 2026-10-20

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
- pdf.js's legacy build comes with its own worker from the package:
  `configurePdfjs({ build: legacyBuild })`, with `legacyBuild` from the new
  `parapdf/legacy`, needs no `workerSrc`, `assetBase`, or copy of the files.
  Only builds that import `parapdf/legacy` emit its worker; they still emit
  the modern one too.
- `pdfjsVersion` is the version of pdf.js the package ships.
- `usePdfDocument()` returns pdf.js's `PDFDocumentProxy`, and
  `pdfjsDocumentOf()` is gone.
- Components that render `PdfDocument` need no browser-only wrapper such as
  `next/dynamic`: pdf.js loads only in the browser, and out of the bundle
  that renders the page.
- Form fields the reader can fill in, with `forms: true`, through pdf.js's
  annotation layer; `save()` returns the PDF with the values written in, and
  `download()` hands it to the browser.
- Comment popups show, styled as in pdf.js's viewer: they used to open as
  unstyled, transparent text. Comments without an appearance of their own
  show pdf.js's icons, which the package ships, or the ones under
  `configurePdfjs({ imageResourcesPath })` or `${assetBase}web/images/`:
  they used to request a file from the application's own origin.
- `print()` draws every page for printing, typed form values and the layers
  the viewer shows included, and opens the print dialog with only those
  pages.
- `PdfThumbnail`, drawn after the pages in view and from their drawing when
  the viewer has one; only thumbnails near view hold pixels.
- Encrypted documents: `status` is `"password"` until `submitPassword()`
  gets the right one, and `passwordReason` says whether the last one was
  wrong. They used to fail with `status` `"error"`: applications that show
  no password prompt pass `passwordPrompt: false` to keep that. Sources
  take a `password`, which `PdfDocument` tries again when it changes, and
  URL sources `httpHeaders` and `withCredentials`.
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
- After a zoom, each page shows its old drawing, scaled, until the new one is
  complete, as pdf.js's own viewer does: `PdfViewport` gives each page a
  second sharp canvas to draw into. The sharp canvas used to be drawn again
  in place, and the page showed white while pdf.js drew it: for 80–175 ms
  after each zoom in Safari in the iPadOS simulator, and for a few frames
  after nine of ten kinds of zoom in Chromium, WebKit, and Firefox. Hidden
  while drawn, as the item above says, it left the page to its
  low-resolution canvas for as many frames, and for 100–130 ms in the
  simulator. Now neither shows. Zooms draw half as many low-resolution
  canvases, and the pages in view are sharp sooner: after 3–36 ms instead of
  11–173 in Chromium, 4–36 instead of 12–150 in WebKit, and 4–90 instead of
  29–102 in Firefox. But a zoom holds the old and the new sharp canvases
  while the new ones are drawn: up to 28 MiB more canvas memory at its peak.
  With `maxCanvasPixels`, a page whose new sharp canvas does not fit beside
  the old one shows its low-resolution canvas meanwhile, as before.
- In Chromium, pages no longer show black after the view turns until they
  are drawn again: Chromium paints a canvas with pdf.js's opaque context
  black over its whole box once its size is zero, and the canvases a page
  gives back are now hidden too.
- A two-finger drag only scrolls, however fast it moves and however the
  fingers sit. The distance between the touches was measured at each
  finger's move, against where the other finger had been a frame before,
  so a drag zoomed once one frame's movement changed it by 16 CSS pixels:
  with one finger above the other, at about one pixel per millisecond.
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
