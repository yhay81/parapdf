# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](frames-chromium.md) (2026-10-24T02:05:05.138Z), [WebKit 27.2](frames-webkit.md) (2026-10-24T02:38:30.989Z), [Firefox 157.0](frames-firefox.md) (2026-10-24T03:12:19.443Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-frame` variants draw into an OffscreenCanvas instead of the displayed canvas and show the finished page as an ImageBitmap through a `bitmaprenderer` context.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.7 ms late (median) / 5.0 ms (p95), and animation frames arrive every 13.9 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 14 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 51.6 | 61.8 | 67.3 |
| pdfjs-frame | 64.7 | 59.6 | 58.4 |
| pdfjs-hwa | 51.9 | 57.7 | 60.8 |
| pdfjs-hwa-frame | 51.2 | 58.5 | 57.7 |
| pdfjs-next | 70.1 | 68.2 | 56.7 |
| pdfjs-next-frame | 66.7 | 68.5 | 60.3 |
| pdfjs-next-hwa | 54.6 | 71.3 | 56.4 |
| pdfjs-next-hwa-frame | 56.0 | 69.8 | 56.5 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 50.4 | 41.7 | 59.3 |
| pdfjs-frame | 50.0 | 41.7 | 59.4 |
| pdfjs-hwa | 50.0 | 42.3 | 59.5 |
| pdfjs-hwa-frame | 50.5 | 41.8 | 58.3 |
| pdfjs-next | 66.7 | 57.1 | 65.0 |
| pdfjs-next-frame | 58.8 | 55.5 | 59.0 |
| pdfjs-next-hwa | 50.7 | 56.0 | 57.9 |
| pdfjs-next-hwa-frame | 50.4 | 55.5 | 59.0 |

## Frame handover p50 (ms): median across files

`transferToImageBitmap()` and `transferFromImageBitmap()` after pdf.js's drawing; `-frame` variants only.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-frame | 6.50 | 0.10 | 1.45 |
| pdfjs-hwa-frame | 1.20 | 0.10 | 1.50 |
| pdfjs-next-frame | 1.85 | 0.10 | 1.70 |
| pdfjs-next-hwa-frame | 0.00 | 0.10 | 1.70 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 19 | 1 | 28 |
| pdfjs-frame | 29 | 1 | 30 |
| pdfjs-hwa | 5 | 0 | 24 |
| pdfjs-hwa-frame | 5 | 0 | 30 |
| pdfjs-next | 5 | 0 | 3 |
| pdfjs-next-frame | 4 | 0 | 8 |
| pdfjs-next-hwa | 0 | 0 | 4 |
| pdfjs-next-hwa-frame | 0 | 0 | 6 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 10.1 | 6.2 | 13.7 |
| pdfjs-frame | 21.1 | 5.9 | 15.4 |
| pdfjs-hwa | 5.3 | 5.6 | 13.1 |
| pdfjs-hwa-frame | 5.0 | 5.5 | 15.0 |
| pdfjs-next | 6.2 | 5.4 | 3.8 |
| pdfjs-next-frame | 3.7 | 5.3 | 6.2 |
| pdfjs-next-hwa | 1.5 | 5.0 | 3.8 |
| pdfjs-next-hwa-frame | 1.6 | 5.3 | 5.8 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs | 68 / 42 | 75 / 1 | 87 / 41 |
| pdfjs-frame | 73 / 37 | 73 / 0 | 93 / 37 |
| pdfjs-hwa | 56 / 27 | 73 / 1 | 91 / 43 |
| pdfjs-hwa-frame | 72 / 30 | 72 / 1 | 91 / 45 |
| pdfjs-next | 86 / 5 | 83 / 0 | 104 / 7 |
| pdfjs-next-frame | 83 / 2 | 89 / 0 | 97 / 10 |
| pdfjs-next-hwa | 75 / 0 | 82 / 0 | 93 / 4 |
| pdfjs-next-hwa-frame | 76 / 0 | 92 / 0 | 101 / 3 |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs | 91 / 5 | 145 / 42 | 127 / 25 |
| pdfjs-frame | 117 / 30 | 161 / 44 | 124 / 23 |
| pdfjs-hwa | 84 / 0 | 113 / 0 | 123 / 24 |
| pdfjs-hwa-frame | 84 / 0 | 99 / 0 | 126 / 22 |
| pdfjs-next | 174 / 54 | 170 / 30 | 124 / 8 |
| pdfjs-next-frame | 172 / 42 | 187 / 30 | 124 / 9 |
| pdfjs-next-hwa | 215 / 74 | 194 / 28 | 119 / 10 |
| pdfjs-next-hwa-frame | 174 / 60 | 180 / 27 | 126 / 12 |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs | 75 / 26 | 77 / 10 | 64 / 17 |
| pdfjs-frame | 59 / 22 | 64 / 13 | 67 / 19 |
| pdfjs-hwa | 73 / 22 | 60 / 10 | 64 / 12 |
| pdfjs-hwa-frame | 57 / 13 | 63 / 12 | 65 / 16 |
| pdfjs-next | 82 / 1 | 67 / 0 | 53 / 0 |
| pdfjs-next-frame | 78 / 0 | 68 / 0 | 51 / 2 |
| pdfjs-next-hwa | 75 / 0 | 69 / 0 | 53 / 2 |
| pdfjs-next-hwa-frame | 75 / 0 | 69 / 0 | 55 / 4 |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs | 71 / 55 | 89 / 5 | 97 / 63 |
| pdfjs-frame | 100 / 38 | 72 / 1 | 96 / 64 |
| pdfjs-hwa | 68 / 2 | 73 / 0 | 97 / 72 |
| pdfjs-hwa-frame | 69 / 1 | 73 / 1 | 99 / 48 |
| pdfjs-next | 114 / 8 | 141 / 0 | 124 / 4 |
| pdfjs-next-frame | 130 / 9 | 141 / 0 | 123 / 9 |
| pdfjs-next-hwa | 72 / 0 | 90 / 0 | 115 / 3 |
| pdfjs-next-hwa-frame | 70 / 0 | 84 / 0 | 127 / 8 |

