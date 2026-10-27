---
title: Limitations
description: What ParaPDF does not do yet, and what has not been verified.
---

## Not supported yet

- Editing the annotations a PDF already holds other than text, drawings,
  highlights, and images: those stay as they are drawn.
- Comments on created annotations, and pdf.js's alt text dialog: images take
  their alternative text from `addImage()`.
- Form scripts (calculations, validation, and button actions), and XFA forms.
- Right-to-left page order (`/ViewerPreferences /Direction`).
- Text layers for pages outside the mounted window, so the browser's own find
  and assistive technology see only mounted pages; use `useSearch()` and
  `getText()` for the whole document.
- A highlight fallback for browsers without the CSS Custom Highlight API,
  which find and scroll to matches without painting them.
- Seeing other viewers' annotations while they edit. Viewers of one
  document that edit annotations each show those they created; `save()` and
  `print()` from any of them include every viewer's.
- A controlled current page: `onPageChange` reports it and
  `viewer.goToPage()` sets it.

## Drawing on the main thread

Released pdfjs-dist draws pages on the main thread; its worker parses.
Drawing in a worker needs pdf.js's renderer worker
(`configurePdfjs({ rendererSrc })`), which is only in unreleased pdf.js
builds so far.

## Not verified yet

- The functional checks run in Playwright's builds of Chromium, WebKit, and
  Firefox; 0.4 was also tried by hand in Safari in the iPadOS simulator.
  Playwright's WebKit is not Safari: Safari on macOS and real iOS and iPadOS
  devices are not verified yet
  ([#13](https://github.com/yhay81/parapdf/issues/13)).
- No screen reader has been tried. The checks inspect what the page exposes
  to assistive technology (text language, accessible names, the tagged
  structure), not what VoiceOver, NVDA, or another reader announces as a
  reader moves through the pages
  ([#32](https://github.com/yhay81/parapdf/issues/32)).
- Whether iOS Safari counts the canvases pages keep when they unmount
  (`maxKeptPixels`) toward its canvas memory cap is not verified; it needs a
  device.
- Chromium and Firefox give pdf.js the PDF's preloaded download. Whether
  Safari does is not verified; where a browser does not, the PDF downloads
  twice.
- In Safari on iPadOS, a pinch that starts while a fling still scrolls does
  not reach the page; the next pinch zooms.

Found something else? [Open an
issue](https://github.com/yhay81/parapdf/issues/new/choose).
