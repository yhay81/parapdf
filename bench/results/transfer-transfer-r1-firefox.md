# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-10-27T17:12:11.980Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=transfer-transfer-r1- pnpm bench`

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
| patent-us223898.pdf | 190.0 | 101.7 | 84.8 |
| bunka-kokugo-series-019-p4.pdf | 166.1 | 181.1 | 182.4 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 163.3 | 72.4 | 64.6 |
| bunka-kokugo-series-019-p4.pdf | 160.4 | 153.7 | 156.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 101.0 / 247.0 | 132.4 / 552.0 | 98.2 / 116.8 |
| bunka-kokugo-series-019-p4.pdf | 166.1 / 199.5 | 181.1 / 185.4 | 182.4 / 199.1 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 59 | 39 | 4 |
| bunka-kokugo-series-019-p4.pdf | 26 | 1 | 1 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 12.2 / 17.8 | 4.3 / 16.8 | 1.9 / 4.1 |
| bunka-kokugo-series-019-p4.pdf | 1.4 / 28.1 | 1.2 / 2.5 | 1.1 / 2.8 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 252 + 7 | 170 + 4 | 162 + 4 |
| bunka-kokugo-series-019-p4.pdf | 128 + 3 | 150 + 3 | 160 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — |

