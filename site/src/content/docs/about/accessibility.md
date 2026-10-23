---
title: Accessibility
description: How ParaPDF exposes documents to assistive technology.
---

- The viewport is a focusable, labelled `role="document"`, and each page a
  labelled region. Name them in your application's language with
  `PdfViewport`'s `label` and `pageLabel`; the defaults are "PDF document"
  and "Page 3 of 12".
- The canvases are hidden from assistive technology, which reads the text
  layer instead.
- A tagged PDF's structure gives that text its headings, paragraphs, lists,
  tables, and figures' alternative text, as in pdf.js's viewer.
- Text layers carry the PDF's language (`/Lang`), or the page's when the PDF
  declares none, so screen readers announce the text in its language.
- Links are focusable and activate with the keyboard; links within the
  document are named by the text they link.
- The keyboard scrolls, turns pages, and zooms: see [Controls and
  state](/guides/controls/#keyboard-and-gestures).
- `pageColors` draws pages in two colors, for example `Canvas` and
  `CanvasText` in forced-colors mode.
- With `enforcePermissions` and a document that forbids copying, assistive
  technology still reads the text.

Applications own the rest of the interface: label your toolbar, announce
search results with an `aria-live` region as [the search
guide](/guides/search/) does, and label the annotation editor's controls with
`annotationLabels`.
