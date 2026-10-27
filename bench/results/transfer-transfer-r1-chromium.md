# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-27T17:02:20.910Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=transfer-transfer-r1- pnpm bench`

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
| patent-us223898.pdf | 83.2 | 116.3 | 66.7 |
| bunka-kokugo-series-019-p4.pdf | 165.8 | 233.3 | 149.9 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 52.1 | 105.5 | 48.5 |
| bunka-kokugo-series-019-p4.pdf | 134.1 | 215.1 | 121.6 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 83.2 / 150.1 | 116.3 / 200.0 | 83.3 / 566.7 |
| bunka-kokugo-series-019-p4.pdf | 165.8 / 183.3 | 233.3 / 283.5 | 149.9 / 150.0 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 0 | 7 | 0 |
| bunka-kokugo-series-019-p4.pdf | 0 | 4 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 1.1 / 1.9 | 1.3 / 7.1 | 1.2 / 2.2 |
| bunka-kokugo-series-019-p4.pdf | 1.2 / 1.4 | 1.3 / 6.0 | 1.4 / 1.5 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 126 + 3 | 218 + 5 | 111 + 4 |
| bunka-kokugo-series-019-p4.pdf | 118 + 4 | 192 + 5 | 152 + 5 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — |

