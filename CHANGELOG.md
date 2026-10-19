# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

- `maxDetailViewports` caps one page's detail canvas at a multiple of the
  viewport's device pixels: the margin drawn sharp around the visible area
  then follows the viewport's size, small on a phone and large on a wide
  panel. `maxDetailPixels` still caps it.
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
