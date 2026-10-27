# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](transfer-transfer-r1-chromium.md) (2026-10-27T17:02:20.910Z), [WebKit 27.2](transfer-transfer-r1-webkit.md) (2026-10-27T17:06:56.034Z), [Firefox 157.0](transfer-transfer-r1-firefox.md) (2026-10-27T17:12:11.980Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.8 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 93.1 | 92.8 | 161.9 |
| pdfjs-next | 160.3 | 120.6 | 113.0 |
| pdfjs-next-hwa | 85.0 | 127.0 | 110.5 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 124.5 | 116.8 | 133.6 |
| pdfjs-next | 174.8 | 141.8 | 156.8 |
| pdfjs-next-hwa | 116.6 | 141.2 | 140.3 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 0 | 1 | 43 |
| pdfjs-next | 5 | 3 | 20 |
| pdfjs-next-hwa | 0 | 0 | 3 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 1.6 | 5.0 | 23.0 |
| pdfjs-next | 6.5 | 8.1 | 9.7 |
| pdfjs-next-hwa | 1.9 | 5.0 | 3.4 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | 134 / 0 | 117 / 0 | 160 / 26 |
| pdfjs-next | 215 / 4 | 165 / 0 | 154 / 1 |
| pdfjs-next-hwa | 122 / 0 | 179 / 1 | 156 / 1 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |

