# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](scans-chromium.md) (2026-10-27T16:50:30.101Z), [WebKit 27.2](scans-webkit.md) (2026-10-27T16:51:44.417Z), [Firefox 157.0](scans-firefox.md) (2026-10-27T16:57:52.732Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.9 ms late (median) / 5.5 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 2.0 ms late (median) / 3.3 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 89.5 | 143.4 | 186.1 |
| pdfjs-hwa | 76.1 | 109.5 | 199.8 |
| pdfjs-next | 167.0 | 210.5 | 141.1 |
| pdfjs-next-hwa | 142.5 | 252.3 | 116.9 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 116.3 | 158.1 | 178.6 |
| pdfjs-hwa | 100.3 | 141.4 | 210.2 |
| pdfjs-next | 183.2 | 222.1 | 166.0 |
| pdfjs-next-hwa | 166.4 | 249.0 | 147.7 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 7 | 22 | 54 |
| pdfjs-hwa | 0 | 0 | 60 |
| pdfjs-next | 95 | 63 | 35 |
| pdfjs-next-hwa | 74 | 60 | 26 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 5.7 | 27.2 | 30.2 |
| pdfjs-hwa | 1.9 | 5.8 | 26.1 |
| pdfjs-next | 55.1 | 62.0 | 14.9 |
| pdfjs-next-hwa | 50.7 | 58.7 | 15.3 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs | — | — | — |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs | 125 / 10 | 186 / 43 | 224 / 32 |
| pdfjs-hwa | 101 / 0 | 151 / 0 | 280 / 26 |
| pdfjs-next | 234 / 81 | 303 / 81 | 199 / 17 |
| pdfjs-next-hwa | 207 / 73 | 351 / 79 | 158 / 19 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs | — | — | — |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs | — | — | — |
| pdfjs-hwa | — | — | — |
| pdfjs-next | — | — | — |
| pdfjs-next-hwa | — | — | — |

