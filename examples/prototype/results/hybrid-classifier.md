# ParaPDF hybrid engine: page classifier and payload

## Decisions on the corpus

What the hybrid engine's classifier (`bench/hayro-classify`, hayro-syntax
0.8.0 without image decoders) decides for every page of the corpus, with the
engine's default rule: a page goes to hayro when it has no visible text, an
image covering at least half of its crop box, at most 64 path segments, no
shadings, and no non-link annotation appearances. The walk stops at the first
visible text, the 65th path segment, or before decoding more than 256 KiB of
encoded content.

Timings are the native release build (`cargo run --release --example classify
-- --table`) on an Apple M2 Pro, 2026-10-19 00:54 JST. The machine was not
quiet (1-minute load average 14–16), so maxima include scheduling delays
(the 18 ms maximum on `synthetic-text-1000.pdf` is one of them); the
medians matched two earlier runs within a few microseconds. In the browser
the classifier runs as WebAssembly in the hybrid worker; its per-page cost
there is part of the hybrid benchmark, which has not run yet.

| File | Pages | Parse (ms) | Pages to hayro | Classify p50 / max (µs) | Why pages stay on pdf.js |
|---|---:|---:|---:|---:|---|
| `bill-hr815.pdf` | 110 | 0.61 | 0 | 29 / 86 | visible text |
| `bunka-kokugo-series-019-p4.pdf` | 1 | 0.04 | 1 | 3 / 3 | — |
| `f1040.pdf` | 2 | 0.13 | 0 | 871 / 871 | visible text |
| `mhlw-doc.pdf` | 2 | 0.09 | 0 | 103 / 103 | visible text |
| `nics-background-checks-2015-11.pdf` | 1 | 0.01 | 0 | 268 / 268 | visible text |
| `patent-us223898.pdf` | 4 | 0.02 | 4 | 117 / 130 | — |
| `pdfium-jpx-lzw.pdf` | 1 | 0.01 | 1 | 3 / 3 | — |
| `pdfium-smask-blend.pdf` | 1 | 0.01 | 0 | 6 / 6 | no image |
| `pdfium-type3.pdf` | 1 | 0.00 | 0 | 1 / 1 | visible text |
| `usrguide.pdf` | 27 | 0.45 | 0 | 37 / 110 | visible text |
| `wdl6812-manuscript.pdf` | 2 | 0.01 | 2 | 5 / 5 | — |
| `synthetic-cjk-nonembedded.pdf` | 1 | 0.03 | 0 | 13 / 13 | visible text |
| `synthetic-text-1000.pdf` | 1000 | 13.84 | 0 | 30 / 17984 | visible text |
| `synthetic-vector-200k.pdf` | 1 | 0.05 | 0 | 1 / 1 | content over 256 KiB |

- The three scans go to hayro, the patent included: its OCR text uses
  rendering mode 3, which the classifier counts as invisible (28–810
  invisible text operators per page, no visible ones).
- Every text page stops at its first visible text operator, so a page costs
  tens of microseconds; `f1040.pdf` costs 0.9 ms because its 53 form-field
  annotations are read before the content stream.
- The 200,000-segment vector page is never decoded: its encoded content
  stream (about 1.2 MB) is over the 256 KiB limit. Decoding and walking it
  completely takes 28 ms natively.
- `pdfium-jpx-lzw.pdf` (one JPEG 2000 image behind LZW) also qualifies.

## Payload

Brotli quality 11 of the demo's production build
(`pnpm --filter @parapdf/prototype build`), from `hybrid-bench.ts`'s payload
measurement:

| Loads | Asset | Raw | Brotli |
|---|---|---:|---:|
| with every document | hybrid worker (`serveHybridWorker` and the classifier's wasm-bindgen glue) | 6 KiB | 2 KiB |
| with every document | classifier wasm (`hayro_classify_bg.wasm`, `opt-level = "s"`) | 278 KiB | 93 KiB |
| with the first image-only page | hayro wasm-bindgen glue | 4 KiB | 1 KiB |
| with the first image-only page | hayro wasm (`hayro_wasm_bench_bg.wasm`, simd128) | 3,961 KiB | 1,362 KiB |
| reference | pdf.js master: main library, parsing worker, renderer worker | 2,852 KiB | 521 KiB |

The hybrid engine adds 95 KiB brotli to every document and 1,363 KiB more
once a document has an image-only page. Optimizing the classifier for speed
(`opt-level = 3`) would make it about 101 KiB, and for size (`"z"`) about
85 KiB.
