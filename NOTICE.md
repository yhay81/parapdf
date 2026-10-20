# Notices

ParaPDF is licensed under the [MIT License](LICENSE).

## PDF.js

Parts of ParaPDF are derived from [PDF.js](https://github.com/mozilla/pdf.js),
Copyright Mozilla Foundation, licensed under the Apache License, Version 2.0.
The full license text is in
[`LICENSES/pdf.js-Apache-2.0.txt`](LICENSES/pdf.js-Apache-2.0.txt).

| ParaPDF file | Derived from | Notes |
|---|---|---|
| `packages/parapdf/src/react/styles.ts` | `web/pdf_viewer.css` (pdfjs-dist 6.4.299), `.textLayer` and `.annotationLayer` rules | Renamed to `.parapdf-text-layer` and `.parapdf-annotation-layer`, nesting written out; the rules for links, form fields, and comment popups kept, editing and image rules omitted. |
| `packages/parapdf/src/engine/struct-tree.ts` | `web/struct_tree_layer_builder.js` (pdfjs-dist 6.4.299), `StructTreeLayerBuilder` | The structure tree of a tagged page as elements with ARIA roles that own the text layer's runs, figures' images in the text layer, MathML, and the attributes it gives annotations. Typed, without pdf.js's `Map` extensions; the tree goes into a canvas the page renders for it. |
| `packages/parapdf/src/runtime/print.ts` | `web/pdf_print_service.js` and the print rules of `web/pdf_viewer.css` (pdfjs-dist 6.4.299) | Printing by drawing every page with the print intent and stored form values into images in a print-only container, one per sheet, on sheets the size of the first page, at 150 dpi by default. |
| `packages/parapdf/src/runtime/scheduler.ts` | `web/text_layer_builder.js` | The `endOfContent` element appended after each text layer. |
| `packages/parapdf/src/runtime/text-search.ts` | `web/pdf_find_controller.js` (pdfjs-dist 6.4.299), `normalize()` and `PDFFindController`'s matching | `CHARACTERS_TO_NORMALIZE`, `DIACRITICS_EXCEPTION`, the rules for line ends: joining after CJK characters and inside hyphenated words, keeping a dash before a line end, and reading other line ends as spaces, and the case-sensitive and diacritics options. Diacritics are stripped from both the page and the query instead of being skipped by a regular expression; the whole-word rule is ParaPDF's own. |
| `packages/parapdf/src/runtime/scheduler.ts` | `web/pdf_page_detail_view.js` (pdfjs-dist 6.4.299), `PDFPageDetailView` | Choosing the detail region: the visible area grown by up to its own size on each side within the pixel budget, and redrawing once the view leaves the region or its margin on one side exceeds three times the opposite margin. |
| `packages/parapdf/src/runtime/viewer.ts` | `web/pdf_viewer.js` (pdfjs-dist 6.4.299), `PDFViewer` | Two rules of its scroll modes: horizontal scrolling fits one page, not a spread, to the viewport, and the current page stays current while all of it is in view. The layout of the scroll modes, flipping pages, and the keys that flip them are ParaPDF's own. |
| `packages/parapdf/src/runtime/selection.ts` | `web/text_layer_builder.js` (pdfjs-dist 6.4.299), `TextLayerBuilder` | The selection handling: the `selecting` class on text layers a selection touches, its reset on pointer release, blur, and key release, and moving `endOfContent` next to the changing end of the selection in browsers other than Firefox and Chromium 148 or later. Each viewer owns its listeners instead of sharing static ones, and a reset leaves `endOfContent` in place when it already is the layer's last child; the drag handling for the space around the pages, including drags that start there, and for text layers above the selection is ParaPDF's own. |

pdf.js itself is a peer dependency and is not redistributed by ParaPDF.
