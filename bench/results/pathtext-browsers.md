# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](pathtext-chromium.md) (2026-10-27T16:40:29.320Z), [WebKit 27.2](pathtext-webkit.md) (2026-10-27T16:42:20.098Z), [Firefox 157.0](pathtext-firefox.md) (2026-10-27T16:44:04.532Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.3 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.9 ms late (median) / 5.4 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.5 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 7 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 60.8 | 78.0 | 82.4 |
| pdfjs-hwa-pathtext | 73.6 | 88.7 | 85.7 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 50.0 | 50.7 | 50.4 |
| pdfjs-hwa-pathtext | 50.3 | 50.1 | 59.5 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 24 | 3 | 40 |
| pdfjs-hwa-pathtext | 8 | 7 | 49 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 12.5 | 6.5 | 17.2 |
| pdfjs-hwa-pathtext | 7.2 | 8.4 | 15.7 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | 71 / 29 | 88 / 6 | 104 / 53 |
| pdfjs-hwa-pathtext | 74 / 14 | 102 / 5 | 102 / 49 |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | 118 / 0 | 119 / 0 | 150 / 24 |
| pdfjs-hwa-pathtext | 117 / 0 | 153 / 0 | 196 / 29 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | 78 / 27 | 98 / 15 | 63 / 13 |
| pdfjs-hwa-pathtext | 91 / 24 | 94 / 16 | 70 / 14 |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-hwa-pathtext | — | — | — |

