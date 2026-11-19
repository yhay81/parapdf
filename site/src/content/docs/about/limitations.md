---
title: Limitations
description: What ParaPDF does not plan to do, current scope limits, and what has not been verified yet.
---

## Not planned

- XFA forms: pdf.js supports XFA only in part and at high cost for the
  documents ParaPDF opens ([#8](https://github.com/yhay81/parapdf/issues/8)).
- A highlight fallback for browsers without the CSS Custom Highlight API: every
  supported browser implements it, and browsers without it still find and
  scroll to matches without painting them
  ([#11](https://github.com/yhay81/parapdf/issues/11)).
- DOM text layers for pages outside the mounted window, so the browser's own
  find, select-all, selections extending into unmounted pages, and assistive
  technology see only mounted pages; use `useSearch()`, `findText()`, and
  `getText()` for whole-document or multi-page text
  ([#10](https://github.com/yhay81/parapdf/issues/10)).

## Current scope

- Editing the annotations a PDF already holds other than text, drawings,
  highlights, and unlocked images: those stay as they are drawn.
- Seeing other viewers' annotations while they edit. Viewers of one
  document that edit annotations each show those they created; `useSave()`
  and `usePrint()` include every currently shown viewer's. An Activity-hidden
  viewer's edits return to the shared document when it is shown again.
- A controlled current page: `onPageChange` reports it and
  `viewer.goToPage()` sets it.

## Drawing on the main thread

pdf.js draws pages on the main thread by default. The optional drawing worker
can reduce stalls on text-heavy documents and increase them on scanned pages.
Enable it with `configurePdfjs({ rendererSrc: true })`.

## Not verified yet

- The functional checks run in Playwright's builds of Chromium, WebKit, and
  Firefox, and in Safari on macOS except their touch and network parts
  ([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/safari-macos.md)).
  Playwright's WebKit is not Safari, and real iOS and iPadOS devices are not
  verified yet ([#13](https://github.com/yhay81/parapdf/issues/13)).
- VoiceOver in Safari on macOS and NVDA in Firefox on Windows have been
  tried, with the gaps the [accessibility page](/about/accessibility/)
  lists; VoiceOver on iOS has not
  ([#13](https://github.com/yhay81/parapdf/issues/13)).
- Whether iOS Safari counts the canvases pages keep when they unmount
  (`maxKeptPixels`) toward its canvas memory cap is not verified; it needs a
  device ([#13](https://github.com/yhay81/parapdf/issues/13)).
- Safari gives pdf.js a preloaded download only once it has finished, so
  ParaPDF does not preload the PDF in Safari or other WebKit browsers. A
  page rendered on the server still preloads it there, since the server
  cannot tell the browser: a PDF that takes longer to download than pdf.js
  to load downloads twice in Safari.
- In Safari on iPadOS, a pinch that starts while a fling still scrolls does
  not reach the page; the next pinch zooms
  ([#15](https://github.com/yhay81/parapdf/issues/15)).

Found something else? [Open an
issue](https://github.com/yhay81/parapdf/issues/new/choose).
