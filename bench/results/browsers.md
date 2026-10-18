# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](chromium.md) (2026-10-18T11:58:45.150Z), [WebKit 27.2](webkit.md) (2026-10-18T12:05:11.172Z), [Firefox 157.0](firefox.md) (2026-10-18T12:11:26.440Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.4 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.8 ms late (median) / 5.6 ms (p95), and animation frames arrive every 16.7 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.5 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 14 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 45.7 | 62.5 | 58.0 |
| pdfjs-hwa | 45.9 | 56.1 | 56.8 |
| pdfjs-next | 67.7 | 71.2 | 55.1 |
| pdfjs-next-hwa | 54.8 | 71.5 | 54.4 |
| pdfium | 45.6 | 49.0 | 39.2 |
| hayro | 47.5 | 40.8 | 32.7 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 50.5 | 50.6 | 60.1 |
| pdfjs-hwa | 50.4 | 50.0 | 62.5 |
| pdfjs-next | 58.5 | 66.5 | 64.3 |
| pdfjs-next-hwa | 50.1 | 66.2 | 59.6 |
| pdfium | 50.0 | 50.2 | 49.3 |
| hayro | 50.0 | 50.0 | 50.0 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 21 | 1 | 28 |
| pdfjs-hwa | 4 | 1 | 27 |
| pdfjs-next | 4 | 0 | 2 |
| pdfjs-next-hwa | 0 | 0 | 3 |
| pdfium | 0 | 0 | 2 |
| hayro | 0 | 0 | 4 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 11.1 | 6.0 | 14.6 |
| pdfjs-hwa | 4.7 | 6.0 | 12.6 |
| pdfjs-next | 5.3 | 5.8 | 4.1 |
| pdfjs-next-hwa | 1.8 | 5.8 | 4.6 |
| pdfium | 1.9 | 5.6 | 4.5 |
| hayro | 1.9 | 5.6 | 4.6 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs | 68 / 39 | 74 / 6 | 90 / 36 |
| pdfjs-hwa | 56 / 29 | 74 / 4 | 82 / 39 |
| pdfjs-next | 80 / 2 | 85 / 0 | 88 / 2 |
| pdfjs-next-hwa | 75 / 0 | 89 / 0 | 96 / 2 |
| pdfium | 48 / 0 | 53 / 0 | 43 / 5 |
| hayro | 51 / 0 | 49 / 0 | 37 / 3 |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs | 89 / 4 | 129 / 20 | 123 / 21 |
| pdfjs-hwa | 84 / 0 | 102 / 0 | 104 / 19 |
| pdfjs-next | 146 / 37 | 161 / 23 | 108 / 5 |
| pdfjs-next-hwa | 119 / 30 | 177 / 25 | 107 / 2 |
| pdfium | 146 / 0 | 82 / 0 | 155 / 2 |
| hayro | 40 / 0 | 49 / 0 | 39 / 1 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs | 58 / 25 | 72 / 9 | 49 / 14 |
| pdfjs-hwa | 56 / 22 | 67 / 10 | 51 / 14 |
| pdfjs-next | 83 / 2 | 74 / 0 | 49 / 3 |
| pdfjs-next-hwa | 78 / 0 | 75 / 0 | 50 / 2 |
| pdfium | 23 / 0 | 20 / 0 | 15 / 2 |
| hayro | 32 / 0 | 33 / 0 | 20 / 2 |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs | 71 / 43 | 89 / 5 | 96 / 56 |
| pdfjs-hwa | 69 / 2 | 72 / 2 | 93 / 56 |
| pdfjs-next | 105 / 11 | 128 / 0 | 109 / 3 |
| pdfjs-next-hwa | 71 / 0 | 85 / 0 | 104 / 4 |
| pdfium | 375 / 0 | 379 / 1 | 410 / 15 |
| hayro | 224 / 0 | 234 / 1 | 261 / 10 |

