# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-10-27T17:14:26.081Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=transfer-transfer-r2- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2853 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 98.8 | 101.3 | 96.9 |
| bunka-kokugo-series-019-p4.pdf | 167.1 | 183.1 | 184.2 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 75.3 | 74.1 | 66.2 |
| bunka-kokugo-series-019-p4.pdf | 161.8 | 157.8 | 160.5 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 84.8 / 100.7 | 98.4 / 119.9 | 99.6 / 117.0 |
| bunka-kokugo-series-019-p4.pdf | 167.1 / 170.9 | 183.1 / 316.3 | 184.2 / 185.4 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 39 | 4 | 6 |
| bunka-kokugo-series-019-p4.pdf | 23 | 1 | 3 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 9.5 / 13.5 | 1.2 / 5.6 | 1.8 / 5.0 |
| bunka-kokugo-series-019-p4.pdf | 2.0 / 25.3 | 1.4 / 2.6 | 1.2 / 4.1 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 129 + 3 | 156 + 4 | 156 + 4 |
| bunka-kokugo-series-019-p4.pdf | 124 + 3 | 174 + 3 | 159 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — |

