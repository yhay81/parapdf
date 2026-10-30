# Notices

ParaPDF
Copyright 2026 Yusuke Hayashi

ParaPDF is licensed under the [Apache License, Version 2.0](LICENSE).

## PDF.js

Parts of ParaPDF are derived from [PDF.js](https://github.com/mozilla/pdf.js)
(pdfjs-dist 6.4.299), Copyright Mozilla Foundation, licensed under the
Apache License, Version 2.0. These files in `packages/parapdf/src/` are
derived from the PDF.js files beside them and changed for ParaPDF:

| ParaPDF | PDF.js |
|---|---|
| `features/auto-links.ts` | `web/autolinker.js`, `web/pdf_page_view.js` |
| `features/forms/scripts.ts`, `pdfjs/scripting.ts` | `web/pdf_scripting_manager.js`, `web/generic_scripting.js` |
| `features/initial-view.ts` | `web/pdf_link_service.js` |
| `features/print/print.ts` | `web/pdf_print_service.js`, `web/pdf_viewer.css` |
| `features/search/text-search.ts` | `web/pdf_find_controller.js` |
| `pdfjs/editor.ts` | `web/annotation_editor_layer_builder.js`, `web/draw_layer_builder.js`, `l10n/en-US/viewer.ftl` |
| `pdfjs/struct-tree.ts` | `web/struct_tree_layer_builder.js` |
| `react/editor-icons.ts` | `web/images/editor-toolbar-delete.svg`, `web/images/toolbarButton-menuArrow.svg` |
| `react/editor-styles.ts`, `react/styles.ts` | `web/pdf_viewer.css` |
| `render/dom-layers.ts`, `render/selection.ts` | `web/text_layer_builder.js` |
| `render/planner.ts` | `web/pdf_page_detail_view.js` |
| `view/viewer.ts` | `web/pdf_viewer.js` |

The `parapdf` package also redistributes files of pdfjs-dist in `pdfjs/`:
the worker, behind ParaPDF's prelude, and the files it loads on demand. They
keep their licenses, which are copied alongside them.
