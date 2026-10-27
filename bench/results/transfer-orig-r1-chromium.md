# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-27T17:01:08.072Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=transfer-orig-r1- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 100.3 | 166.5 | 132.6 |
| bunka-kokugo-series-019-p4.pdf | 182.9 | 300.1 | 333.2 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 71.0 | 154.0 | 105.2 |
| bunka-kokugo-series-019-p4.pdf | 150.7 | 281.2 | 303.9 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 83.8 / 367.6 | 116.8 / 167.1 | 100.9 / 166.7 |
| bunka-kokugo-series-019-p4.pdf | 182.9 / 183.2 | 300.1 / 450.0 | 333.2 / 334.1 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 1 | 143 | 120 |
| bunka-kokugo-series-019-p4.pdf | 0 | 124 | 141 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 1.3 / 2.8 | 10.7 / 69.1 | 1.4 / 59.5 |
| bunka-kokugo-series-019-p4.pdf | 1.3 / 1.5 | 2.0 / 122.0 | 1.2 / 142.6 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 129 + 4 | 137 + 4 | 117 + 4 |
| bunka-kokugo-series-019-p4.pdf | 142 + 4 | 166 + 5 | 172 + 5 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — |

