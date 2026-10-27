# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-10-27T16:51:44.417Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.9 ms late (median) / 5.5 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit ENGINES=pdfjs,pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=scans- pnpm bench`

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
| patent-us223898.pdf | 131.9 | 100.1 | 150.0 | 171.9 |
| bunka-kokugo-series-019-p4.pdf | 216.1 | 183.3 | 344.0 | 381.4 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 100.4 | 68.4 | 118.2 | 154.0 |
| bunka-kokugo-series-019-p4.pdf | 186.4 | 150.7 | 302.8 | 350.6 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 100.0 / 149.0 | 99.6 / 101.6 | 100.1 / 182.8 | 116.7 / 184.9 |
| bunka-kokugo-series-019-p4.pdf | 216.1 / 232.1 | 183.3 / 201.5 | 344.0 / 356.6 | 381.4 / 384.1 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 1 | 0 | 45 | 40 |
| bunka-kokugo-series-019-p4.pdf | 43 | 0 | 81 | 79 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 5.5 / 6.0 | 5.1 / 5.8 | 13.0 / 37.4 | 6.8 / 34.1 |
| bunka-kokugo-series-019-p4.pdf | 5.8 / 48.4 | 5.1 / 5.7 | 5.5 / 86.5 | 5.6 / 83.3 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | 102 + 5 | 99 + 6 | 114 + 5 | 122 + 6 |
| bunka-kokugo-series-019-p4.pdf | 92 + 6 | 96 + 6 | 141 + 6 | 131 + 6 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|---:|
| patent-us223898.pdf | — | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — | — |

