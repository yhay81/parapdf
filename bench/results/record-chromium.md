# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-24T02:58:58.392Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.5 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs-hwa,pdfjs-hwa-record OUTPUT=record- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 83.3 | 83.3 |
| bunka-kokugo-series-019-p4.pdf | 116.7 | 117.5 |
| f1040.pdf | 83.3 | 83.3 |
| mhlw-doc.pdf | 84.2 | 98.2 |
| nics-background-checks-2015-11.pdf | 66.6 | 66.6 |
| patent-us223898.pdf | 66.6 | 66.3 |
| pdfium-jpx-lzw.pdf | 49.3 | 49.1 |
| pdfium-smask-blend.pdf | 49.5 | 50.0 |
| pdfium-type3.pdf | 50.8 | 49.9 |
| synthetic-cjk-nonembedded.pdf | 83.2 | 83.3 |
| synthetic-text-1000.pdf | 49.6 | 49.9 |
| synthetic-vector-200k.pdf | 99.8 | 100.2 |
| usrguide.pdf | 67.1 | 66.9 |
| wdl6812-manuscript.pdf | 83.3 | 83.3 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 51.8 | 55.7 |
| bunka-kokugo-series-019-p4.pdf | 84.1 | 84.3 |
| f1040.pdf | 56.3 | 61.7 |
| mhlw-doc.pdf | 53.9 | 67.7 |
| nics-background-checks-2015-11.pdf | 40.6 | 48.4 |
| patent-us223898.pdf | 33.0 | 35.8 |
| pdfium-jpx-lzw.pdf | 17.7 | 17.1 |
| pdfium-smask-blend.pdf | 17.4 | 18.1 |
| pdfium-type3.pdf | 17.3 | 17.7 |
| synthetic-cjk-nonembedded.pdf | 54.6 | 55.8 |
| synthetic-text-1000.pdf | 20.0 | 24.0 |
| synthetic-vector-200k.pdf | 68.6 | 68.4 |
| usrguide.pdf | 37.9 | 40.9 |
| wdl6812-manuscript.pdf | 50.5 | 50.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 50.0 / 83.3 | 50.0 / 83.3 |
| bunka-kokugo-series-019-p4.pdf | 116.7 / 118.3 | 117.5 / 117.5 |
| f1040.pdf | 51.3 / 99.6 | 50.5 / 84.7 |
| mhlw-doc.pdf | 49.6 / 84.3 | 50.1 / 98.8 |
| nics-background-checks-2015-11.pdf | 66.6 / 83.3 | 66.6 / 66.6 |
| patent-us223898.pdf | 66.7 / 134.7 | 68.6 / 167.7 |
| pdfium-jpx-lzw.pdf | 49.3 / 50.1 | 49.1 / 50.3 |
| pdfium-smask-blend.pdf | 49.5 / 51.0 | 50.0 / 50.7 |
| pdfium-type3.pdf | 50.8 / 51.7 | 49.9 / 49.9 |
| synthetic-cjk-nonembedded.pdf | 83.2 / 84.7 | 83.3 / 83.3 |
| synthetic-text-1000.pdf | 50.0 / 51.9 | 49.9 / 51.6 |
| synthetic-vector-200k.pdf | 99.8 / 100.2 | 100.2 / 100.7 |
| usrguide.pdf | 50.0 / 67.1 | 50.0 / 66.9 |
| wdl6812-manuscript.pdf | 68.0 / 83.7 | 66.9 / 83.7 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 27 | 31 |
| bunka-kokugo-series-019-p4.pdf | 0 | 0 |
| f1040.pdf | 27 | 38 |
| mhlw-doc.pdf | 25 | 30 |
| nics-background-checks-2015-11.pdf | 10 | 17 |
| patent-us223898.pdf | 0 | 61 |
| pdfium-jpx-lzw.pdf | 0 | 0 |
| pdfium-smask-blend.pdf | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 22 | 22 |
| synthetic-text-1000.pdf | 8 | 45 |
| synthetic-vector-200k.pdf | 2 | 4 |
| usrguide.pdf | 23 | 40 |
| wdl6812-manuscript.pdf | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 2.0 / 18.8 | 3.1 / 20.0 |
| bunka-kokugo-series-019-p4.pdf | 1.5 / 1.9 | 1.4 / 1.9 |
| f1040.pdf | 9.4 / 16.0 | 15.3 / 20.0 |
| mhlw-doc.pdf | 8.8 / 15.9 | 5.5 / 22.3 |
| nics-background-checks-2015-11.pdf | 11.8 / 11.8 | 19.4 / 19.4 |
| patent-us223898.pdf | 1.2 / 1.7 | 11.8 / 15.2 |
| pdfium-jpx-lzw.pdf | 1.6 / 1.6 | 1.3 / 1.3 |
| pdfium-smask-blend.pdf | 1.4 / 1.4 | 1.3 / 1.3 |
| pdfium-type3.pdf | 1.6 / 1.6 | 1.9 / 1.9 |
| synthetic-cjk-nonembedded.pdf | 23.5 / 23.5 | 23.9 / 23.9 |
| synthetic-text-1000.pdf | 1.8 / 5.4 | 6.9 / 10.7 |
| synthetic-vector-200k.pdf | 1.5 / 3.5 | 2.7 / 5.4 |
| usrguide.pdf | 2.9 / 12.7 | 6.0 / 14.8 |
| wdl6812-manuscript.pdf | 1.5 / 1.5 | 1.5 / 1.7 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | 101 + 3 | 78 + 3 |
| bunka-kokugo-series-019-p4.pdf | 82 + 3 | 82 + 3 |
| f1040.pdf | 87 + 5 | 85 + 5 |
| mhlw-doc.pdf | 87 + 4 | 78 + 5 |
| nics-background-checks-2015-11.pdf | 83 + 3 | 83 + 2 |
| patent-us223898.pdf | 86 + 3 | 92 + 3 |
| pdfium-jpx-lzw.pdf | 102 + 3 | 96 + 3 |
| pdfium-smask-blend.pdf | 77 + 3 | 77 + 3 |
| pdfium-type3.pdf | 85 + 3 | 100 + 2 |
| synthetic-cjk-nonembedded.pdf | 87 + 3 | 82 + 3 |
| synthetic-text-1000.pdf | 77 + 51 | 86 + 50 |
| synthetic-vector-200k.pdf | 96 + 3 | 76 + 3 |
| usrguide.pdf | 86 + 6 | 95 + 6 |
| wdl6812-manuscript.pdf | 78 + 3 | 104 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-record |
|---|---:|---:|
| bill-hr815.pdf | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — |
| f1040.pdf | — | — |
| mhlw-doc.pdf | — | — |
| nics-background-checks-2015-11.pdf | — | — |
| patent-us223898.pdf | — | — |
| pdfium-jpx-lzw.pdf | — | — |
| pdfium-smask-blend.pdf | — | — |
| pdfium-type3.pdf | — | — |
| synthetic-cjk-nonembedded.pdf | — | — |
| synthetic-text-1000.pdf | — | — |
| synthetic-vector-200k.pdf | — | — |
| usrguide.pdf | — | — |
| wdl6812-manuscript.pdf | — | — |

