# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-27T16:40:29.320Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.3 ms (p95), and animation frames arrive every 16.7 ms. The run waited once (1 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs-hwa,pdfjs-hwa-pathtext OUTPUT=pathtext- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 83.0 | 66.5 |
| mhlw-doc.pdf | 83.2 | 99.9 |
| bunka-kokugo-series-019-p4.pdf | 150.5 | 150.0 |
| f1040.pdf | 99.9 | 99.5 |
| usrguide.pdf | 82.8 | 83.3 |
| synthetic-text-1000.pdf | 49.6 | 66.6 |
| synthetic-cjk-nonembedded.pdf | 100.0 | 116.6 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 54.6 | 43.0 |
| mhlw-doc.pdf | 60.8 | 74.0 |
| bunka-kokugo-series-019-p4.pdf | 118.3 | 117.4 |
| f1040.pdf | 71.1 | 73.6 |
| usrguide.pdf | 54.5 | 54.8 |
| synthetic-text-1000.pdf | 20.4 | 38.4 |
| synthetic-cjk-nonembedded.pdf | 77.5 | 91.1 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 50.0 / 83.0 | 50.0 / 66.5 |
| mhlw-doc.pdf | 50.0 / 83.4 | 50.3 / 99.9 |
| bunka-kokugo-series-019-p4.pdf | 150.5 / 166.6 | 150.0 / 166.5 |
| f1040.pdf | 50.1 / 117.0 | 50.4 / 99.8 |
| usrguide.pdf | 50.0 / 82.8 | 50.0 / 83.3 |
| synthetic-text-1000.pdf | 50.0 / 51.5 | 50.0 / 66.6 |
| synthetic-cjk-nonembedded.pdf | 100.0 / 116.8 | 116.6 / 116.7 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 18 | 8 |
| mhlw-doc.pdf | 24 | 6 |
| bunka-kokugo-series-019-p4.pdf | 0 | 0 |
| f1040.pdf | 29 | 14 |
| usrguide.pdf | 27 | 4 |
| synthetic-text-1000.pdf | 8 | 11 |
| synthetic-cjk-nonembedded.pdf | 27 | 24 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 1.3 / 18.8 | 1.4 / 7.2 |
| mhlw-doc.pdf | 2.1 / 25.8 | 1.3 / 7.7 |
| bunka-kokugo-series-019-p4.pdf | 1.3 / 1.6 | 1.1 / 1.4 |
| f1040.pdf | 9.8 / 12.5 | 6.8 / 8.1 |
| usrguide.pdf | 3.2 / 10.8 | 1.5 / 4.5 |
| synthetic-text-1000.pdf | 1.8 / 6.5 | 2.2 / 6.4 |
| synthetic-cjk-nonembedded.pdf | 26.1 / 29.0 | 1.7 / 25.6 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 85 + 4 | 81 + 4 |
| mhlw-doc.pdf | 88 + 5 | 92 + 5 |
| bunka-kokugo-series-019-p4.pdf | 93 + 4 | 88 + 4 |
| f1040.pdf | 92 + 6 | 97 + 6 |
| usrguide.pdf | 82 + 8 | 108 + 8 |
| synthetic-text-1000.pdf | 97 + 58 | 107 + 71 |
| synthetic-cjk-nonembedded.pdf | 101 + 4 | 110 + 4 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | — | — |
| mhlw-doc.pdf | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — |
| f1040.pdf | — | — |
| usrguide.pdf | — | — |
| synthetic-text-1000.pdf | — | — |
| synthetic-cjk-nonembedded.pdf | — | — |

