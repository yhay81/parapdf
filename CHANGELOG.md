# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

pdf.js comes with ParaPDF: `<PdfDocument source="/manual.pdf">` is all an
application writes. This changes the API.

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
