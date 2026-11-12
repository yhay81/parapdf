# ParaPDF engine benchmark across browsers

Each browser's full report: [Chromium 156.0.8078.4](mesh-controls-chromium.md) (2026-11-12T14:25:40.340Z), [WebKit 27.2](mesh-controls-webkit.md) (2026-11-12T14:27:00.561Z), [Firefox 157.0](mesh-controls-firefox.md) (2026-11-12T14:30:16.035Z).

- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores)
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-webgpu` requests GPU rasterization of mesh shadings. The fidelity run counts actual GPU draws.
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: power AC; on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms.
- WebKit 27.2: power AC; on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms.
- Firefox 157.0: power AC; on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms.
- Method: the per-browser method on the same 2 files; "median across files" takes the median of each file's median. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls.

## Errors and renderer-worker fallbacks

None.

## First page committed to the canvas, cold (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 44.0 | 49.0 | 71.2 |
| pdfjs-hwa-webgpu | 44.0 | 52.8 | 71.3 |

## Per-page visible p50 (ms): median across files

Includes two animation frames after the commit.

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 58.8 | 62.6 | 68.5 |
| pdfjs-hwa-webgpu | 58.7 | 62.6 | 67.0 |

## Main thread blocked while rendering (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 8 | 0 | 27 |
| pdfjs-hwa-webgpu | 9 | 1 | 26 |

## Event-loop lag max (ms): median across files

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa | 9.4 | 5.2 | 14.2 |
| pdfjs-hwa-webgpu | 9.2 | 5.3 | 13.4 |

## Selected files: first page committed (ms) / main thread blocked (ms)

| Engine | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| **bill-hr815.pdf** |  |  |  |
| pdfjs-hwa | 53 / 16 | 41 / 1 | 80 / 34 |
| pdfjs-hwa-webgpu | 53 / 18 | 48 / 1 | 82 / 36 |
| **patent-us223898.pdf** |  |  |  |
| pdfjs-hwa | 35 / 0 | 57 / 0 | 63 / 19 |
| pdfjs-hwa-webgpu | 35 / 0 | 57 / 0 | 61 / 17 |
