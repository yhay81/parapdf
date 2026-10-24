# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-10-24T02:38:30.989Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.7 ms late (median) / 5.0 ms (p95), and animation frames arrive every 13.9 ms. The run waited once (24 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-frame` variants draw into an OffscreenCanvas instead of the displayed canvas and show the finished page as an ImageBitmap through a `bitmaprenderer` context.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit ENGINES=pdfjs,pdfjs-frame,pdfjs-hwa,pdfjs-hwa-frame,pdfjs-next,pdfjs-next-frame,pdfjs-next-hwa,pdfjs-next-hwa-frame OUTPUT=frames- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 13.9 ms; use the committed table for finer engine differences.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 109.4 | 98.3 | 97.1 | 97.2 | 100.1 | 105.0 | 112.1 | 111.0 |
| bunka-kokugo-series-019-p4.pdf | 165.9 | 192.6 | 139.0 | 126.8 | 202.9 | 208.7 | 209.2 | 194.2 |
| f1040.pdf | 97.2 | 98.1 | 97.1 | 97.2 | 111.5 | 111.1 | 97.0 | 111.0 |
| mhlw-doc.pdf | 83.2 | 83.3 | 83.2 | 83.3 | 83.3 | 97.1 | 97.7 | 97.2 |
| nics-background-checks-2015-11.pdf | 83.2 | 83.9 | 83.3 | 83.3 | 97.2 | 83.5 | 96.7 | 83.3 |
| patent-us223898.pdf | 83.3 | 83.2 | 83.3 | 82.7 | 97.8 | 96.8 | 97.2 | 110.9 |
| pdfium-jpx-lzw.pdf | 40.8 | 41.6 | 41.4 | 41.6 | 55.6 | 55.6 | 55.5 | 55.5 |
| pdfium-smask-blend.pdf | 41.6 | 41.6 | 41.6 | 41.6 | 41.6 | 41.6 | 41.5 | 41.6 |
| pdfium-type3.pdf | 41.0 | 41.7 | 41.6 | 41.6 | 42.1 | 41.6 | 41.6 | 41.6 |
| synthetic-cjk-nonembedded.pdf | 96.7 | 83.3 | 83.3 | 83.3 | 83.6 | 83.4 | 83.2 | 83.3 |
| synthetic-text-1000.pdf | 42.3 | 41.6 | 39.6 | 41.6 | 55.4 | 81.0 | 55.5 | 55.5 |
| synthetic-vector-200k.pdf | 166.9 | 152.7 | 97.2 | 97.1 | 173.8 | 173.7 | 109.8 | 104.0 |
| usrguide.pdf | 70.4 | 69.4 | 69.4 | 70.3 | 83.2 | 84.8 | 83.3 | 81.9 |
| wdl6812-manuscript.pdf | 97.2 | 97.1 | 83.2 | 97.2 | 83.3 | 83.2 | 95.4 | 96.8 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 93.5 | 76.2 | 48.8 | 49.9 | 83.3 | 81.6 | 90.7 | 91.6 |
| bunka-kokugo-series-019-p4.pdf | 144.5 | 161.4 | 113.1 | 99.0 | 169.6 | 186.7 | 194.0 | 180.1 |
| f1040.pdf | 75.3 | 73.2 | 72.7 | 71.9 | 82.5 | 89.2 | 82.3 | 92.3 |
| mhlw-doc.pdf | 64.1 | 59.5 | 60.5 | 61.2 | 66.7 | 79.9 | 72.2 | 72.6 |
| nics-background-checks-2015-11.pdf | 59.6 | 58.6 | 58.4 | 59.2 | 72.9 | 63.9 | 71.5 | 68.4 |
| patent-us223898.pdf | 57.0 | 59.8 | 57.0 | 57.8 | 83.6 | 83.0 | 83.7 | 84.5 |
| pdfium-jpx-lzw.pdf | 14.2 | 14.9 | 13.4 | 15.0 | 34.4 | 35.1 | 33.6 | 33.9 |
| pdfium-smask-blend.pdf | 14.6 | 15.4 | 14.2 | 15.0 | 16.7 | 16.7 | 17.7 | 18.0 |
| pdfium-type3.pdf | 14.8 | 14.9 | 14.7 | 14.6 | 16.5 | 16.0 | 16.9 | 17.1 |
| synthetic-cjk-nonembedded.pdf | 77.0 | 63.5 | 59.9 | 63.0 | 67.0 | 67.9 | 69.0 | 69.4 |
| synthetic-text-1000.pdf | 18.6 | 19.8 | 18.7 | 24.4 | 31.8 | 48.6 | 35.0 | 33.9 |
| synthetic-vector-200k.pdf | 89.0 | 71.9 | 72.5 | 73.1 | 140.6 | 140.8 | 89.6 | 83.8 |
| usrguide.pdf | 47.8 | 46.5 | 45.3 | 46.9 | 57.6 | 59.1 | 55.5 | 56.9 |
| wdl6812-manuscript.pdf | 71.5 | 69.9 | 65.3 | 70.3 | 69.3 | 69.1 | 71.0 | 70.2 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 41.7 / 109.4 | 41.7 / 98.3 | 41.7 / 97.1 | 41.7 / 97.2 | 47.0 / 100.1 | 42.0 / 105.0 | 41.7 / 112.1 | 41.7 / 111.0 |
| bunka-kokugo-series-019-p4.pdf | 165.9 / 208.1 | 192.6 / 206.4 | 139.0 / 181.7 | 126.8 / 138.7 | 202.9 / 251.3 | 208.7 / 226.0 | 209.2 / 235.0 | 194.2 / 344.4 |
| f1040.pdf | 41.7 / 97.2 | 41.7 / 98.2 | 42.3 / 97.2 | 41.8 / 97.2 | 58.6 / 142.3 | 55.5 / 111.1 | 56.5 / 111.0 | 55.5 / 111.0 |
| mhlw-doc.pdf | 41.7 / 83.7 | 41.7 / 83.9 | 42.3 / 83.4 | 41.7 / 83.9 | 48.0 / 98.9 | 41.9 / 97.2 | 41.7 / 98.1 | 41.7 / 98.1 |
| nics-background-checks-2015-11.pdf | 83.2 / 83.2 | 83.9 / 97.2 | 83.3 / 83.5 | 83.3 / 84.0 | 97.2 / 97.2 | 83.5 / 83.9 | 96.7 / 97.2 | 83.3 / 97.9 |
| patent-us223898.pdf | 69.5 / 83.6 | 70.0 / 96.3 | 69.6 / 84.6 | 70.2 / 84.2 | 83.3 / 110.6 | 70.4 / 97.2 | 83.3 / 111.1 | 83.3 / 110.9 |
| pdfium-jpx-lzw.pdf | 40.8 / 41.5 | 41.6 / 41.6 | 41.4 / 41.6 | 41.6 / 41.7 | 55.6 / 55.6 | 55.6 / 56.0 | 55.5 / 55.6 | 55.5 / 55.5 |
| pdfium-smask-blend.pdf | 41.6 / 41.6 | 41.6 / 41.6 | 41.6 / 41.6 | 41.6 / 42.6 | 41.6 / 41.6 | 41.6 / 41.6 | 41.5 / 41.6 | 41.6 / 42.5 |
| pdfium-type3.pdf | 41.0 / 41.6 | 41.7 / 42.1 | 41.6 / 41.6 | 41.6 / 41.6 | 42.1 / 42.4 | 41.6 / 41.6 | 41.6 / 41.6 | 41.6 / 41.6 |
| synthetic-cjk-nonembedded.pdf | 96.7 / 97.2 | 83.3 / 84.1 | 83.3 / 83.7 | 83.3 / 83.4 | 83.6 / 88.5 | 83.4 / 83.4 | 83.2 / 83.3 | 83.3 / 97.2 |
| synthetic-text-1000.pdf | 41.7 / 42.7 | 41.6 / 43.5 | 41.7 / 43.7 | 41.7 / 43.8 | 41.7 / 55.7 | 42.9 / 81.0 | 43.0 / 56.5 | 42.3 / 57.4 |
| synthetic-vector-200k.pdf | 166.9 / 182.4 | 152.7 / 154.2 | 97.2 / 97.5 | 97.1 / 97.5 | 173.8 / 177.4 | 173.7 / 177.8 | 109.8 / 110.2 | 104.0 / 111.6 |
| usrguide.pdf | 41.7 / 70.4 | 41.7 / 69.4 | 41.7 / 69.4 | 41.7 / 70.3 | 41.7 / 83.2 | 41.7 / 84.8 | 41.7 / 83.3 | 41.7 / 81.9 |
| wdl6812-manuscript.pdf | 69.4 / 99.5 | 84.6 / 123.7 | 83.2 / 97.2 | 71.3 / 97.2 | 69.5 / 84.9 | 70.9 / 83.3 | 71.1 / 95.5 | 69.7 / 97.2 |

## Frame handover p50 / max (ms)

From the end of pdf.js's drawing to the frame on the displayed canvas: `transferToImageBitmap()` and `transferFromImageBitmap()`; `-frame` variants only.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | — | 0.10 / 1.20 | — | 0.00 / 1.00 | — | 0.10 / 0.90 | — | 0.10 / 2.80 |
| bunka-kokugo-series-019-p4.pdf | — | 0.10 / 0.10 | — | 0.00 / 0.10 | — | 0.10 / 0.10 | — | 0.00 / 0.10 |
| f1040.pdf | — | 0.10 / 1.80 | — | 0.00 / 1.20 | — | 0.10 / 1.10 | — | 0.10 / 1.20 |
| mhlw-doc.pdf | — | 0.10 / 1.10 | — | 0.10 / 1.20 | — | 0.10 / 1.10 | — | 0.10 / 1.10 |
| nics-background-checks-2015-11.pdf | — | 0.60 / 1.50 | — | 0.60 / 0.60 | — | 1.20 / 1.20 | — | 1.30 / 1.30 |
| patent-us223898.pdf | — | 0.10 / 3.00 | — | 0.00 / 1.00 | — | 0.10 / 0.10 | — | 0.00 / 0.10 |
| pdfium-jpx-lzw.pdf | — | 0.70 / 0.70 | — | 0.70 / 0.80 | — | 0.80 / 0.80 | — | 0.80 / 0.90 |
| pdfium-smask-blend.pdf | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.00 / 0.00 |
| pdfium-type3.pdf | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.00 / 0.10 |
| synthetic-cjk-nonembedded.pdf | — | 0.80 / 0.80 | — | 0.80 / 0.80 | — | 0.80 / 0.90 | — | 0.70 / 0.90 |
| synthetic-text-1000.pdf | — | 0.10 / 0.90 | — | 0.10 / 1.20 | — | 0.10 / 0.10 | — | 0.10 / 1.60 |
| synthetic-vector-200k.pdf | — | 0.60 / 0.60 | — | 0.50 / 0.50 | — | 0.60 / 0.60 | — | 0.50 / 1.40 |
| usrguide.pdf | — | 0.10 / 0.90 | — | 0.00 / 0.80 | — | 0.10 / 0.90 | — | 0.00 / 0.80 |
| wdl6812-manuscript.pdf | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 39 | 27 | 1 | 3 | 0 | 0 | 0 | 0 |
| bunka-kokugo-series-019-p4.pdf | 42 | 44 | 0 | 0 | 30 | 30 | 28 | 27 |
| f1040.pdf | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| mhlw-doc.pdf | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nics-background-checks-2015-11.pdf | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| patent-us223898.pdf | 0 | 2 | 0 | 1 | 19 | 19 | 18 | 18 |
| pdfium-jpx-lzw.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-smask-blend.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 10 | 13 | 10 | 12 | 0 | 0 | 0 | 0 |
| synthetic-text-1000.pdf | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 0 |
| synthetic-vector-200k.pdf | 5 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| usrguide.pdf | 1 | 1 | 2 | 1 | 0 | 0 | 0 | 0 |
| wdl6812-manuscript.pdf | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 6.0 / 24.8 | 6.0 / 21.5 | 5.6 / 5.9 | 5.5 / 8.2 | 5.3 / 6.0 | 5.5 / 5.9 | 5.4 / 5.8 | 5.3 / 5.9 |
| bunka-kokugo-series-019-p4.pdf | 5.3 / 47.3 | 5.8 / 49.7 | 5.7 / 5.9 | 5.6 / 5.9 | 6.0 / 35.8 | 5.7 / 35.8 | 5.7 / 33.0 | 5.8 / 32.4 |
| f1040.pdf | 5.0 / 6.0 | 4.7 / 5.0 | 4.9 / 5.5 | 4.8 / 6.0 | 4.8 / 4.9 | 4.9 / 4.9 | 4.8 / 4.9 | 4.6 / 4.8 |
| mhlw-doc.pdf | 4.9 / 6.6 | 4.8 / 4.9 | 4.7 / 4.9 | 4.9 / 5.0 | 4.8 / 4.9 | 4.7 / 4.8 | 4.7 / 5.0 | 4.8 / 4.9 |
| nics-background-checks-2015-11.pdf | 6.9 / 6.9 | 6.4 / 6.4 | 5.0 / 5.0 | 4.8 / 4.8 | 4.4 / 4.9 | 4.5 / 4.5 | 4.6 / 4.6 | 4.9 / 5.0 |
| patent-us223898.pdf | 4.8 / 4.9 | 4.7 / 6.4 | 4.8 / 5.0 | 4.9 / 5.1 | 7.8 / 16.1 | 7.0 / 16.3 | 7.1 / 16.0 | 7.1 / 16.0 |
| pdfium-jpx-lzw.pdf | 1.2 / 1.2 | 4.1 / 4.1 | 2.7 / 2.7 | 3.1 / 3.1 | 4.7 / 4.7 | 4.8 / 4.8 | 4.5 / 4.5 | 4.8 / 4.8 |
| pdfium-smask-blend.pdf | 3.1 / 3.1 | 3.0 / 3.0 | 3.8 / 3.8 | 1.8 / 1.8 | 4.0 / 4.0 | 3.6 / 3.6 | 4.7 / 4.7 | 3.9 / 3.9 |
| pdfium-type3.pdf | 3.4 / 3.4 | 4.0 / 4.0 | 3.6 / 3.6 | 2.0 / 2.0 | 3.5 / 3.5 | 2.8 / 2.8 | 3.5 / 3.5 | 2.9 / 2.9 |
| synthetic-cjk-nonembedded.pdf | 14.5 / 14.5 | 17.7 / 17.7 | 14.7 / 14.7 | 16.9 / 16.9 | 4.4 / 4.4 | 4.6 / 4.6 | 4.7 / 4.7 | 4.7 / 4.7 |
| synthetic-text-1000.pdf | 4.9 / 5.4 | 5.3 / 5.8 | 5.6 / 5.8 | 5.5 / 5.8 | 5.6 / 5.9 | 5.7 / 5.9 | 5.5 / 5.8 | 5.7 / 5.9 |
| synthetic-vector-200k.pdf | 5.9 / 10.8 | 5.7 / 6.4 | 5.9 / 5.9 | 6.4 / 6.4 | 5.4 / 5.9 | 5.7 / 5.7 | 4.8 / 5.0 | 4.7 / 5.6 |
| usrguide.pdf | 5.6 / 6.4 | 5.5 / 6.1 | 5.6 / 7.0 | 5.5 / 6.4 | 5.3 / 5.9 | 5.3 / 5.8 | 5.5 / 6.0 | 5.3 / 5.8 |
| wdl6812-manuscript.pdf | 5.6 / 5.9 | 5.1 / 5.6 | 5.6 / 5.7 | 5.2 / 5.3 | 5.9 / 6.7 | 5.7 / 6.2 | 5.5 / 5.7 | 5.1 / 5.9 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 103 + 5 | 106 + 5 | 83 + 5 | 95 + 5 | 125 + 5 | 120 + 5 | 107 + 5 | 112 + 5 |
| bunka-kokugo-series-019-p4.pdf | 83 + 4 | 83 + 5 | 95 + 5 | 92 + 5 | 109 + 5 | 129 + 5 | 107 + 5 | 116 + 6 |
| f1040.pdf | 84 + 6 | 86 + 6 | 90 + 7 | 99 + 6 | 106 + 8 | 107 + 7 | 115 + 7 | 112 + 8 |
| mhlw-doc.pdf | 101 + 6 | 90 + 6 | 92 + 6 | 92 + 7 | 120 + 8 | 129 + 8 | 107 + 8 | 113 + 8 |
| nics-background-checks-2015-11.pdf | 104 + 4 | 82 + 4 | 83 + 4 | 92 + 4 | 111 + 4 | 131 + 4 | 131 + 4 | 110 + 4 |
| patent-us223898.pdf | 84 + 4 | 104 + 4 | 101 + 4 | 81 + 4 | 112 + 5 | 102 + 5 | 113 + 5 | 106 + 5 |
| pdfium-jpx-lzw.pdf | 99 + 4 | 78 + 4 | 108 + 4 | 94 + 4 | 113 + 4 | 115 + 4 | 118 + 4 | 132 + 4 |
| pdfium-smask-blend.pdf | 102 + 4 | 95 + 4 | 92 + 4 | 91 + 4 | 122 + 4 | 119 + 5 | 107 + 4 | 111 + 5 |
| pdfium-type3.pdf | 89 + 4 | 80 + 4 | 83 + 4 | 89 + 4 | 117 + 5 | 109 + 4 | 118 + 5 | 106 + 5 |
| synthetic-cjk-nonembedded.pdf | 82 + 5 | 95 + 5 | 79 + 5 | 92 + 5 | 109 + 6 | 120 + 6 | 109 + 6 | 111 + 6 |
| synthetic-text-1000.pdf | 81 + 55 | 103 + 54 | 81 + 60 | 110 + 62 | 107 + 59 | 156 + 62 | 109 + 56 | 105 + 56 |
| synthetic-vector-200k.pdf | 79 + 6 | 80 + 6 | 78 + 6 | 80 + 6 | 105 + 7 | 104 + 7 | 105 + 7 | 104 + 7 |
| usrguide.pdf | 79 + 10 | 81 + 10 | 81 + 10 | 80 + 10 | 109 + 10 | 105 + 10 | 106 + 10 | 106 + 10 |
| wdl6812-manuscript.pdf | 79 + 4 | 81 + 4 | 81 + 4 | 81 + 4 | 104 + 5 | 105 + 5 | 106 + 4 | 123 + 5 |

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

