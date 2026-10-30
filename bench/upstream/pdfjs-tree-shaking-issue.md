# pdf.js's display bundle cannot be tree-shaken

Why an application that bundles pdfjs-dist's `build/pdf.mjs` gets all of
it, the annotation editor included, whatever it imports, and what pdf.js
would have to change for bundlers to leave out what is unused. The report
at the end was filed as
[mozilla/pdf.js#22396](https://github.com/mozilla/pdf.js/issues/22396) on
2026-10-30, with permalinks to master at 22f5df126, where `stamp.js`'s line
is 50.

## The cost to ParaPDF's users

A Vite 8 application that renders only `PdfDocument` and `PdfViewer`
downloads, besides React, ParaPDF's 43 KiB (gzip) and, when a document
opens, pdf.js's display bundle (125 KiB gzip, 104 KiB brotli) and its worker
(375 KiB gzip). In pdfjs-dist 6.4.299's unminified `pdf.mjs`, the sources
under `src/display/editor/` are 38% of the bytes (323 of 841 KiB), and
`annotation_layer.js`, which the editor needs for its own annotation
elements, another 13%.

Importing fewer of `pdf.mjs`'s exports changes nothing:
`getDocument` alone bundles to the same 420 KiB (minified) as everything
ParaPDF uses, editor included.

## What keeps the code

Bundlers keep a statement that may have side effects and everything it
refers to. Found by tracing, in Vite's tree-shaken output, a path of
references from each statement that is not a declaration to the editor's
classes, rewriting that statement, and tracing again. Line numbers are pdf.js
master's (`bench/vendor/pdf.js` at 157d30e83, 2026-10-17); 6.4.299 has the
same code.

- **G**: `src/pdf.js:103` assigns every export to `globalThis.pdfjsLib`,
  which `web/pdfjs.js` reads for the viewer and the `pdf_viewer.mjs`
  components. The object refers to every export, so nothing is unused.
- **L**: `src/display/editor/annotation_editor_layer.js:100`,
  `static #editorTypes = new Map([FreeTextEditor, InkEditor, StampEditor,
  HighlightEditor, SignatureEditor].map(…))`, runs when the module is
  evaluated, so bundlers keep `AnnotationEditorLayer` and every editor.
- **E**: each editor's `static _editorType = AnnotationEditorType.…`
  (`ink.js:65`, `freetext.js:124`, `highlight.js:84`, `signature.js:75`,
  `stamp.js:54`) reads a property of another module's object, which
  bundlers count as a possible side effect, and keeps the editor.
- **P**: `editor.js:122`, `static _colorManager = new ColorManager()`, and
  `drawers/signaturedraw.js:53`, `static #neighborIdToIndex = new
  Int32Array([…])`, construct objects when the classes are defined, which
  keeps `AnnotationEditor` (and with it `AnnotationEditorUIManager`) and
  `SignatureExtractor`.
- **I**: `src/display/annotation_storage.js:17` imports `AnnotationEditor`
  for `instanceof` checks, so `getDocument`, through `AnnotationStorage`,
  keeps the editor's base class and all it refers to.
- **T**: `src/pdf.js:97` assigns `globalThis._pdfjsTestingUtils = {
  HighlightOutliner }` under `PDFJSDev.test("TESTING || GENERIC")`, so the
  generic build, which pdfjs-dist ships, keeps a testing hook.

G, L, and I keep editor code in every bundler measured, E and P in Vite and
esbuild but not webpack, whose terser takes those initializers for pure;
T's testing hook keeps 1 KiB.

## Measurements

`node bench/scripts/pdfjs-tree-shaking.ts` writes variants of 6.4.299's
`pdf.mjs` with the changes above applied in turn and bundles each as an
application's production build would
([`bench/results/pdfjs-tree-shaking.md`](../results/pdfjs-tree-shaking.md)).
The changes are rewrites of the built file: L, E, P, and T keep pdf.js's
behavior; I's stand-in tells editors apart by their `serialize` method and
is for measuring only; G removes the global. The variants were measured, not
run.

Imports: `getDocument` and `GlobalWorkerOptions`; "viewer", what ParaPDF
uses without annotation editing (`getDocument`, `GlobalWorkerOptions`,
`PDFWorker`, `PDFDataRangeTransport`, the password and permission
constants, `PixelsPerInch`, `TextLayer`, `AnnotationLayer`, `AnnotationMode`,
`AnnotationType`); and the viewer with `AnnotationEditorLayer`,
`AnnotationEditorUIManager`, and `DrawLayer`. KiB, gzip, Vite 8.3.4:

| pdf.mjs | getDocument | viewer | viewer + editor |
|---|---:|---:|---:|
| 6.4.299 | 124.9 | 125.0 | 125.0 |
| G | 113.6 | 120.2 | 122.6 |
| G, L | 110.6 | 117.1 | 122.6 |
| G, L, E | 84.6 | 101.6 | 122.6 |
| G, L, E, P | 80.1 | 97.1 | 122.6 |
| G, L, E, P, I | 59.3 | 76.4 | 122.6 |
| G, L, E, P, I, T | 58.0 | 75.2 | 122.6 |

With every change, a viewer without the editor bundles 249 KiB minified
instead of 420 (75 KiB gzip instead of 125, 64 KiB brotli instead of 104),
and `getDocument` alone 188 KiB. webpack 5.112.0 (terser) and esbuild
0.28.2 agree within 2 KiB with every change made: 75.3 and 76.1 KiB gzip
for the viewer.

All the changes but one, the viewer's imports, KiB gzip:

| Left out | Vite 8.3.4 | webpack 5.112.0 | esbuild 0.28.2 |
|---|---:|---:|---:|
| none | 75.2 | 75.3 | 76.1 |
| G | 125.0 | 126.2 | 126.6 |
| L | 120.2 | 117.9 | 121.6 |
| E | 117.1 | 75.3 | 118.5 |
| P | 100.4 | 75.6 | 101.6 |
| I | 95.8 | 96.3 | 96.8 |
| T | 76.4 | 76.6 | 77.4 |

## What the changes would cost pdf.js

- L, E, P, T are local: a lazily built map, getters (or the constants'
  values), `/* @__PURE__ */` annotations or lazy fields, and the testing hook
  in the TESTING build only.
- I needs `AnnotationStorage` to recognize editors without importing them,
  for example by a symbol it exports and `AnnotationEditor` carries.
- G is the gate: without it, none of the others matter. The global is how
  `web/` code shares the application's pdf.js, so pdfjs-dist would need
  another way for `pdf_viewer.mjs` to reach it (importing `../build/pdf.mjs`
  itself, or the global assigned by a module of its own that the viewer
  components import) while `build/pdf.mjs` stays free of it.

The project's stance on bundling, from #12900 (2021): open to patches,
mindful of maintainability, Firefox first. The global's role came up in
#17228 and #17305 (pdfjs-dist 4.0.189). No issue covers tree-shaking the
display layer.

## What ParaPDF would have to change

Nothing until pdf.js does. Then, two changes, which decision 0002 allows:

- The loader (`packages/parapdf/src/pdfjs/loader.ts:263`) imports pdf.js's
  namespace whole, which keeps every export; it would have to name what it
  uses.
- The editor (`packages/parapdf/src/pdfjs/editor.ts`) is a chunk of its own
  that every build emits, because `annotationEditing` is a runtime option,
  so its pdf.js exports would still count as used and stay in pdf.js's
  chunk, which both chunks share. Applications that never edit benefit only
  if they never import the editor, which makes annotation editing a choice
  made where the application imports it.

## Report

> **Title:** The generic `pdf.mjs` cannot be tree-shaken: every bundle
> includes the annotation editor
>
> Applications that bundle pdfjs-dist get all of `build/pdf.mjs`, whatever
> they import. A Vite build that imports only `getDocument` and
> `GlobalWorkerOptions` from pdfjs-dist 6.4.299 is 420 KiB minified (125
> KiB gzip), the same as one that imports the editor. `src/display/editor/`
> is 38% of `pdf.mjs`.
>
> Six statements keep the code (line numbers from master at 157d30e83):
>
> 1. `src/pdf.js:103`, `globalThis.pdfjsLib = { … }`, refers to every
>    export.
> 2. `src/display/editor/annotation_editor_layer.js:100`, `static
>    #editorTypes = new Map([FreeTextEditor, …].map(…))`, runs at
>    evaluation and keeps every editor.
> 3. `static _editorType = AnnotationEditorType.…` in each editor reads
>    another module's object, which bundlers treat as a possible side
>    effect.
> 4. `static _colorManager = new ColorManager()` (`editor.js:122`) and
>    `static #neighborIdToIndex = new Int32Array(…)`
>    (`drawers/signaturedraw.js:53`) construct objects at class definition.
> 5. `src/display/annotation_storage.js:17` imports `AnnotationEditor` for
>    `instanceof`, so `getDocument` keeps the editor's base class.
> 6. `src/pdf.js:97` keeps `globalThis._pdfjsTestingUtils` in the GENERIC
>    build.
>
> Rewriting these in a copy of 6.4.299's `pdf.mjs` (for 5, a stand-in
> check; for 1, removing the global) and bundling with Vite 8.3.4, KiB
> gzip:
>
> | Imports | pdfjs-dist 6.4.299 | All six changed |
> |---|---:|---:|
> | `getDocument`, `GlobalWorkerOptions` | 124.9 | 58.0 |
> | A viewer: also `PDFWorker`, `TextLayer`, `AnnotationLayer`, and constants | 125.0 | 75.2 |
> | The viewer and `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `DrawLayer` | 125.0 | 122.6 |
>
> webpack 5.112.0 and esbuild 0.28.2 give the same within 2 KiB. Leaving
> any one of 1, 2, and 5 out keeps 21 to 51 KiB of it in all three
> bundlers; 3 and 4 matter to Vite and esbuild, not to webpack's terser; 6
> is 1 KiB. 2 to 6 without 1 give nothing.
>
> 2, 3, 4, and 6 look local (a lazily built map, getters, pure annotations,
> the hook in TESTING builds only); 5 could be a symbol that
> `AnnotationStorage` exports and `AnnotationEditor` carries. 1 is the
> one that needs a decision, since `web/pdfjs.js` reads the global: would
> you accept `pdf_viewer.mjs` reaching the library some other way, so that
> `build/pdf.mjs` stops assigning it? I can send patches for 2 to 6 first,
> since they help as soon as 1 is settled.
>
> Measured with a script that rewrites the built file and bundles each
> variant:
> https://github.com/yhay81/parapdf/blob/main/bench/scripts/pdfjs-tree-shaking.ts
