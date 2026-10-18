# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-10-18T11:58:45.150Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.4 ms (p95), and animation frames arrive every 16.7 ms.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium pnpm bench`

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
| bill-hr815.pdf | 83.2 | 83.3 | 84.1 | 83.2 | 67.3 | 83.1 |
| bunka-kokugo-series-019-p4.pdf | 116.5 | 116.5 | 166.6 | 149.9 | 166.6 | 66.6 |
| f1040.pdf | 99.9 | 83.3 | 99.9 | 100.1 | 66.9 | 82.7 |
| mhlw-doc.pdf | 83.3 | 83.3 | 99.8 | 100.0 | 66.8 | 83.2 |
| nics-background-checks-2015-11.pdf | 66.6 | 66.6 | 83.1 | 83.3 | 66.6 | 83.3 |
| patent-us223898.pdf | 66.0 | 66.6 | 99.9 | 83.3 | 116.6 | 83.2 |
| pdfium-jpx-lzw.pdf | 49.9 | 49.9 | 50.4 | 49.9 | 99.9 | 66.6 |
| pdfium-smask-blend.pdf | 49.9 | 49.9 | 49.9 | 49.9 | 33.3 | 33.3 |
| pdfium-type3.pdf | 49.9 | 50.0 | 49.9 | 49.9 | 33.3 | 49.9 |
| synthetic-cjk-nonembedded.pdf | 83.3 | 83.3 | 99.9 | 99.9 | 49.9 | 49.9 |
| synthetic-text-1000.pdf | 49.9 | 49.9 | 50.6 | 49.9 | 49.9 | 50.0 |
| synthetic-vector-200k.pdf | 99.9 | 100.7 | 116.6 | 100.0 | 399.9 | 249.8 |
| usrguide.pdf | 66.6 | 66.6 | 66.6 | 66.6 | 66.6 | 66.6 |
| wdl6812-manuscript.pdf | 83.2 | 83.3 | 83.3 | 83.3 | 99.9 | 82.6 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 63.8 | 52.9 | 68.8 | 54.5 | 39.8 | 50.4 |
| bunka-kokugo-series-019-p4.pdf | 89.3 | 83.9 | 146.1 | 118.9 | 145.6 | 40.3 |
| f1040.pdf | 68.0 | 55.9 | 80.0 | 75.4 | 47.8 | 51.3 |
| mhlw-doc.pdf | 53.4 | 60.1 | 87.5 | 81.4 | 43.5 | 53.7 |
| nics-background-checks-2015-11.pdf | 41.6 | 41.5 | 66.5 | 55.0 | 47.8 | 62.9 |
| patent-us223898.pdf | 35.7 | 34.3 | 76.8 | 62.5 | 99.9 | 54.4 |
| pdfium-jpx-lzw.pdf | 17.0 | 17.1 | 35.9 | 24.0 | 79.4 | 44.5 |
| pdfium-smask-blend.pdf | 17.6 | 17.4 | 21.2 | 18.0 | 9.0 | 15.9 |
| pdfium-type3.pdf | 17.4 | 17.5 | 21.3 | 18.9 | 6.6 | 19.2 |
| synthetic-cjk-nonembedded.pdf | 58.0 | 56.4 | 82.8 | 77.6 | 22.7 | 31.7 |
| synthetic-text-1000.pdf | 20.8 | 20.7 | 32.1 | 25.9 | 28.4 | 33.0 |
| synthetic-vector-200k.pdf | 70.7 | 68.5 | 104.9 | 70.5 | 375.0 | 223.8 |
| usrguide.pdf | 37.5 | 37.5 | 54.1 | 47.8 | 36.1 | 35.0 |
| wdl6812-manuscript.pdf | 49.7 | 50.3 | 63.0 | 52.2 | 67.0 | 58.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.0 / 83.2 | 50.0 / 83.3 | 50.0 / 84.1 | 50.0 / 83.2 | 50.0 / 67.3 | 50.0 / 83.1 |
| bunka-kokugo-series-019-p4.pdf | 116.5 / 116.6 | 116.5 / 116.7 | 166.6 / 167.9 | 149.9 / 150.0 | 166.6 / 166.7 | 66.6 / 66.6 |
| f1040.pdf | 50.1 / 100.3 | 50.7 / 83.3 | 67.0 / 99.9 | 50.2 / 100.3 | 50.0 / 67.7 | 50.9 / 83.2 |
| mhlw-doc.pdf | 50.9 / 83.3 | 50.1 / 83.3 | 50.0 / 99.9 | 50.0 / 100.2 | 33.9 / 67.3 | 35.0 / 85.0 |
| nics-background-checks-2015-11.pdf | 66.6 / 66.6 | 66.6 / 68.4 | 83.1 / 83.3 | 83.3 / 83.3 | 66.6 / 66.6 | 83.3 / 84.1 |
| patent-us223898.pdf | 66.7 / 331.7 | 66.7 / 133.4 | 83.5 / 349.7 | 66.7 / 133.3 | 68.3 / 134.0 | 50.0 / 83.2 |
| pdfium-jpx-lzw.pdf | 49.9 / 51.4 | 49.9 / 51.4 | 50.4 / 66.6 | 49.9 / 49.9 | 99.9 / 99.9 | 66.6 / 66.6 |
| pdfium-smask-blend.pdf | 49.9 / 50.8 | 49.9 / 50.6 | 49.9 / 50.0 | 49.9 / 50.4 | 33.3 / 33.9 | 33.3 / 48.0 |
| pdfium-type3.pdf | 49.9 / 50.1 | 50.0 / 51.7 | 49.9 / 50.4 | 49.9 / 50.7 | 33.3 / 33.3 | 49.9 / 50.3 |
| synthetic-cjk-nonembedded.pdf | 83.3 / 99.9 | 83.3 / 83.3 | 99.9 / 100.3 | 99.9 / 101.5 | 49.9 / 50.0 | 49.9 / 51.0 |
| synthetic-text-1000.pdf | 50.0 / 51.4 | 50.0 / 50.1 | 50.0 / 50.8 | 50.0 / 50.3 | 33.3 / 50.0 | 50.0 / 50.4 |
| synthetic-vector-200k.pdf | 99.9 / 100.0 | 100.7 / 100.8 | 116.6 / 116.6 | 100.0 / 101.8 | 399.9 / 401.1 | 249.8 / 249.9 |
| usrguide.pdf | 50.0 / 66.6 | 50.0 / 66.6 | 50.0 / 66.6 | 50.0 / 66.6 | 33.3 / 66.6 | 33.7 / 66.6 |
| wdl6812-manuscript.pdf | 66.7 / 83.3 | 66.7 / 84.7 | 66.6 / 83.3 | 66.7 / 84.1 | 67.9 / 99.9 | 50.5 / 83.5 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 52 | 27 | 8 | 0 | 1 | 1 |
| bunka-kokugo-series-019-p4.pdf | 4 | 0 | 37 | 30 | 0 | 0 |
| f1040.pdf | 39 | 29 | 2 | 0 | 0 | 0 |
| mhlw-doc.pdf | 31 | 27 | 5 | 0 | 0 | 1 |
| nics-background-checks-2015-11.pdf | 18 | 13 | 5 | 0 | 0 | 0 |
| patent-us223898.pdf | 0 | 0 | 58 | 47 | 0 | 0 |
| pdfium-jpx-lzw.pdf | 1 | 0 | 3 | 0 | 0 | 0 |
| pdfium-smask-blend.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 25 | 22 | 2 | 0 | 0 | 0 |
| synthetic-text-1000.pdf | 33 | 5 | 1 | 0 | 1 | 0 |
| synthetic-vector-200k.pdf | 43 | 2 | 11 | 0 | 0 | 0 |
| usrguide.pdf | 50 | 32 | 4 | 0 | 1 | 0 |
| wdl6812-manuscript.pdf | 0 | 0 | 9 | 2 | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 4.5 / 31.7 | 2.9 / 18.8 | 2.0 / 8.4 | 1.6 / 2.0 | 1.7 / 2.8 | 1.7 / 2.8 |
| bunka-kokugo-series-019-p4.pdf | 3.0 / 4.1 | 1.3 / 1.5 | 5.2 / 33.8 | 1.4 / 31.6 | 1.4 / 2.0 | 1.5 / 1.5 |
| f1040.pdf | 13.6 / 16.3 | 9.8 / 16.2 | 2.1 / 3.6 | 1.4 / 1.5 | 1.5 / 1.9 | 1.6 / 1.9 |
| mhlw-doc.pdf | 13.8 / 16.6 | 3.8 / 23.9 | 2.8 / 5.7 | 1.4 / 1.6 | 1.6 / 1.9 | 1.5 / 2.6 |
| nics-background-checks-2015-11.pdf | 17.5 / 17.5 | 15.3 / 15.3 | 3.6 / 5.6 | 1.1 / 1.2 | 1.7 / 1.7 | 1.4 / 1.5 |
| patent-us223898.pdf | 1.6 / 2.3 | 1.4 / 1.9 | 11.6 / 18.0 | 10.1 / 17.9 | 1.4 / 1.7 | 1.6 / 2.0 |
| pdfium-jpx-lzw.pdf | 2.8 / 2.8 | 1.2 / 1.2 | 5.0 / 5.0 | 1.9 / 1.9 | 1.4 / 1.9 | 2.3 / 2.3 |
| pdfium-smask-blend.pdf | 1.4 / 1.4 | 1.1 / 1.1 | 2.4 / 2.4 | 1.5 / 1.5 | 1.1 / 1.1 | 1.4 / 1.4 |
| pdfium-type3.pdf | 1.3 / 1.3 | 1.4 / 1.4 | 1.9 / 1.9 | 1.6 / 1.6 | 1.1 / 1.1 | 1.4 / 1.4 |
| synthetic-cjk-nonembedded.pdf | 26.3 / 26.3 | 24.4 / 24.4 | 1.3 / 3.6 | 1.5 / 1.6 | 1.7 / 1.7 | 1.8 / 1.8 |
| synthetic-text-1000.pdf | 5.3 / 8.2 | 1.8 / 5.8 | 1.5 / 2.6 | 1.5 / 2.0 | 1.6 / 3.0 | 1.5 / 2.1 |
| synthetic-vector-200k.pdf | 28.7 / 28.7 | 1.9 / 3.5 | 3.7 / 11.4 | 1.3 / 1.5 | 1.4 / 1.9 | 1.4 / 2.0 |
| usrguide.pdf | 7.1 / 14.0 | 4.8 / 12.7 | 2.0 / 4.7 | 1.5 / 2.0 | 1.6 / 3.2 | 1.5 / 1.8 |
| wdl6812-manuscript.pdf | 1.7 / 1.9 | 1.3 / 1.5 | 6.4 / 6.5 | 1.5 / 3.5 | 1.4 / 1.7 | 1.6 / 1.8 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 89 + 4 | 93 + 3 | 104 + 4 | 129 + 4 | 49 + 3 | 20 + 4 |
| bunka-kokugo-series-019-p4.pdf | 84 + 3 | 97 + 3 | 107 + 4 | 100 + 4 | 41 + 3 | 19 + 12 |
| f1040.pdf | 103 + 5 | 103 + 5 | 104 + 6 | 105 + 6 | 35 + 5 | 28 + 17 |
| mhlw-doc.pdf | 103 + 5 | 91 + 5 | 113 + 5 | 104 + 5 | 45 + 4 | 32 + 17 |
| nics-background-checks-2015-11.pdf | 84 + 2 | 101 + 3 | 122 + 3 | 99 + 3 | 29 + 2 | 17 + 2 |
| patent-us223898.pdf | 77 + 3 | 76 + 3 | 99 + 4 | 98 + 4 | 34 + 2 | 26 + 4 |
| pdfium-jpx-lzw.pdf | 75 + 2 | 75 + 3 | 128 + 3 | 115 + 3 | 31 + 1 | 16 + 2 |
| pdfium-smask-blend.pdf | 76 + 3 | 74 + 3 | 99 + 3 | 98 + 3 | 29 + 2 | 16 + 2 |
| pdfium-type3.pdf | 76 + 3 | 76 + 2 | 100 + 3 | 98 + 3 | 31 + 2 | 16 + 2 |
| synthetic-cjk-nonembedded.pdf | 77 + 3 | 76 + 3 | 100 + 4 | 98 + 4 | 30 + 3 | 17 + 12 |
| synthetic-text-1000.pdf | 77 + 54 | 103 + 54 | 104 + 56 | 99 + 54 | 30 + 4 | 17 + 28 |
| synthetic-vector-200k.pdf | 76 + 3 | 75 + 3 | 99 + 4 | 99 + 4 | 40 + 3 | 25 + 13 |
| usrguide.pdf | 95 + 7 | 89 + 7 | 114 + 7 | 108 + 7 | 38 + 3 | 16 + 13 |
| wdl6812-manuscript.pdf | 94 + 3 | 78 + 3 | 99 + 3 | 100 + 3 | 36 + 3 | 26 + 3 |

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

