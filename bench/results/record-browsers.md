# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](record-chromium.md) (2026-10-24T02:58:58.392Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.5 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 14 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 |
|---|---:|
| pdfjs-hwa | 45.5 |
| pdfjs-hwa-record | 49.3 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 |
|---|---:|
| pdfjs-hwa | 51.0 |
| pdfjs-hwa-record | 50.3 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 |
|---|---:|
| pdfjs-hwa | 5 |
| pdfjs-hwa-record | 20 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 |
|---|---:|
| pdfjs-hwa | 4.5 |
| pdfjs-hwa-record | 12.8 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 |
|---|---:|
| **f1040.pdf** |  |
| pdfjs-hwa | 56 / 27 |
| pdfjs-hwa-record | 62 / 38 |
| **bunka-kokugo-series-019-p4.pdf** |  |
| pdfjs-hwa | 84 / 0 |
| pdfjs-hwa-record | 84 / 0 |
| **synthetic-cjk-nonembedded.pdf** |  |
| pdfjs-hwa | 55 / 22 |
| pdfjs-hwa-record | 56 / 22 |
| **synthetic-vector-200k.pdf** |  |
| pdfjs-hwa | 69 / 2 |
| pdfjs-hwa-record | 68 / 4 |

