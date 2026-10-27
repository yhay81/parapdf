# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-10-27T17:05:54.368Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.8 ms (p95), and animation frames arrive every 16.6 ms. The run waited once (1 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit ENGINES=pdfjs-hwa,pdfjs-next,pdfjs-next-hwa OUTPUT=transfer-orig-r1- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.6 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 99.9 | 149.7 | 299.5 |
| bunka-kokugo-series-019-p4.pdf | 134.2 | 283.2 | 350.0 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 68.5 | 130.3 | 278.7 |
| bunka-kokugo-series-019-p4.pdf | 102.3 | 255.9 | 332.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 84.3 / 116.6 | 105.7 / 165.6 | 149.8 / 338.3 |
| bunka-kokugo-series-019-p4.pdf | 134.2 / 217.1 | 283.2 / 369.1 | 350.0 / 415.6 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 0 | 70 | 79 |
| bunka-kokugo-series-019-p4.pdf | 0 | 68 | 77 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 4.9 / 5.0 | 13.6 / 42.3 | 6.2 / 53.2 |
| bunka-kokugo-series-019-p4.pdf | 4.9 / 5.0 | 4.8 / 72.7 | 4.8 / 82.0 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | 86 + 5 | 111 + 6 | 134 + 7 |
| bunka-kokugo-series-019-p4.pdf | 86 + 5 | 114 + 6 | 133 + 7 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---:|---:|---:|
| patent-us223898.pdf | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — |

