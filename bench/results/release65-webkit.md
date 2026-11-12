# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-11-12T14:13:13.174Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing, -renderer enables the drawing worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit FILES=patent-us223898.pdf,bill-hr815.pdf,pdfium-jpx-lzw.pdf PAGES=2 RUNS=3 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-renderer OUTPUT=release65- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1677 KiB | 500 KiB | 411 KiB |
| pdfjs renderer | 1 | 119 KiB | 35 KiB | 31 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 13.9 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 83.6 | 111.1 |
| bill-hr815.pdf | 83.4 | 110.0 |
| pdfium-jpx-lzw.pdf | 55.8 | 55.5 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 57.5 | 85.6 |
| bill-hr815.pdf | 35.3 | 85.4 |
| pdfium-jpx-lzw.pdf | 28.3 | 33.9 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 83.3 / 97.2 | 97.2 / 138.9 |
| bill-hr815.pdf | 41.8 / 97.2 | 42.6 / 111.0 |
| pdfium-jpx-lzw.pdf | 55.8 / 55.8 | 55.5 / 55.7 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 0 | 18 |
| bill-hr815.pdf | 1 | 0 |
| pdfium-jpx-lzw.pdf | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 4.9 / 5.0 | 12.0 / 16.3 |
| bill-hr815.pdf | 4.9 / 5.5 | 4.8 / 5.0 |
| pdfium-jpx-lzw.pdf | 4.5 / 4.5 | 4.7 / 4.7 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | 104 + 4 | 107 + 5 |
| bill-hr815.pdf | 111 + 5 | 107 + 6 |
| pdfium-jpx-lzw.pdf | 109 + 4 | 109 + 4 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-renderer |
|---|---:|---:|
| patent-us223898.pdf | — | — |
| bill-hr815.pdf | — | — |
| pdfium-jpx-lzw.pdf | — | — |
