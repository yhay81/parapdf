# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](transfer-transfer-r2-chromium.md) (2026-10-27T17:04:11.049Z), [WebKit 27.2](transfer-transfer-r2-webkit.md) (2026-10-27T17:09:14.935Z), [Firefox 157.0](transfer-transfer-r2-firefox.md) (2026-10-27T17:14:26.081Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.8 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 76.3 | 134.6 | 118.6 |
| pdfjs-next | 157.9 | 173.8 | 116.0 |
| pdfjs-next-hwa | 64.8 | 176.3 | 113.3 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 100.2 | 166.3 | 125.9 |
| pdfjs-next | 158.6 | 177.5 | 140.8 |
| pdfjs-next-hwa | 91.7 | 175.0 | 141.9 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 0 | 1 | 31 |
| pdfjs-next | 4 | 9 | 2 |
| pdfjs-next-hwa | 0 | 1 | 4 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 1.5 | 5.3 | 19.4 |
| pdfjs-next | 5.9 | 9.4 | 4.1 |
| pdfjs-next-hwa | 1.4 | 5.3 | 4.5 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | 101 / 0 | 200 / 1 | 162 / 23 |
| pdfjs-next | 199 / 2 | 201 / 0 | 158 / 1 |
| pdfjs-next-hwa | 93 / 0 | 227 / 0 | 161 / 3 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |

