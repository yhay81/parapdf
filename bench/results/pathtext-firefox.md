# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-10-27T16:44:04.532Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.5 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs-hwa,pdfjs-hwa-pathtext OUTPUT=pathtext- pnpm bench`

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
| bill-hr815.pdf | 101.7 | 113.8 |
| mhlw-doc.pdf | 117.4 | 102.3 |
| bunka-kokugo-series-019-p4.pdf | 155.1 | 196.8 |
| f1040.pdf | 129.0 | 133.5 |
| usrguide.pdf | 85.7 | 88.1 |
| synthetic-text-1000.pdf | 48.7 | 71.4 |
| synthetic-cjk-nonembedded.pdf | 80.3 | 99.4 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 82.4 | 98.6 |
| mhlw-doc.pdf | 101.1 | 85.7 |
| bunka-kokugo-series-019-p4.pdf | 149.9 | 195.7 |
| f1040.pdf | 104.1 | 101.5 |
| usrguide.pdf | 66.2 | 62.9 |
| synthetic-text-1000.pdf | 29.4 | 43.2 |
| synthetic-cjk-nonembedded.pdf | 63.3 | 70.4 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 50.3 / 101.7 | 53.6 / 113.8 |
| mhlw-doc.pdf | 49.2 / 137.5 | 55.8 / 114.6 |
| bunka-kokugo-series-019-p4.pdf | 155.1 / 167.9 | 196.8 / 212.7 |
| f1040.pdf | 71.1 / 129.8 | 65.0 / 139.3 |
| usrguide.pdf | 50.4 / 85.7 | 51.2 / 88.1 |
| synthetic-text-1000.pdf | 49.9 / 55.7 | 59.5 / 71.4 |
| synthetic-cjk-nonembedded.pdf | 80.3 / 96.2 | 99.4 / 104.4 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 48 | 106 |
| mhlw-doc.pdf | 40 | 35 |
| bunka-kokugo-series-019-p4.pdf | 24 | 29 |
| f1040.pdf | 53 | 49 |
| usrguide.pdf | 49 | 58 |
| synthetic-text-1000.pdf | 36 | 118 |
| synthetic-cjk-nonembedded.pdf | 13 | 14 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 5.3 / 17.5 | 14.3 / 17.7 |
| mhlw-doc.pdf | 12.5 / 14.3 | 14.8 / 15.1 |
| bunka-kokugo-series-019-p4.pdf | 3.5 / 24.9 | 3.4 / 29.3 |
| f1040.pdf | 16.6 / 18.5 | 13.5 / 15.7 |
| usrguide.pdf | 7.1 / 17.2 | 8.8 / 12.2 |
| synthetic-text-1000.pdf | 5.6 / 14.9 | 14.5 / 16.0 |
| synthetic-cjk-nonembedded.pdf | 13.3 / 13.3 | 15.3 / 15.3 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 120 + 3 | 158 + 6 |
| mhlw-doc.pdf | 123 + 5 | 132 + 5 |
| bunka-kokugo-series-019-p4.pdf | 126 + 3 | 135 + 3 |
| f1040.pdf | 124 + 5 | 127 + 5 |
| usrguide.pdf | 126 + 7 | 132 + 7 |
| synthetic-text-1000.pdf | 128 + 87 | 124 + 89 |
| synthetic-cjk-nonembedded.pdf | 127 + 3 | 138 + 3 |

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

