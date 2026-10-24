# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-24T02:05:05.138Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 5 times (40 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-frame` variants draw into an OffscreenCanvas instead of the displayed canvas and show the finished page as an ImageBitmap through a `bitmaprenderer` context.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs,pdfjs-frame,pdfjs-hwa,pdfjs-hwa-frame,pdfjs-next,pdfjs-next-frame,pdfjs-next-hwa,pdfjs-next-hwa-frame OUTPUT=frames- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 83.3 | 83.3 | 83.2 | 83.2 | 83.3 | 82.2 | 83.3 | 83.3 |
| bunka-kokugo-series-019-p4.pdf | 117.5 | 133.9 | 116.4 | 116.6 | 199.3 | 200.2 | 233.3 | 200.5 |
| f1040.pdf | 100.0 | 83.4 | 83.4 | 83.2 | 99.9 | 99.9 | 100.0 | 99.9 |
| mhlw-doc.pdf | 83.2 | 83.2 | 99.9 | 83.2 | 99.9 | 100.0 | 100.3 | 100.1 |
| nics-background-checks-2015-11.pdf | 83.3 | 83.3 | 84.6 | 84.0 | 84.0 | 83.5 | 83.3 | 83.6 |
| patent-us223898.pdf | 67.2 | 83.4 | 66.5 | 66.6 | 116.3 | 99.2 | 83.3 | 83.5 |
| pdfium-jpx-lzw.pdf | 49.6 | 50.0 | 49.6 | 49.9 | 66.7 | 49.7 | 49.4 | 50.0 |
| pdfium-smask-blend.pdf | 49.9 | 49.9 | 50.0 | 49.2 | 50.7 | 50.4 | 50.5 | 49.6 |
| pdfium-type3.pdf | 49.9 | 49.9 | 49.9 | 50.4 | 50.2 | 50.7 | 49.9 | 49.8 |
| synthetic-cjk-nonembedded.pdf | 99.0 | 84.2 | 99.3 | 83.2 | 100.0 | 99.8 | 100.0 | 100.0 |
| synthetic-text-1000.pdf | 49.3 | 50.0 | 50.3 | 50.6 | 49.9 | 49.9 | 50.5 | 49.5 |
| synthetic-vector-200k.pdf | 100.3 | 116.2 | 100.3 | 99.7 | 133.3 | 149.9 | 99.1 | 100.4 |
| usrguide.pdf | 67.6 | 66.1 | 65.7 | 66.2 | 66.2 | 68.3 | 66.7 | 67.0 |
| wdl6812-manuscript.pdf | 83.3 | 83.3 | 83.3 | 83.3 | 83.3 | 83.3 | 83.3 | 83.3 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 63.8 | 67.4 | 53.7 | 53.2 | 70.9 | 66.5 | 55.0 | 54.4 |
| bunka-kokugo-series-019-p4.pdf | 90.7 | 116.7 | 84.1 | 84.3 | 173.9 | 171.8 | 214.8 | 174.4 |
| f1040.pdf | 67.8 | 73.1 | 56.4 | 71.9 | 86.3 | 82.5 | 74.5 | 75.8 |
| mhlw-doc.pdf | 60.8 | 80.3 | 70.2 | 76.0 | 88.2 | 84.2 | 81.8 | 81.1 |
| nics-background-checks-2015-11.pdf | 52.5 | 64.6 | 52.2 | 61.7 | 69.3 | 66.9 | 54.2 | 57.5 |
| patent-us223898.pdf | 36.0 | 66.1 | 35.1 | 34.3 | 91.8 | 76.6 | 64.0 | 64.2 |
| pdfium-jpx-lzw.pdf | 17.0 | 18.2 | 16.9 | 16.6 | 47.0 | 35.8 | 24.7 | 25.1 |
| pdfium-smask-blend.pdf | 17.4 | 17.8 | 17.5 | 17.6 | 21.9 | 19.7 | 21.8 | 18.4 |
| pdfium-type3.pdf | 17.5 | 17.3 | 16.8 | 17.8 | 21.6 | 19.1 | 17.7 | 18.2 |
| synthetic-cjk-nonembedded.pdf | 74.8 | 58.5 | 72.7 | 57.1 | 81.6 | 77.6 | 74.6 | 74.7 |
| synthetic-text-1000.pdf | 20.7 | 25.5 | 20.9 | 24.3 | 33.4 | 29.1 | 25.6 | 26.4 |
| synthetic-vector-200k.pdf | 70.8 | 99.8 | 68.3 | 68.9 | 113.6 | 129.9 | 72.0 | 70.2 |
| usrguide.pdf | 38.2 | 47.1 | 37.7 | 46.7 | 53.6 | 55.0 | 47.9 | 47.1 |
| wdl6812-manuscript.pdf | 50.7 | 64.7 | 51.6 | 49.2 | 62.3 | 63.5 | 53.4 | 53.5 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.0 / 83.3 | 50.0 / 83.3 | 50.0 / 83.2 | 50.0 / 83.2 | 50.0 / 83.3 | 50.0 / 82.2 | 50.0 / 83.3 | 50.0 / 83.3 |
| bunka-kokugo-series-019-p4.pdf | 117.5 / 149.8 | 133.9 / 133.9 | 116.4 / 116.6 | 116.6 / 117.2 | 199.3 / 199.9 | 200.2 / 216.0 | 233.3 / 266.5 | 200.5 / 216.4 |
| f1040.pdf | 50.0 / 100.9 | 50.0 / 84.1 | 50.0 / 83.4 | 50.7 / 83.2 | 66.6 / 166.5 | 67.1 / 100.9 | 50.0 / 100.6 | 50.7 / 99.9 |
| mhlw-doc.pdf | 50.8 / 115.8 | 50.0 / 84.3 | 49.9 / 100.0 | 50.0 / 83.2 | 50.9 / 116.8 | 50.0 / 100.3 | 50.9 / 115.8 | 50.0 / 100.9 |
| nics-background-checks-2015-11.pdf | 83.3 / 83.5 | 83.3 / 83.5 | 84.6 / 100.0 | 84.0 / 84.2 | 84.0 / 99.2 | 83.5 / 83.8 | 83.3 / 83.3 | 83.6 / 83.9 |
| patent-us223898.pdf | 66.7 / 133.3 | 67.2 / 133.7 | 67.2 / 133.6 | 66.7 / 133.8 | 99.1 / 167.5 | 91.1 / 166.0 | 83.3 / 166.6 | 83.4 / 133.5 |
| pdfium-jpx-lzw.pdf | 49.6 / 50.3 | 50.0 / 50.3 | 49.6 / 49.9 | 49.9 / 50.6 | 66.7 / 66.9 | 49.7 / 49.9 | 49.4 / 50.3 | 50.0 / 50.0 |
| pdfium-smask-blend.pdf | 49.9 / 50.0 | 49.9 / 50.2 | 50.0 / 50.5 | 49.2 / 50.0 | 50.7 / 50.8 | 50.4 / 50.7 | 50.5 / 66.9 | 49.6 / 50.1 |
| pdfium-type3.pdf | 49.9 / 50.0 | 49.9 / 49.9 | 49.9 / 50.0 | 50.4 / 50.4 | 50.2 / 50.2 | 50.7 / 66.7 | 49.9 / 50.3 | 49.8 / 49.9 |
| synthetic-cjk-nonembedded.pdf | 99.0 / 99.0 | 84.2 / 99.5 | 99.3 / 99.9 | 83.2 / 83.3 | 100.0 / 100.4 | 99.8 / 99.9 | 100.0 / 100.3 | 100.0 / 100.0 |
| synthetic-text-1000.pdf | 50.0 / 50.7 | 50.0 / 50.7 | 50.0 / 50.7 | 50.0 / 50.9 | 50.0 / 50.7 | 50.0 / 50.9 | 50.0 / 50.8 | 50.0 / 50.6 |
| synthetic-vector-200k.pdf | 100.3 / 116.3 | 116.2 / 117.6 | 100.3 / 100.4 | 99.7 / 99.9 | 133.3 / 133.3 | 149.9 / 150.0 | 99.1 / 100.2 | 100.4 / 100.5 |
| usrguide.pdf | 50.0 / 67.6 | 49.9 / 66.1 | 50.0 / 65.7 | 50.0 / 66.2 | 50.0 / 66.2 | 49.9 / 68.3 | 50.2 / 66.7 | 50.0 / 67.0 |
| wdl6812-manuscript.pdf | 67.8 / 99.9 | 68.0 / 83.7 | 67.9 / 83.3 | 66.3 / 83.4 | 67.5 / 83.3 | 66.9 / 84.9 | 68.4 / 83.3 | 66.7 / 83.3 |

## Frame handover p50 / max (ms)

From the end of pdf.js's drawing to the frame on the displayed canvas: `transferToImageBitmap()` and `transferFromImageBitmap()`; `-frame` variants only.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | — | 3.20 / 6.60 | — | 1.70 / 4.30 | — | 3.20 / 6.30 | — | 0.00 / 0.10 |
| bunka-kokugo-series-019-p4.pdf | — | 24.40 / 27.20 | — | 0.00 / 0.00 | — | 2.30 / 2.50 | — | 0.00 / 0.00 |
| f1040.pdf | — | 12.20 / 18.40 | — | 8.20 / 15.50 | — | 2.10 / 3.50 | — | 0.00 / 0.10 |
| mhlw-doc.pdf | — | 6.50 / 19.60 | — | 3.80 / 16.60 | — | 1.70 / 2.90 | — | 0.00 / 0.10 |
| nics-background-checks-2015-11.pdf | — | 11.70 / 11.90 | — | 8.10 / 8.40 | — | 2.00 / 2.70 | — | 0.10 / 0.10 |
| patent-us223898.pdf | — | 23.60 / 53.30 | — | 0.20 / 0.30 | — | 1.50 / 2.60 | — | 0.00 / 0.10 |
| pdfium-jpx-lzw.pdf | — | 1.30 / 1.40 | — | 0.10 / 0.10 | — | 1.90 / 2.00 | — | 0.00 / 0.00 |
| pdfium-smask-blend.pdf | — | 0.20 / 0.20 | — | 0.10 / 0.10 | — | 0.20 / 0.90 | — | 0.00 / 0.00 |
| pdfium-type3.pdf | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.20 / 0.20 | — | 0.10 / 0.10 |
| synthetic-cjk-nonembedded.pdf | — | 6.50 / 6.50 | — | 5.40 / 5.50 | — | 1.40 / 1.50 | — | 0.00 / 0.10 |
| synthetic-text-1000.pdf | — | 3.30 / 5.00 | — | 1.80 / 3.90 | — | 1.80 / 3.40 | — | 0.00 / 0.10 |
| synthetic-vector-200k.pdf | — | 30.30 / 31.50 | — | 0.70 / 0.70 | — | 6.00 / 6.90 | — | 0.00 / 0.10 |
| usrguide.pdf | — | 4.60 / 9.70 | — | 3.00 / 8.50 | — | 2.50 / 5.10 | — | 0.00 / 0.10 |
| wdl6812-manuscript.pdf | — | 14.20 / 17.80 | — | 0.10 / 0.10 | — | 0.40 / 0.70 | — | 0.00 / 0.00 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 44 | 60 | 17 | 18 | 10 | 23 | 0 | 0 |
| bunka-kokugo-series-019-p4.pdf | 5 | 30 | 0 | 0 | 54 | 42 | 74 | 60 |
| f1040.pdf | 42 | 37 | 27 | 30 | 5 | 2 | 0 | 0 |
| mhlw-doc.pdf | 32 | 31 | 28 | 24 | 5 | 1 | 0 | 0 |
| nics-background-checks-2015-11.pdf | 19 | 20 | 11 | 12 | 4 | 2 | 0 | 0 |
| patent-us223898.pdf | 1 | 99 | 0 | 0 | 69 | 53 | 49 | 57 |
| pdfium-jpx-lzw.pdf | 1 | 0 | 0 | 0 | 4 | 1 | 0 | 0 |
| pdfium-smask-blend.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 26 | 22 | 22 | 13 | 1 | 0 | 0 | 0 |
| synthetic-text-1000.pdf | 19 | 28 | 9 | 10 | 4 | 5 | 0 | 0 |
| synthetic-vector-200k.pdf | 55 | 38 | 2 | 1 | 8 | 9 | 0 | 0 |
| usrguide.pdf | 36 | 43 | 26 | 24 | 8 | 7 | 0 | 0 |
| wdl6812-manuscript.pdf | 0 | 27 | 0 | 0 | 7 | 9 | 8 | 9 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 1.4 / 32.2 | 4.7 / 34.3 | 1.3 / 17.3 | 1.3 / 18.1 | 1.6 / 11.0 | 3.3 / 7.2 | 1.2 / 1.5 | 1.3 / 1.5 |
| bunka-kokugo-series-019-p4.pdf | 2.4 / 6.5 | 1.3 / 32.2 | 1.1 / 1.2 | 1.1 / 1.2 | 2.2 / 50.8 | 1.9 / 43.1 | 1.3 / 75.5 | 1.3 / 62.3 |
| f1040.pdf | 15.7 / 16.6 | 15.3 / 24.3 | 10.3 / 16.0 | 12.8 / 22.1 | 1.3 / 6.0 | 1.2 / 4.0 | 1.1 / 1.2 | 1.3 / 1.4 |
| mhlw-doc.pdf | 4.5 / 28.0 | 7.0 / 28.4 | 2.9 / 29.7 | 2.4 / 25.1 | 2.3 / 6.7 | 2.3 / 2.3 | 1.4 / 2.2 | 1.3 / 1.9 |
| nics-background-checks-2015-11.pdf | 12.5 / 12.5 | 18.6 / 18.6 | 9.9 / 9.9 | 10.2 / 10.2 | 1.4 / 6.2 | 1.2 / 3.6 | 1.1 / 1.3 | 1.1 / 1.3 |
| patent-us223898.pdf | 1.2 / 2.7 | 24.7 / 32.2 | 1.1 / 1.4 | 1.2 / 2.2 | 4.7 / 30.4 | 3.1 / 19.0 | 10.5 / 17.5 | 12.1 / 20.2 |
| pdfium-jpx-lzw.pdf | 2.8 / 2.8 | 2.4 / 2.4 | 1.1 / 1.1 | 1.1 / 1.1 | 6.2 / 6.2 | 3.2 / 3.2 | 1.4 / 1.4 | 1.8 / 1.8 |
| pdfium-smask-blend.pdf | 1.5 / 1.5 | 1.3 / 1.3 | 1.3 / 1.3 | 1.1 / 1.1 | 1.2 / 1.2 | 1.4 / 1.4 | 1.5 / 1.5 | 1.1 / 1.1 |
| pdfium-type3.pdf | 1.4 / 1.4 | 1.3 / 1.3 | 1.1 / 1.1 | 0.9 / 0.9 | 1.0 / 1.0 | 1.2 / 1.2 | 0.9 / 0.9 | 1.1 / 1.1 |
| synthetic-cjk-nonembedded.pdf | 25.5 / 25.5 | 23.3 / 23.6 | 1.2 / 24.0 | 14.2 / 14.2 | 1.3 / 3.2 | 1.2 / 1.7 | 1.0 / 1.2 | 1.2 / 1.3 |
| synthetic-text-1000.pdf | 3.3 / 7.8 | 4.3 / 10.8 | 1.3 / 7.0 | 1.7 / 6.8 | 1.4 / 5.4 | 2.1 / 3.4 | 1.0 / 1.4 | 1.1 / 1.5 |
| synthetic-vector-200k.pdf | 22.3 / 22.3 | 35.9 / 35.9 | 2.2 / 3.5 | 2.1 / 3.2 | 2.2 / 9.5 | 1.2 / 9.2 | 1.7 / 1.8 | 1.6 / 1.8 |
| usrguide.pdf | 5.0 / 12.3 | 5.6 / 14.8 | 3.4 / 13.1 | 3.1 / 12.4 | 1.9 / 7.2 | 2.2 / 3.7 | 1.5 / 1.8 | 1.4 / 1.9 |
| wdl6812-manuscript.pdf | 1.8 / 2.2 | 12.6 / 15.8 | 1.8 / 2.0 | 1.5 / 1.6 | 4.2 / 5.7 | 3.0 / 9.7 | 5.1 / 6.3 | 5.4 / 7.6 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 82 + 3 | 82 + 3 | 76 + 3 | 83 + 3 | 114 + 4 | 148 + 4 | 113 + 4 | 103 + 4 |
| bunka-kokugo-series-019-p4.pdf | 77 + 3 | 79 + 3 | 81 + 3 | 79 + 3 | 103 + 4 | 104 + 4 | 138 + 4 | 105 + 4 |
| f1040.pdf | 81 + 5 | 79 + 5 | 78 + 6 | 82 + 5 | 110 + 6 | 109 + 6 | 107 + 6 | 112 + 7 |
| mhlw-doc.pdf | 109 + 5 | 122 + 5 | 111 + 5 | 83 + 5 | 109 + 8 | 103 + 5 | 105 + 5 | 107 + 6 |
| nics-background-checks-2015-11.pdf | 104 + 3 | 83 + 3 | 108 + 3 | 106 + 3 | 108 + 3 | 101 + 3 | 103 + 3 | 103 + 3 |
| patent-us223898.pdf | 77 + 3 | 78 + 3 | 77 + 3 | 76 + 3 | 119 + 3 | 142 + 3 | 109 + 3 | 107 + 3 |
| pdfium-jpx-lzw.pdf | 76 + 2 | 78 + 2 | 76 + 3 | 103 + 3 | 149 + 3 | 105 + 3 | 100 + 3 | 101 + 3 |
| pdfium-smask-blend.pdf | 75 + 3 | 75 + 3 | 77 + 3 | 82 + 3 | 100 + 3 | 130 + 3 | 150 + 3 | 106 + 3 |
| pdfium-type3.pdf | 81 + 3 | 80 + 3 | 81 + 3 | 87 + 3 | 103 + 3 | 106 + 3 | 103 + 3 | 105 + 3 |
| synthetic-cjk-nonembedded.pdf | 81 + 4 | 80 + 4 | 95 + 4 | 76 + 3 | 99 + 4 | 103 + 4 | 101 + 4 | 100 + 4 |
| synthetic-text-1000.pdf | 81 + 53 | 79 + 56 | 79 + 51 | 77 + 50 | 105 + 59 | 102 + 54 | 101 + 55 | 162 + 63 |
| synthetic-vector-200k.pdf | 114 + 4 | 83 + 3 | 82 + 3 | 78 + 3 | 108 + 4 | 131 + 4 | 102 + 4 | 101 + 4 |
| usrguide.pdf | 76 + 6 | 77 + 7 | 79 + 7 | 79 + 7 | 103 + 7 | 107 + 7 | 105 + 7 | 109 + 7 |
| wdl6812-manuscript.pdf | 82 + 3 | 77 + 3 | 76 + 3 | 78 + 3 | 101 + 3 | 116 + 3 | 109 + 3 | 108 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | — | — | — | — | — | — | — | — |
| bunka-kokugo-series-019-p4.pdf | — | — | — | — | — | — | — | — |
| f1040.pdf | — | — | — | — | — | — | — | — |
| mhlw-doc.pdf | — | — | — | — | — | — | — | — |
| nics-background-checks-2015-11.pdf | — | — | — | — | — | — | — | — |
| patent-us223898.pdf | — | — | — | — | — | — | — | — |
| pdfium-jpx-lzw.pdf | — | — | — | — | — | — | — | — |
| pdfium-smask-blend.pdf | — | — | — | — | — | — | — | — |
| pdfium-type3.pdf | — | — | — | — | — | — | — | — |
| synthetic-cjk-nonembedded.pdf | — | — | — | — | — | — | — | — |
| synthetic-text-1000.pdf | — | — | — | — | — | — | — | — |
| synthetic-vector-200k.pdf | — | — | — | — | — | — | — | — |
| usrguide.pdf | — | — | — | — | — | — | — | — |
| wdl6812-manuscript.pdf | — | — | — | — | — | — | — | — |

