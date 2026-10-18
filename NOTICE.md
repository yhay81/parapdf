# Notices

ParaPDF is licensed under the [MIT License](LICENSE).

## PDF.js

Parts of ParaPDF are derived from [PDF.js](https://github.com/mozilla/pdf.js),
Copyright Mozilla Foundation, licensed under the Apache License, Version 2.0.
The full license text is in
[`LICENSES/pdf.js-Apache-2.0.txt`](LICENSES/pdf.js-Apache-2.0.txt).

| ParaPDF file | Derived from | Notes |
|---|---|---|
| `packages/parapdf/src/react/styles.ts` | `web/pdf_viewer.css` (pdfjs-dist 6.4.299), `.textLayer` and `.annotationLayer` rules | Renamed to `.parapdf-text-layer` and `.parapdf-annotation-layer`; editing, form, popup, and image rules omitted. |
| `packages/parapdf/src/runtime/scheduler.ts` | `web/text_layer_builder.js` | The `endOfContent` element appended after each text layer. |
| `packages/parapdf/src/runtime/text-search.ts` | `web/pdf_find_controller.js` (pdfjs-dist 6.4.299), `normalize()` and `PDFFindController`'s default matching | `CHARACTERS_TO_NORMALIZE`, `DIACRITICS_EXCEPTION`, and the rules for line ends: joining after CJK characters and inside hyphenated words, keeping a dash before a line end, and reading other line ends as spaces. Diacritics are stripped from both the page and the query instead of being skipped by a regular expression. |
| `packages/parapdf/src/runtime/selection.ts` | `web/text_layer_builder.js` (pdfjs-dist 6.4.299), `TextLayerBuilder` | The selection handling: the `selecting` class on text layers a selection touches, its reset on pointer release, blur, and key release, and moving `endOfContent` next to the changing end of the selection in browsers other than Firefox and Chromium 148 or later. Each viewer owns its listeners instead of sharing static ones; the drag handling for the space around the pages, including drags that start there, and for text layers above the selection is ParaPDF's own. |

pdf.js itself is a peer dependency and is not redistributed by ParaPDF.
