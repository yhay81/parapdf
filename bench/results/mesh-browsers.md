# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](mesh-chromium.md) (2026-11-12T14:22:01.903Z), [WebKit 27.2](mesh-webkit.md) (2026-11-12T14:23:01.215Z), [Firefox 157.0](mesh-firefox.md) (2026-11-12T14:24:55.038Z).

- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.6 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Failures and fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 41.4 | 38.2 | 50.8 |
| pdfjs-hwa-webgpu | 18.0 | 23.3 | 50.8 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 49.8 | 69.3 | 60.5 |
| pdfjs-hwa-webgpu | 50.0 | 55.5 | 60.8 |

## Main thread blocked while rendering 10 pages (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 21 | 17 | 32 |
| pdfjs-hwa-webgpu | 0 | 2 | 32 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 23.4 | 21.8 | 33.3 |
| pdfjs-hwa-webgpu | 1.1 | 6.7 | 32.6 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **f1040.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-hwa-webgpu | — | — | — |
| **bunka-kokugo-series-019-p4.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-hwa-webgpu | — | — | — |
| **synthetic-cjk-nonembedded.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-hwa-webgpu | — | — | — |
| **synthetic-vector-200k.pdf** |  |  |  |
| pdfjs-hwa | — | — | — |
| pdfjs-hwa-webgpu | — | — | — |

