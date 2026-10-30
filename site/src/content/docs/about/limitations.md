---
title: Limitations
description: What ParaPDF does not do yet, and what has not been verified.
---

## Not supported yet

- Editing the annotations a PDF already holds other than text, drawings,
  highlights, and images: those stay as they are drawn.
- XFA forms.
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
  Firefox, and in Safari on macOS except their touch and network parts
  ([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/safari-macos.md)).
  Playwright's WebKit is not Safari, and real iOS and iPadOS devices are not
  verified yet ([#13](https://github.com/yhay81/parapdf/issues/13)).
- VoiceOver in Safari on macOS and NVDA in Firefox on Windows have been
  tried, with the gaps the [accessibility page](/about/accessibility/)
  lists; VoiceOver on iOS has not
  ([#32](https://github.com/yhay81/parapdf/issues/32)).
- Whether iOS Safari counts the canvases pages keep when they unmount
  (`maxKeptPixels`) toward its canvas memory cap is not verified; it needs a
  device.
- Safari gives pdf.js a preloaded download only once it has finished, so
  ParaPDF does not preload the PDF in Safari or other WebKit browsers. A
  page rendered on the server still preloads it there, since the server
  cannot tell the browser: a PDF that takes longer to download than pdf.js
  to load downloads twice in Safari.
- In Safari on iPadOS, a pinch that starts while a fling still scrolls does
  not reach the page; the next pinch zooms.

Found something else? [Open an
issue](https://github.com/yhay81/parapdf/issues/new/choose).
