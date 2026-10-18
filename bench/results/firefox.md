# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-10-18T12:11:26.440Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.5 ms (p95), and animation frames arrive every 16.7 ms.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1655 KiB | 492 KiB | 404 KiB |
| pdfjs-next (workers unminified) | 3 | 2852 KiB | 645 KiB | 521 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 98.3 | 99.2 | 91.3 | 95.5 | 63.7 | 64.7 |
| bunka-kokugo-series-019-p4.pdf | 133.0 | 115.1 | 135.2 | 134.2 | 179.7 | 65.3 |
| f1040.pdf | 114.2 | 102.0 | 120.1 | 115.6 | 68.2 | 67.9 |
| mhlw-doc.pdf | 99.0 | 100.6 | 112.1 | 115.8 | 62.8 | 64.6 |
| nics-background-checks-2015-11.pdf | 97.0 | 98.4 | 89.0 | 99.7 | 65.9 | 65.8 |
| patent-us223898.pdf | 68.3 | 79.8 | 79.8 | 67.1 | 132.7 | 59.7 |
| pdfium-jpx-lzw.pdf | 47.7 | 55.7 | 48.9 | 50.8 | 117.2 | 48.1 |
| pdfium-smask-blend.pdf | 46.8 | 46.0 | 51.7 | 54.0 | 30.2 | 33.1 |
| pdfium-type3.pdf | 50.3 | 46.5 | 56.0 | 52.0 | 29.0 | 33.0 |
| synthetic-cjk-nonembedded.pdf | 67.6 | 69.2 | 67.2 | 82.3 | 48.0 | 50.1 |
| synthetic-text-1000.pdf | 48.9 | 51.6 | 46.6 | 48.2 | 51.1 | 48.7 |
| synthetic-vector-200k.pdf | 120.0 | 116.9 | 135.0 | 135.7 | 433.6 | 278.2 |
| usrguide.pdf | 88.6 | 82.4 | 88.5 | 84.3 | 47.5 | 48.6 |
| wdl6812-manuscript.pdf | 79.2 | 70.2 | 68.6 | 64.0 | 101.0 | 64.4 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 70.1 | 75.0 | 61.2 | 65.5 | 30.8 | 33.7 |
| bunka-kokugo-series-019-p4.pdf | 122.9 | 104.4 | 107.5 | 107.3 | 155.2 | 38.6 |
| f1040.pdf | 90.0 | 81.6 | 88.1 | 96.1 | 43.1 | 36.5 |
| mhlw-doc.pdf | 76.4 | 75.2 | 87.6 | 86.8 | 36.2 | 30.8 |
| nics-background-checks-2015-11.pdf | 71.0 | 73.6 | 60.4 | 79.5 | 42.1 | 45.6 |
| patent-us223898.pdf | 45.0 | 59.4 | 49.9 | 50.0 | 101.7 | 32.6 |
| pdfium-jpx-lzw.pdf | 14.7 | 18.4 | 21.1 | 24.5 | 89.3 | 32.8 |
| pdfium-smask-blend.pdf | 17.2 | 15.7 | 18.8 | 20.4 | 4.6 | 2.2 |
| pdfium-type3.pdf | 17.0 | 15.4 | 22.6 | 19.1 | 1.2 | 1.4 |
| synthetic-cjk-nonembedded.pdf | 49.3 | 50.9 | 49.1 | 49.9 | 15.0 | 19.9 |
| synthetic-text-1000.pdf | 27.2 | 29.1 | 32.9 | 27.4 | 23.7 | 30.0 |
| synthetic-vector-200k.pdf | 96.3 | 92.6 | 108.7 | 104.1 | 409.5 | 260.6 |
| usrguide.pdf | 61.5 | 54.1 | 61.6 | 58.8 | 27.5 | 25.5 |
| wdl6812-manuscript.pdf | 54.5 | 38.5 | 40.0 | 39.5 | 69.1 | 33.7 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.1 / 98.3 | 50.8 / 99.2 | 52.5 / 91.3 | 52.4 / 95.5 | 49.2 / 63.7 | 49.9 / 66.1 |
| bunka-kokugo-series-019-p4.pdf | 133.0 / 133.2 | 115.1 / 129.9 | 135.2 / 136.4 | 134.2 / 134.8 | 179.7 / 183.7 | 65.3 / 66.1 |
| f1040.pdf | 68.6 / 121.0 | 69.9 / 112.6 | 68.7 / 133.3 | 85.4 / 135.4 | 49.4 / 70.6 | 53.3 / 69.7 |
| mhlw-doc.pdf | 52.6 / 113.7 | 53.6 / 113.0 | 61.7 / 119.8 | 54.7 / 116.7 | 44.5 / 66.1 | 44.3 / 66.4 |
| nics-background-checks-2015-11.pdf | 97.0 / 98.7 | 98.4 / 98.7 | 89.0 / 104.7 | 99.7 / 112.3 | 65.9 / 69.7 | 65.8 / 70.2 |
| patent-us223898.pdf | 69.8 / 85.5 | 76.0 / 85.7 | 83.7 / 102.9 | 70.0 / 99.9 | 82.8 / 134.3 | 62.1 / 70.0 |
| pdfium-jpx-lzw.pdf | 47.7 / 53.6 | 55.7 / 57.0 | 48.9 / 52.6 | 50.8 / 55.6 | 117.2 / 120.0 | 48.1 / 54.1 |
| pdfium-smask-blend.pdf | 46.8 / 49.9 | 46.0 / 54.6 | 51.7 / 56.6 | 54.0 / 55.3 | 30.2 / 34.6 | 33.1 / 34.6 |
| pdfium-type3.pdf | 50.3 / 52.9 | 46.5 / 51.6 | 56.0 / 56.6 | 52.0 / 52.5 | 29.0 / 33.0 | 33.0 / 34.5 |
| synthetic-cjk-nonembedded.pdf | 67.6 / 76.2 | 69.2 / 76.2 | 67.2 / 80.9 | 82.3 / 85.4 | 48.0 / 51.6 | 50.1 / 52.5 |
| synthetic-text-1000.pdf | 49.8 / 55.9 | 49.1 / 57.0 | 49.8 / 55.3 | 51.0 / 68.1 | 35.8 / 52.5 | 45.9 / 52.5 |
| synthetic-vector-200k.pdf | 120.0 / 131.8 | 116.9 / 117.5 | 135.0 / 136.8 | 135.7 / 138.0 | 433.6 / 434.3 | 278.2 / 287.7 |
| usrguide.pdf | 50.7 / 88.6 | 49.7 / 82.4 | 51.3 / 88.5 | 52.5 / 84.3 | 35.9 / 50.1 | 36.2 / 52.5 |
| wdl6812-manuscript.pdf | 79.2 / 88.0 | 80.0 / 85.2 | 66.8 / 72.4 | 64.5 / 67.7 | 82.0 / 102.6 | 60.0 / 66.2 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 64 | 68 | 22 | 19 | 47 | 38 |
| bunka-kokugo-series-019-p4.pdf | 21 | 19 | 5 | 2 | 2 | 1 |
| f1040.pdf | 36 | 39 | 2 | 2 | 5 | 3 |
| mhlw-doc.pdf | 29 | 32 | 2 | 4 | 0 | 2 |
| nics-background-checks-2015-11.pdf | 26 | 23 | 1 | 2 | 2 | 4 |
| patent-us223898.pdf | 30 | 32 | 7 | 6 | 2 | 4 |
| pdfium-jpx-lzw.pdf | 0 | 0 | 0 | 4 | 2 | 4 |
| pdfium-smask-blend.pdf | 0 | 2 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 1 |
| synthetic-cjk-nonembedded.pdf | 14 | 14 | 3 | 2 | 2 | 2 |
| synthetic-text-1000.pdf | 30 | 38 | 3 | 1 | 12 | 13 |
| synthetic-vector-200k.pdf | 56 | 56 | 3 | 4 | 15 | 10 |
| usrguide.pdf | 43 | 40 | 7 | 12 | 15 | 14 |
| wdl6812-manuscript.pdf | 1 | 4 | 1 | 4 | 0 | 2 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 6.9 / 18.0 | 8.3 / 16.9 | 3.6 / 6.3 | 3.6 / 7.0 | 7.2 / 9.2 | 5.3 / 8.8 |
| bunka-kokugo-series-019-p4.pdf | 2.1 / 22.9 | 16.8 / 18.9 | 2.9 / 7.2 | 4.2 / 4.5 | 2.2 / 4.2 | 3.2 / 3.2 |
| f1040.pdf | 12.2 / 17.1 | 12.9 / 14.3 | 3.0 / 3.3 | 3.3 / 4.6 | 3.4 / 5.2 | 3.4 / 5.0 |
| mhlw-doc.pdf | 11.8 / 15.0 | 14.8 / 15.4 | 3.1 / 4.2 | 2.8 / 4.6 | 3.5 / 3.5 | 3.9 / 4.2 |
| nics-background-checks-2015-11.pdf | 14.7 / 14.7 | 12.6 / 12.6 | 3.1 / 3.1 | 3.2 / 3.6 | 3.4 / 3.4 | 5.9 / 5.9 |
| patent-us223898.pdf | 7.5 / 10.6 | 10.3 / 12.3 | 3.3 / 6.0 | 3.2 / 6.4 | 2.9 / 4.6 | 3.9 / 4.6 |
| pdfium-jpx-lzw.pdf | 2.4 / 2.4 | 2.4 / 2.4 | 2.5 / 2.5 | 4.9 / 4.9 | 2.1 / 4.8 | 5.0 / 5.0 |
| pdfium-smask-blend.pdf | 2.9 / 2.9 | 4.7 / 4.7 | 2.7 / 2.7 | 2.6 / 2.6 | 2.0 / 2.0 | 2.0 / 2.0 |
| pdfium-type3.pdf | 2.5 / 2.5 | 2.0 / 2.0 | 2.0 / 2.0 | 2.2 / 2.2 | 2.0 / 2.0 | 3.5 / 3.5 |
| synthetic-cjk-nonembedded.pdf | 14.9 / 14.9 | 14.5 / 14.5 | 5.1 / 5.1 | 4.6 / 4.6 | 4.9 / 4.9 | 4.6 / 4.6 |
| synthetic-text-1000.pdf | 5.3 / 10.1 | 5.8 / 9.5 | 2.2 / 4.0 | 2.7 / 3.3 | 3.7 / 4.5 | 3.6 / 7.5 |
| synthetic-vector-200k.pdf | 14.4 / 14.4 | 13.9 / 13.9 | 3.2 / 5.0 | 3.3 / 6.7 | 2.4 / 8.2 | 2.7 / 7.7 |
| usrguide.pdf | 6.1 / 15.9 | 6.4 / 12.6 | 3.0 / 5.0 | 3.2 / 5.1 | 4.2 / 5.7 | 3.5 / 4.6 |
| wdl6812-manuscript.pdf | 2.6 / 4.3 | 3.6 / 5.2 | 2.3 / 3.4 | 3.4 / 6.2 | 2.1 / 2.5 | 2.1 / 3.4 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 143 + 3 | 122 + 3 | 166 + 3 | 163 + 3 | 63 + 1 | 44 + 1 |
| bunka-kokugo-series-019-p4.pdf | 138 + 2 | 121 + 2 | 144 + 3 | 143 + 2 | 62 + 0 | 51 + 0 |
| f1040.pdf | 115 + 4 | 116 + 4 | 162 + 5 | 141 + 5 | 69 + 2 | 39 + 1 |
| mhlw-doc.pdf | 139 + 4 | 122 + 4 | 165 + 5 | 145 + 5 | 68 + 1 | 40 + 1 |
| nics-background-checks-2015-11.pdf | 138 + 2 | 136 + 2 | 141 + 2 | 165 + 2 | 57 + 0 | 34 + 0 |
| patent-us223898.pdf | 114 + 2 | 137 + 2 | 166 + 3 | 149 + 3 | 65 + 0 | 46 + 0 |
| pdfium-jpx-lzw.pdf | 116 + 2 | 134 + 2 | 149 + 2 | 168 + 2 | 64 + 0 | 51 + 0 |
| pdfium-smask-blend.pdf | 117 + 2 | 125 + 2 | 150 + 2 | 163 + 2 | 78 + 0 | 51 + 0 |
| pdfium-type3.pdf | 115 + 2 | 139 + 2 | 163 + 2 | 151 + 2 | 66 + 0 | 51 + 0 |
| synthetic-cjk-nonembedded.pdf | 139 + 3 | 121 + 3 | 165 + 3 | 158 + 3 | 61 + 1 | 38 + 0 |
| synthetic-text-1000.pdf | 120 + 76 | 129 + 76 | 146 + 80 | 137 + 75 | 64 + 2 | 45 + 24 |
| synthetic-vector-200k.pdf | 114 + 2 | 134 + 2 | 164 + 3 | 147 + 3 | 59 + 1 | 51 + 1 |
| usrguide.pdf | 143 + 7 | 136 + 7 | 150 + 7 | 162 + 7 | 65 + 1 | 41 + 2 |
| wdl6812-manuscript.pdf | 126 + 2 | 135 + 2 | 156 + 2 | 148 + 2 | 64 + 1 | 39 + 0 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | — | — | — | — | 45 | 47 |
| bunka-kokugo-series-019-p4.pdf | — | — | — | — | 38 | 35 |
| f1040.pdf | — | — | — | — | 30 | 21 |
| mhlw-doc.pdf | — | — | — | — | 33 | 21 |
| nics-background-checks-2015-11.pdf | — | — | — | — | 36 | 23 |
| patent-us223898.pdf | — | — | — | — | 21 | 50 |
| pdfium-jpx-lzw.pdf | — | — | — | — | 26 | 27 |
| pdfium-smask-blend.pdf | — | — | — | — | 18 | 3 |
| pdfium-type3.pdf | — | — | — | — | 18 | 3 |
| synthetic-cjk-nonembedded.pdf | — | — | — | — | 18 | 19 |
| synthetic-text-1000.pdf | — | — | — | — | 31 | 26 |
| synthetic-vector-200k.pdf | — | — | — | — | 38 | 60 |
| usrguide.pdf | — | — | — | — | 31 | 32 |
| wdl6812-manuscript.pdf | — | — | — | — | 18 | 18 |

