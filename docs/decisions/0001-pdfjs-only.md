# 0001. pdf.js is the only engine

- Status: adopted
- Date: 2026-10-24

## Context

ParaPDF 0.x kept a narrow engine boundary (`PdfEngine`,
`PdfEngineDocument` in `packages/parapdf/src/engine/types.ts`) so that
another engine could replace pdf.js once a benchmark showed a reproducible
win. The boundary grew to 21 methods, most of them pdf.js's DOM layers
(text, annotations, forms, the annotation editor) behind neutral names, and
no runtime benchmark ever ran another engine through it.

Phase 0's engine benchmark found no engine that beats pdf.js across the
corpus (`bench/results/browsers.md`): on synthetic-vector-200k.pdf the first
page took 375 ms with pdfium and 224 with hayro against 71 with pdf.js in
Chromium, and a hybrid that drew scanned pages with hayro grew its wasm
memory by 51 to 103 MiB per scan without giving it back
(`docs/history/AGENTS-v0.md`, "A hybrid engine").

## Decision

ParaPDF uses pdf.js alone and is optimized for how pdf.js works. No engine
boundary is kept for another engine: the runtime uses pdf.js's own types
(`PDFDocumentProxy`, `PDFPageProxy`, `PageViewport`,
`OptionalContentConfig`), its caches, its drawing, and its layers directly.
An interface that remains exists so that tests can stand in for the parts
of pdf.js they use, not so that pdf.js can be swapped.

These stay as they were:

- The runtime goes through pdf.js's core display API. It does not use or
  copy the viewer components of `pdfjs-dist/web/`, and does not fork or
  patch pdf.js; changes pdf.js needs are proposed upstream.
- Code ported from pdf.js's viewer keeps its Apache-2.0 attribution in
  `NOTICE.md`.
- The package depends on one exact pdfjs-dist and ships its worker and the
  files it loads on demand; applications configure nothing.

The engine benchmark in `bench/` remains as research: what pdf.js could
adopt upstream (its renderer worker, partial rendering), and what a build of
pdf.js costs before ParaPDF moves to it.

## Consequences

- M1 replaced `native: unknown` with `proxy: PDFDocumentProxy` and removed
  `pdfjsDocumentOf`. M2 removes `PdfEngine`, `PdfEngineDocument`, and the
  other engine-neutral types and names (`DestinationRef = unknown`,
  `engineName`).
- pdf.js-specific optimizations are in scope, each decided by measurement
  (0004 to 0008).

## Reopen if

pdf.js stops being maintained, or another engine shows a reproducible win
across the corpus in all three browsers that outweighs the features ParaPDF
builds on pdf.js's layers.
