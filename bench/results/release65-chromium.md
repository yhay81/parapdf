# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-11-12T14:11:27.456Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing, -renderer enables the drawing worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium FILES=patent-us223898.pdf,bill-hr815.pdf,pdfium-jpx-lzw.pdf PAGES=2 RUNS=3 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-renderer OUTPUT=release65- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1677 KiB | 500 KiB | 411 KiB |
| pdfjs renderer | 1 | 119 KiB | 35 KiB | 31 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 66.6 | 84.1 |
| bill-hr815.pdf | 83.3 | 83.3 |
| pdfium-jpx-lzw.pdf | 66.6 | 50.0 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 34.3 | 63.2 |
| bill-hr815.pdf | 53.0 | 54.6 |
| pdfium-jpx-lzw.pdf | 34.2 | 24.0 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 66.5 / 66.8 | 83.3 / 100.0 |
| bill-hr815.pdf | 50.7 / 84.0 | 50.1 / 83.8 |
| pdfium-jpx-lzw.pdf | 66.6 / 67.3 | 50.0 / 50.4 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 0 | 32 |
| bill-hr815.pdf | 15 | 0 |
| pdfium-jpx-lzw.pdf | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 1.2 / 2.1 | 17.6 / 18.8 |
| bill-hr815.pdf | 2.3 / 16.6 | 1.3 / 1.5 |
| pdfium-jpx-lzw.pdf | 1.3 / 1.3 | 1.7 / 1.7 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 106 + 3 | 103 + 3 |
| bill-hr815.pdf | 105 + 3 | 104 + 4 |
| pdfium-jpx-lzw.pdf | 101 + 2 | 78 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | — | — |
| bill-hr815.pdf | — | — |
| pdfium-jpx-lzw.pdf | — | — |
