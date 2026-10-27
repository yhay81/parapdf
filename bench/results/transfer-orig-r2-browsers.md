# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](transfer-orig-r2-chromium.md) (2026-10-27T17:03:16.346Z), [WebKit 27.2](transfer-orig-r2-webkit.md) (2026-10-27T17:07:59.947Z), [Firefox 157.0](transfer-orig-r2-firefox.md) (2026-10-27T17:13:20.839Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.3 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.8 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 84.3 | 110.2 | 117.7 |
| pdfjs-next | 174.4 | 205.6 | 128.4 |
| pdfjs-next-hwa | 167.8 | 238.3 | 144.1 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 108.3 | 133.3 | 133.4 |
| pdfjs-next | 175.1 | 216.5 | 150.7 |
| pdfjs-next-hwa | 166.7 | 242.3 | 176.2 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 0 | 1 | 34 |
| pdfjs-next | 94 | 71 | 21 |
| pdfjs-next-hwa | 91 | 68 | 15 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 1.5 | 5.4 | 20.3 |
| pdfjs-next | 54.8 | 66.2 | 11.0 |
| pdfjs-next-hwa | 64.3 | 57.5 | 8.9 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | 118 / 0 | 134 / 1 | 158 / 25 |
| pdfjs-next | 236 / 81 | 305 / 96 | 161 / 12 |
| pdfjs-next-hwa | 207 / 72 | 334 / 73 | 229 / 12 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |

