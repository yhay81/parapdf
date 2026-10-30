# 0001. pdf.js is the only engine

- Status: adopted
- Date: 2026-10-24

## Decision

ParaPDF uses pdf.js alone and is optimized for how pdf.js works. It keeps no
engine boundary: the runtime uses pdf.js's own types (`PDFDocumentProxy`,
`PDFPageProxy`, `PageViewport`, `OptionalContentConfig`), caches, drawing,
and layers directly. An interface exists only where tests stand in for the
parts of pdf.js they use.

- The runtime goes through pdf.js's core display API. It does not use or
  copy the viewer components of `pdfjs-dist/web/`, and does not fork or
  patch pdf.js; changes pdf.js needs are proposed upstream.
- Code ported from pdf.js's viewer keeps its Apache-2.0 attribution in
  `NOTICE.md`.
- The package depends on one exact pdfjs-dist and ships its worker and the
  files it loads on demand; applications configure nothing.

The engine benchmark in `bench/` remains as research: what pdf.js could
adopt upstream, and what a pdf.js build costs before ParaPDF moves to it.

## Evidence

The engine benchmark (14 PDFs, three runs, the median across files;
[`browsers.md`](../../bench/results/browsers.md),
[`chromium.md`](../../bench/results/chromium.md)) found no engine that beats
pdf.js across the corpus:

- Payload: released pdf.js 404 KiB with brotli, PDFium 1,645 KiB, hayro
  1,364 KiB (both compiled to WebAssembly).
- On synthetic-vector-200k.pdf the first page took 71 ms with pdf.js in
  Chromium, against 375 with PDFium and 224 with hayro.
- Only pdf.js draws Japanese text in fonts the PDF does not embed.
- A hybrid that drew scanned pages with hayro grew its WebAssembly memory by
  51 to 103 MiB per scan without giving it back
  ([`hybrid.md`](../../examples/prototype/results/hybrid.md)).

## Reopen if

pdf.js stops being maintained, or another engine shows a reproducible win
across the corpus in all three browsers that outweighs the features ParaPDF
builds on pdf.js's layers.
