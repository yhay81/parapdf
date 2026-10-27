# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](transfer-orig-r1-chromium.md) (2026-10-27T17:01:08.072Z), [WebKit 27.2](transfer-orig-r1-webkit.md) (2026-10-27T17:05:54.368Z), [Firefox 157.0](transfer-orig-r1-firefox.md) (2026-10-27T17:11:02.113Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.8 ms (p95), and animation frames arrive every 16.6 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 110.8 | 85.4 | 141.5 |
| pdfjs-next | 217.6 | 193.1 | 171.6 |
| pdfjs-next-hwa | 204.5 | 305.5 | 118.2 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 133.3 | 109.3 | 150.4 |
| pdfjs-next | 208.5 | 194.4 | 190.5 |
| pdfjs-next-hwa | 217.1 | 249.9 | 134.5 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 1 | 0 | 35 |
| pdfjs-next | 133 | 69 | 16 |
| pdfjs-next-hwa | 130 | 78 | 21 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 2.1 | 5.0 | 22.1 |
| pdfjs-next | 95.5 | 57.5 | 8.8 |
| pdfjs-next-hwa | 101.0 | 67.6 | 10.1 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | 151 / 0 | 102 / 0 | 218 / 39 |
| pdfjs-next | 281 / 124 | 256 / 68 | 262 / 10 |
| pdfjs-next-hwa | 304 / 141 | 332 / 77 | 135 / 10 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |

