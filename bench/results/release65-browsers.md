# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](release65-chromium.md) (2026-11-12T14:11:27.456Z), [WebKit 27.2](release65-webkit.md) (2026-11-12T14:13:13.174Z), [Firefox 157.0](release65-firefox.md) (2026-11-12T14:15:34.988Z).

- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.5.438 (main-thread drawing, -renderer enables the drawing worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.2 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 3 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Errors and renderer-worker fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 34.3 | 35.3 | 60.1 |
| pdfjs-hwa-renderer | 54.6 | 85.4 | 49.9 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 66.5 | 55.8 | 54.9 |
| pdfjs-hwa-renderer | 50.1 | 55.5 | 71.5 |

## Main thread blocked while rendering (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 0 | 0 | 14 |
| pdfjs-hwa-renderer | 0 | 0 | 4 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 2.1 | 5.0 | 11.6 |
| pdfjs-hwa-renderer | 1.7 | 5.0 | 3.9 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **patent-us223898.pdf** |  |  |  |
| pdfjs-hwa | 34 / 0 | 58 / 0 | 60 / 14 |
| pdfjs-hwa-renderer | 63 / 32 | 86 / 18 | 50 / 5 |
| **bill-hr815.pdf** |  |  |  |
| pdfjs-hwa | 53 / 15 | 35 / 1 | 73 / 31 |
| pdfjs-hwa-renderer | 55 / 0 | 85 / 0 | 74 / 4 |
| **pdfium-jpx-lzw.pdf** |  |  |  |
| pdfjs-hwa | 34 / 0 | 28 / 0 | 25 / 3 |
| pdfjs-hwa-renderer | 24 / 0 | 34 / 0 | 24 / 1 |
