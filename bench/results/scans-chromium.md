# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-27T16:50:30.101Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs,pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=scans- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 83.3 | 83.2 | 116.6 | 100.0 |
| bunka-kokugo-series-019-p4.pdf | 149.9 | 133.4 | 249.8 | 232.9 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 53.6 | 51.5 | 100.4 | 78.1 |
| bunka-kokugo-series-019-p4.pdf | 125.3 | 100.7 | 233.6 | 206.9 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 82.7 / 516.8 | 67.3 / 133.4 | 116.6 / 166.6 | 99.9 / 150.0 |
| bunka-kokugo-series-019-p4.pdf | 149.9 / 199.9 | 133.4 / 150.1 | 249.8 / 249.9 | 232.9 / 233.2 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 4 | 1 | 109 | 74 |
| bunka-kokugo-series-019-p4.pdf | 10 | 0 | 81 | 73 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 1.3 / 3.8 | 1.3 / 2.5 | 7.1 / 32.6 | 14.3 / 25.9 |
| bunka-kokugo-series-019-p4.pdf | 5.4 / 7.6 | 1.2 / 1.4 | 1.4 / 77.6 | 1.4 / 75.4 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 89 + 3 | 93 + 4 | 128 + 4 | 106 + 4 |
| bunka-kokugo-series-019-p4.pdf | 97 + 4 | 86 + 3 | 119 + 4 | 114 + 4 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | — | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — | — |

