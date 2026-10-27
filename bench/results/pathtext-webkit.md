# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-10-27T16:42:20.098Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.9 ms late (median) / 5.4 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit ENGINES=pdfjs-hwa,pdfjs-hwa-pathtext OUTPUT=pathtext- pnpm bench`

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
| bill-hr815.pdf | 114.8 | 116.4 |
| mhlw-doc.pdf | 99.9 | 118.1 |
| bunka-kokugo-series-019-p4.pdf | 149.6 | 183.2 |
| f1040.pdf | 116.3 | 132.5 |
| usrguide.pdf | 99.6 | 100.1 |
| synthetic-text-1000.pdf | 49.8 | 65.0 |
| synthetic-cjk-nonembedded.pdf | 115.1 | 116.5 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 54.4 | 69.0 |
| mhlw-doc.pdf | 78.0 | 88.7 |
| bunka-kokugo-series-019-p4.pdf | 118.7 | 152.9 |
| f1040.pdf | 87.8 | 102.4 |
| usrguide.pdf | 73.5 | 78.6 |
| synthetic-text-1000.pdf | 22.5 | 41.4 |
| synthetic-cjk-nonembedded.pdf | 98.4 | 93.9 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 50.0 / 114.8 | 50.1 / 116.4 |
| mhlw-doc.pdf | 50.7 / 118.2 | 50.0 / 118.2 |
| bunka-kokugo-series-019-p4.pdf | 149.6 / 216.5 | 183.2 / 184.7 |
| f1040.pdf | 51.5 / 116.4 | 50.7 / 148.5 |
| usrguide.pdf | 50.0 / 99.6 | 50.1 / 100.1 |
| synthetic-text-1000.pdf | 50.0 / 51.7 | 50.1 / 65.0 |
| synthetic-cjk-nonembedded.pdf | 115.1 / 135.1 | 116.5 / 117.5 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 3 | 7 |
| mhlw-doc.pdf | 2 | 1 |
| bunka-kokugo-series-019-p4.pdf | 0 | 0 |
| f1040.pdf | 6 | 5 |
| usrguide.pdf | 3 | 10 |
| synthetic-text-1000.pdf | 1 | 7 |
| synthetic-cjk-nonembedded.pdf | 15 | 16 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 5.6 / 6.3 | 5.9 / 8.1 |
| mhlw-doc.pdf | 5.9 / 6.5 | 5.4 / 6.4 |
| bunka-kokugo-series-019-p4.pdf | 5.6 / 5.7 | 5.4 / 6.0 |
| f1040.pdf | 6.7 / 8.5 | 7.7 / 8.4 |
| usrguide.pdf | 5.7 / 7.4 | 6.0 / 9.9 |
| synthetic-text-1000.pdf | 5.6 / 6.2 | 6.9 / 9.3 |
| synthetic-cjk-nonembedded.pdf | 18.4 / 19.7 | 21.6 / 21.6 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-pathtext |
|---|---:|---:|
| bill-hr815.pdf | 88 + 5 | 103 + 6 |
| mhlw-doc.pdf | 94 + 8 | 87 + 7 |
| bunka-kokugo-series-019-p4.pdf | 91 + 6 | 88 + 5 |
| f1040.pdf | 88 + 7 | 87 + 7 |
| usrguide.pdf | 160 + 17 | 123 + 18 |
| synthetic-text-1000.pdf | 90 + 64 | 91 + 62 |
| synthetic-cjk-nonembedded.pdf | 99 + 6 | 108 + 7 |

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

