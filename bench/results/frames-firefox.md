# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-10-24T03:12:19.443Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms. The run waited 3 times (24 min in all) for other Playwright browsers or a load average above 10 and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e83 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-frame` variants draw into an OffscreenCanvas instead of the displayed canvas and show the finished page as an ImageBitmap through a `bitmaprenderer` context.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs,pdfjs-frame,pdfjs-hwa,pdfjs-hwa-frame,pdfjs-next,pdfjs-next-frame,pdfjs-next-hwa,pdfjs-next-hwa-frame OUTPUT=frames- pnpm bench`

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
| bill-hr815.pdf | 101.6 | 73.6 | 99.5 | 73.4 | 96.7 | 98.2 | 90.3 | 102.4 |
| bunka-kokugo-series-019-p4.pdf | 132.2 | 136.8 | 133.7 | 134.9 | 150.2 | 152.1 | 149.6 | 149.7 |
| f1040.pdf | 113.2 | 115.8 | 116.0 | 114.0 | 136.0 | 117.9 | 121.7 | 115.7 |
| mhlw-doc.pdf | 102.7 | 101.7 | 102.0 | 100.0 | 103.6 | 115.0 | 116.3 | 102.7 |
| nics-background-checks-2015-11.pdf | 103.8 | 81.1 | 99.7 | 87.1 | 98.1 | 100.4 | 99.1 | 113.1 |
| patent-us223898.pdf | 81.5 | 82.9 | 69.9 | 78.8 | 81.8 | 84.6 | 81.9 | 85.7 |
| pdfium-jpx-lzw.pdf | 50.4 | 50.2 | 49.4 | 50.1 | 50.3 | 49.5 | 49.1 | 48.7 |
| pdfium-smask-blend.pdf | 49.8 | 49.4 | 48.3 | 49.5 | 49.4 | 50.1 | 50.4 | 50.2 |
| pdfium-type3.pdf | 52.2 | 49.1 | 47.6 | 49.1 | 50.1 | 48.6 | 51.2 | 48.3 |
| synthetic-cjk-nonembedded.pdf | 83.4 | 87.3 | 82.5 | 86.8 | 82.2 | 83.6 | 83.3 | 83.3 |
| synthetic-text-1000.pdf | 50.7 | 50.6 | 49.3 | 52.2 | 65.6 | 50.0 | 67.2 | 63.8 |
| synthetic-vector-200k.pdf | 114.5 | 121.2 | 117.8 | 122.6 | 149.3 | 148.8 | 134.7 | 149.2 |
| usrguide.pdf | 95.7 | 83.3 | 84.2 | 86.6 | 87.5 | 85.3 | 84.4 | 83.2 |
| wdl6812-manuscript.pdf | 83.7 | 68.5 | 82.9 | 82.5 | 66.9 | 67.1 | 64.5 | 65.9 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 75.4 | 55.1 | 75.3 | 51.0 | 69.2 | 67.5 | 65.3 | 73.0 |
| bunka-kokugo-series-019-p4.pdf | 127.3 | 123.8 | 123.4 | 126.0 | 124.0 | 123.7 | 119.0 | 125.5 |
| f1040.pdf | 86.8 | 93.3 | 91.4 | 90.5 | 103.8 | 97.0 | 92.9 | 101.0 |
| mhlw-doc.pdf | 75.8 | 73.5 | 82.2 | 83.2 | 83.7 | 91.1 | 84.6 | 83.2 |
| nics-background-checks-2015-11.pdf | 75.2 | 62.5 | 69.6 | 63.0 | 66.2 | 76.8 | 68.3 | 84.4 |
| patent-us223898.pdf | 56.5 | 61.1 | 47.0 | 58.5 | 51.1 | 61.1 | 52.5 | 54.7 |
| pdfium-jpx-lzw.pdf | 15.9 | 17.9 | 16.4 | 17.9 | 24.4 | 24.5 | 23.7 | 27.2 |
| pdfium-smask-blend.pdf | 17.0 | 17.3 | 17.5 | 16.6 | 17.6 | 18.1 | 20.2 | 16.9 |
| pdfium-type3.pdf | 19.3 | 16.0 | 16.3 | 16.2 | 18.8 | 16.9 | 21.3 | 17.6 |
| synthetic-cjk-nonembedded.pdf | 63.9 | 66.9 | 63.8 | 65.4 | 53.0 | 51.4 | 53.3 | 54.6 |
| synthetic-text-1000.pdf | 30.8 | 28.0 | 26.3 | 30.7 | 32.5 | 33.0 | 36.0 | 36.7 |
| synthetic-vector-200k.pdf | 97.4 | 95.9 | 97.4 | 98.7 | 124.3 | 122.6 | 115.4 | 126.6 |
| usrguide.pdf | 70.6 | 55.6 | 57.7 | 56.9 | 60.4 | 59.5 | 59.5 | 58.4 |
| wdl6812-manuscript.pdf | 52.7 | 39.0 | 50.9 | 51.6 | 42.4 | 42.4 | 40.6 | 43.6 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.7 / 101.6 | 49.2 / 73.6 | 51.0 / 99.5 | 49.8 / 73.4 | 50.5 / 96.7 | 51.5 / 98.2 | 51.3 / 90.3 | 50.6 / 102.4 |
| bunka-kokugo-series-019-p4.pdf | 132.2 / 136.1 | 136.8 / 139.0 | 133.7 / 138.2 | 134.9 / 152.5 | 150.2 / 150.6 | 152.1 / 153.3 | 149.6 / 153.2 | 149.7 / 153.8 |
| f1040.pdf | 65.7 / 120.3 | 68.5 / 117.4 | 71.1 / 116.5 | 66.5 / 118.4 | 79.0 / 138.9 | 87.4 / 135.2 | 80.7 / 132.0 | 67.2 / 118.1 |
| mhlw-doc.pdf | 52.9 / 103.3 | 48.2 / 104.5 | 50.4 / 116.8 | 47.4 / 104.4 | 63.5 / 114.9 | 51.5 / 115.9 | 50.2 / 117.7 | 50.9 / 104.9 |
| nics-background-checks-2015-11.pdf | 103.8 / 109.9 | 81.1 / 93.5 | 99.7 / 101.9 | 87.1 / 96.7 | 98.1 / 102.1 | 100.4 / 115.7 | 99.1 / 102.9 | 113.1 / 116.5 |
| patent-us223898.pdf | 78.6 / 86.1 | 71.1 / 86.9 | 68.1 / 82.8 | 71.4 / 84.1 | 81.8 / 98.4 | 99.2 / 118.5 | 83.5 / 102.3 | 85.7 / 101.1 |
| pdfium-jpx-lzw.pdf | 50.4 / 51.7 | 50.2 / 50.3 | 49.4 / 50.0 | 50.1 / 51.3 | 50.3 / 52.4 | 49.5 / 51.6 | 49.1 / 50.2 | 48.7 / 52.1 |
| pdfium-smask-blend.pdf | 49.8 / 51.7 | 49.4 / 51.1 | 48.3 / 50.2 | 49.5 / 50.2 | 49.4 / 51.1 | 50.1 / 70.3 | 50.4 / 83.8 | 50.2 / 51.9 |
| pdfium-type3.pdf | 52.2 / 52.2 | 49.1 / 49.8 | 47.6 / 48.2 | 49.1 / 51.1 | 50.1 / 53.4 | 48.6 / 49.9 | 51.2 / 51.9 | 48.3 / 51.6 |
| synthetic-cjk-nonembedded.pdf | 83.4 / 83.8 | 87.3 / 135.3 | 82.5 / 83.0 | 86.8 / 87.3 | 82.2 / 83.1 | 83.6 / 84.8 | 83.3 / 99.3 | 83.3 / 84.6 |
| synthetic-text-1000.pdf | 50.5 / 53.2 | 50.1 / 53.0 | 49.5 / 52.1 | 49.9 / 53.1 | 50.2 / 65.6 | 49.9 / 53.8 | 50.0 / 67.8 | 50.2 / 67.4 |
| synthetic-vector-200k.pdf | 114.5 / 132.5 | 121.2 / 133.7 | 117.8 / 148.9 | 122.6 / 133.3 | 149.3 / 149.9 | 148.8 / 149.4 | 134.7 / 153.4 | 149.2 / 150.7 |
| usrguide.pdf | 50.2 / 95.7 | 50.1 / 83.3 | 50.0 / 84.2 | 50.0 / 86.6 | 51.7 / 87.5 | 51.3 / 85.3 | 50.1 / 84.4 | 51.7 / 83.2 |
| wdl6812-manuscript.pdf | 83.4 / 86.3 | 82.0 / 83.4 | 82.9 / 84.0 | 83.3 / 84.9 | 66.6 / 83.8 | 66.4 / 70.0 | 64.6 / 70.0 | 66.3 / 69.2 |

## Frame handover p50 / max (ms)

From the end of pdf.js's drawing to the frame on the displayed canvas: `transferToImageBitmap()` and `transferFromImageBitmap()`; `-frame` variants only.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | — | 2.10 / 2.70 | — | 2.30 / 3.30 | — | 2.60 / 3.40 | — | 2.60 / 3.40 |
| bunka-kokugo-series-019-p4.pdf | — | 1.40 / 1.40 | — | 1.60 / 1.70 | — | 1.90 / 1.90 | — | 1.70 / 1.90 |
| f1040.pdf | — | 1.30 / 1.50 | — | 1.30 / 1.60 | — | 1.60 / 1.80 | — | 1.50 / 1.90 |
| mhlw-doc.pdf | — | 1.70 / 2.10 | — | 1.50 / 1.80 | — | 1.70 / 2.00 | — | 1.70 / 1.90 |
| nics-background-checks-2015-11.pdf | — | 1.60 / 1.70 | — | 1.60 / 1.60 | — | 2.00 / 2.20 | — | 1.60 / 1.70 |
| patent-us223898.pdf | — | 1.30 / 1.50 | — | 1.30 / 1.50 | — | 1.70 / 2.20 | — | 1.70 / 2.20 |
| pdfium-jpx-lzw.pdf | — | 1.30 / 1.50 | — | 1.40 / 1.50 | — | 1.80 / 1.90 | — | 1.90 / 2.10 |
| pdfium-smask-blend.pdf | — | 0.20 / 0.20 | — | 0.20 / 0.20 | — | 0.20 / 0.20 | — | 0.10 / 0.20 |
| pdfium-type3.pdf | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 | — | 0.10 / 0.10 |
| synthetic-cjk-nonembedded.pdf | — | 2.30 / 2.30 | — | 1.90 / 1.90 | — | 1.40 / 1.50 | — | 1.70 / 2.00 |
| synthetic-text-1000.pdf | — | 1.50 / 2.90 | — | 1.50 / 2.00 | — | 1.70 / 2.40 | — | 1.70 / 2.20 |
| synthetic-vector-200k.pdf | — | 3.40 / 3.40 | — | 3.10 / 3.50 | — | 3.10 / 3.80 | — | 4.00 / 4.30 |
| usrguide.pdf | — | 1.80 / 2.50 | — | 1.80 / 2.80 | — | 1.80 / 2.50 | — | 1.70 / 2.50 |
| wdl6812-manuscript.pdf | — | 0.40 / 0.40 | — | 0.50 / 0.60 | — | 0.50 / 0.70 | — | 0.50 / 0.70 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 35 | 103 | 54 | 116 | 14 | 46 | 13 | 59 |
| bunka-kokugo-series-019-p4.pdf | 25 | 23 | 24 | 22 | 8 | 9 | 10 | 12 |
| f1040.pdf | 41 | 37 | 43 | 45 | 7 | 10 | 4 | 3 |
| mhlw-doc.pdf | 30 | 36 | 23 | 31 | 4 | 5 | 6 | 8 |
| nics-background-checks-2015-11.pdf | 25 | 25 | 25 | 29 | 1 | 6 | 4 | 4 |
| patent-us223898.pdf | 33 | 49 | 33 | 47 | 12 | 21 | 8 | 19 |
| pdfium-jpx-lzw.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 |
| pdfium-smask-blend.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 17 | 19 | 12 | 16 | 0 | 2 | 2 | 4 |
| synthetic-text-1000.pdf | 31 | 84 | 35 | 85 | 3 | 22 | 3 | 36 |
| synthetic-vector-200k.pdf | 63 | 64 | 72 | 48 | 4 | 9 | 3 | 8 |
| usrguide.pdf | 44 | 96 | 44 | 91 | 6 | 27 | 5 | 31 |
| wdl6812-manuscript.pdf | 2 | 2 | 4 | 1 | 0 | 0 | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 4.5 / 15.6 | 12.9 / 17.4 | 5.9 / 16.4 | 13.8 / 16.8 | 4.4 / 6.0 | 7.4 / 13.2 | 3.3 / 6.7 | 8.7 / 13.1 |
| bunka-kokugo-series-019-p4.pdf | 2.8 / 25.8 | 2.7 / 26.0 | 5.0 / 21.6 | 3.1 / 24.8 | 4.1 / 7.7 | 6.3 / 7.2 | 5.2 / 9.1 | 6.2 / 11.5 |
| f1040.pdf | 13.9 / 15.4 | 12.9 / 15.4 | 13.7 / 17.4 | 12.7 / 16.6 | 3.2 / 6.0 | 3.0 / 7.0 | 3.3 / 4.3 | 3.3 / 4.6 |
| mhlw-doc.pdf | 12.7 / 14.5 | 13.7 / 17.1 | 12.0 / 13.3 | 14.2 / 16.0 | 3.2 / 4.8 | 4.0 / 5.4 | 3.1 / 6.8 | 4.1 / 7.0 |
| nics-background-checks-2015-11.pdf | 14.0 / 14.0 | 13.9 / 13.9 | 15.3 / 15.3 | 14.6 / 14.6 | 3.2 / 3.5 | 4.1 / 5.3 | 3.4 / 3.7 | 3.5 / 4.6 |
| patent-us223898.pdf | 8.9 / 10.7 | 14.3 / 18.6 | 9.8 / 13.2 | 11.9 / 15.9 | 3.3 / 6.5 | 4.2 / 6.9 | 2.5 / 5.5 | 4.3 / 6.9 |
| pdfium-jpx-lzw.pdf | 1.0 / 1.0 | 2.0 / 2.0 | 1.0 / 1.0 | 2.3 / 2.3 | 1.1 / 1.1 | 1.6 / 1.6 | 2.7 / 2.7 | 3.9 / 3.9 |
| pdfium-smask-blend.pdf | 1.0 / 1.0 | 1.0 / 1.0 | 1.7 / 1.7 | 1.5 / 1.5 | 1.3 / 1.3 | 2.1 / 2.1 | 1.1 / 1.1 | 1.1 / 1.1 |
| pdfium-type3.pdf | 1.1 / 1.1 | 1.0 / 1.0 | 1.4 / 1.4 | 1.1 / 1.1 | 1.9 / 1.9 | 1.4 / 1.4 | 1.0 / 1.0 | 1.0 / 1.0 |
| synthetic-cjk-nonembedded.pdf | 14.1 / 14.1 | 14.1 / 17.4 | 13.0 / 13.0 | 18.3 / 18.3 | 1.9 / 1.9 | 1.6 / 4.1 | 1.9 / 3.7 | 4.3 / 4.3 |
| synthetic-text-1000.pdf | 5.3 / 12.2 | 9.9 / 14.2 | 4.3 / 12.2 | 9.9 / 14.7 | 1.8 / 3.8 | 4.4 / 8.0 | 1.6 / 3.7 | 4.7 / 10.8 |
| synthetic-vector-200k.pdf | 13.4 / 16.4 | 14.1 / 15.5 | 15.4 / 15.9 | 12.0 / 14.1 | 1.3 / 5.6 | 5.1 / 8.2 | 2.5 / 4.9 | 1.9 / 7.2 |
| usrguide.pdf | 5.3 / 13.3 | 11.0 / 16.3 | 4.9 / 12.9 | 10.4 / 15.3 | 1.4 / 3.8 | 3.9 / 9.2 | 1.8 / 3.9 | 4.7 / 7.3 |
| wdl6812-manuscript.pdf | 2.2 / 4.3 | 2.3 / 3.6 | 3.7 / 4.0 | 2.0 / 3.1 | 1.1 / 1.9 | 1.5 / 2.0 | 1.1 / 1.5 | 1.7 / 2.1 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-frame | pdfjs-hwa | pdfjs-hwa-frame | pdfjs-next | pdfjs-next-frame | pdfjs-next-hwa | pdfjs-next-hwa-frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 114 + 3 | 116 + 3 | 136 + 3 | 137 + 3 | 153 + 3 | 149 + 3 | 141 + 3 | 153 + 3 |
| bunka-kokugo-series-019-p4.pdf | 139 + 2 | 127 + 2 | 121 + 2 | 133 + 2 | 151 + 3 | 143 + 3 | 148 + 3 | 144 + 3 |
| f1040.pdf | 117 + 4 | 115 + 4 | 128 + 4 | 116 + 4 | 152 + 5 | 163 + 5 | 150 + 5 | 143 + 5 |
| mhlw-doc.pdf | 116 + 4 | 127 + 4 | 114 + 4 | 137 + 4 | 152 + 5 | 148 + 5 | 152 + 5 | 166 + 5 |
| nics-background-checks-2015-11.pdf | 120 + 2 | 123 + 2 | 128 + 2 | 127 + 2 | 155 + 2 | 157 + 2 | 149 + 2 | 148 + 2 |
| patent-us223898.pdf | 122 + 3 | 136 + 3 | 125 + 3 | 126 + 3 | 150 + 3 | 157 + 3 | 150 + 3 | 149 + 3 |
| pdfium-jpx-lzw.pdf | 124 + 2 | 123 + 2 | 141 + 2 | 122 + 2 | 150 + 2 | 154 + 2 | 143 + 2 | 146 + 2 |
| pdfium-smask-blend.pdf | 117 + 2 | 120 + 2 | 128 + 2 | 114 + 2 | 145 + 2 | 143 + 2 | 153 + 2 | 143 + 2 |
| pdfium-type3.pdf | 120 + 2 | 120 + 2 | 123 + 2 | 135 + 2 | 163 + 2 | 159 + 3 | 167 + 3 | 153 + 3 |
| synthetic-cjk-nonembedded.pdf | 122 + 3 | 139 + 3 | 120 + 3 | 125 + 3 | 142 + 3 | 147 + 3 | 150 + 3 | 146 + 3 |
| synthetic-text-1000.pdf | 132 + 87 | 128 + 87 | 122 + 88 | 130 + 82 | 150 + 85 | 159 + 85 | 148 + 86 | 159 + 84 |
| synthetic-vector-200k.pdf | 128 + 3 | 125 + 3 | 117 + 3 | 124 + 3 | 143 + 3 | 144 + 3 | 145 + 3 | 145 + 3 |
| usrguide.pdf | 121 + 7 | 137 + 7 | 123 + 7 | 117 + 7 | 149 + 7 | 155 + 8 | 146 + 8 | 144 + 7 |
| wdl6812-manuscript.pdf | 122 + 2 | 122 + 2 | 124 + 2 | 115 + 2 | 155 + 3 | 150 + 2 | 161 + 2 | 144 + 3 |

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

