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

The functional checks verify what the page exposes. VoiceOver in Safari on
macOS has been tried with the demo
([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/voiceover-safari-macos.md)):
it reads the text in order, the tagged lists, links, form fields, the
thumbnails, and continues into pages as they mount. Pages are focusable
(`tabindex="-1"`, out of the tab order), and the focus follows the page
shown, so reading goes on from it:

- While the focus is on the viewport or a page, it moves to the current
  page when that changes, and VoiceOver announces the page ("Page 10 of
  110").
- Following a link moves the focus to the page the link goes to.
- When the page holding the focus unmounts, the focus moves to the current
  page rather than the body.
- A comment's icon is named by the comment, and a field by its tooltip
  (`/TU`).

Where it falls short: links are read after their page's text, and reading
after a link starts at the top of the page it goes to, not at the exact
destination.

NVDA has not been tried yet
([#32](https://github.com/yhay81/parapdf/issues/32)).

Applications own the rest of the interface: label your toolbar, announce
search results with an `aria-live` region as [the search
guide](/guides/search/) does, and label the annotation editor's controls with
`annotationLabels`.
