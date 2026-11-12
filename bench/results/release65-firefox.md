# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-11-12T14:15:34.988Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing, -renderer enables the drawing worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox FILES=patent-us223898.pdf,bill-hr815.pdf,pdfium-jpx-lzw.pdf PAGES=2 RUNS=3 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-renderer OUTPUT=release65- pnpm bench`

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
| patent-us223898.pdf | 82.6 | 74.8 |
| bill-hr815.pdf | 96.3 | 98.5 |
| pdfium-jpx-lzw.pdf | 54.9 | 47.2 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 60.1 | 49.9 |
| bill-hr815.pdf | 72.8 | 74.4 |
| pdfium-jpx-lzw.pdf | 25.3 | 24.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 82.7 / 97.9 | 94.1 / 129.3 |
| bill-hr815.pdf | 50.5 / 98.1 | 71.5 / 98.8 |
| pdfium-jpx-lzw.pdf | 54.9 / 63.9 | 47.2 / 55.8 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 14 | 5 |
| bill-hr815.pdf | 31 | 4 |
| pdfium-jpx-lzw.pdf | 3 | 1 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 7.3 / 11.6 | 3.2 / 3.9 |
| bill-hr815.pdf | 13.0 / 15.3 | 3.0 / 5.9 |
| pdfium-jpx-lzw.pdf | 4.1 / 4.1 | 3.2 / 3.2 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 115 + 3 | 140 + 3 |
| bill-hr815.pdf | 144 + 3 | 144 + 3 |
| pdfium-jpx-lzw.pdf | 146 + 2 | 145 + 2 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | — | — |
| bill-hr815.pdf | — | — |
| pdfium-jpx-lzw.pdf | — | — |
