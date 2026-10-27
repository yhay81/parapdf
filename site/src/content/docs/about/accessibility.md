---
title: Accessibility
description: How ParaPDF exposes documents to assistive technology.
---

- Each viewport is a focusable, labelled `role="document"`, and each page a
  labelled region. Name them in your application's language with
  `PdfViewer`'s `label` and `pageLabel`; the defaults are "PDF document"
  and "Page 3 of 12".
- The canvases are hidden from assistive technology, which reads the text
  layer instead.
- A tagged PDF's structure gives that text its headings, paragraphs, lists,
  tables, and figures' alternative text, as in pdf.js's viewer.
- Text layers carry the PDF's language (`/Lang`), or, where the PDF
  declares none, the language the viewer inherits from your page, so screen
  readers announce the text in its language.
- Links are focusable and activate with the keyboard; links within the
  document are named by the text they link.
- The keyboard scrolls the focused viewport, and Ctrl or ⌘ with +, -, and 0
  zooms it; in `"page"` mode, Page Down, Space, and the arrow keys turn
  pages at the page's edges, and Home and End go to the first and last page.
  See [Controls and state](/guides/controls/).
- `PdfThumbnails` is a labelled navigation list of buttons, each named by
  `pageLabel` ("Page 3 of 12" by default), the current page marked with
  `aria-current="page"`; the thumbnails themselves are hidden from assistive
  technology.
- `pageColors` draws pages in two colors, for example `Canvas` and
  `CanvasText` in forced-colors mode.
- With `enforcePermissions` and a document that forbids copying, assistive
  technology still reads the text.
- Only mounted pages have text layers, so assistive technology reaches the
  pages near the viewport, not the whole document at once (see
  [Limitations](/about/limitations/)).

The functional checks verify what the page exposes; no screen reader has
been tried with it yet
([#32](https://github.com/yhay81/parapdf/issues/32)).

Applications own the rest of the interface: label your toolbar, announce
search results with an `aria-live` region as [the search
guide](/guides/search/) does, and label the annotation editor's controls with
`annotationLabels`.
