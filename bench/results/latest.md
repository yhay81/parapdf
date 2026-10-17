# ParaPDF engine benchmark

- Run at: 2026-10-17T16:01:12.680Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (headless), GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && pnpm bench`

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
| bill-hr815.pdf | 83.5 | 83.2 | 83.3 | 83.4 | 66.6 | 66.5 |
| bunka-kokugo-series-019-p4.pdf | 117.0 | 117.1 | 199.9 | 166.6 | 183.3 | 66.6 |
| f1040.pdf | 99.9 | 83.3 | 99.8 | 99.9 | 66.7 | 66.6 |
| mhlw-doc.pdf | 83.2 | 83.0 | 116.2 | 115.9 | 66.8 | 66.6 |
| nics-background-checks-2015-11.pdf | 83.2 | 66.6 | 83.2 | 83.6 | 82.6 | 99.7 |
| patent-us223898.pdf | 83.8 | 66.6 | 100.3 | 83.2 | 116.6 | 66.6 |
| pdfium-jpx-lzw.pdf | 49.9 | 49.9 | 66.3 | 50.0 | 116.4 | 67.1 |
| pdfium-smask-blend.pdf | 50.3 | 50.0 | 49.8 | 50.0 | 33.3 | 32.9 |
| pdfium-type3.pdf | 49.9 | 49.9 | 49.9 | 50.2 | 32.8 | 49.8 |
| synthetic-cjk-nonembedded.pdf | 99.9 | 100.0 | 99.9 | 100.0 | 50.0 | 49.9 |
| synthetic-text-1000.pdf | 49.5 | 49.9 | 50.5 | 49.9 | 66.4 | 66.6 |
| synthetic-vector-200k.pdf | 100.0 | 99.8 | 116.6 | 99.9 | 400.2 | 250.1 |
| usrguide.pdf | 66.6 | 66.5 | 66.6 | 66.6 | 66.6 | 66.5 |
| wdl6812-manuscript.pdf | 99.9 | 83.3 | 83.3 | 83.2 | 83.0 | 83.3 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 65.5 | 54.1 | 70.6 | 55.7 | 40.1 | 48.7 |
| bunka-kokugo-series-019-p4.pdf | 91.0 | 84.0 | 186.1 | 139.0 | 158.3 | 43.8 |
| f1040.pdf | 71.4 | 56.5 | 84.5 | 76.1 | 45.6 | 45.3 |
| mhlw-doc.pdf | 60.7 | 60.8 | 96.2 | 89.8 | 42.0 | 47.7 |
| nics-background-checks-2015-11.pdf | 52.5 | 42.0 | 70.9 | 62.7 | 51.7 | 67.6 |
| patent-us223898.pdf | 52.8 | 34.3 | 75.2 | 63.5 | 98.8 | 48.4 |
| pdfium-jpx-lzw.pdf | 17.0 | 16.3 | 40.4 | 31.1 | 83.5 | 46.8 |
| pdfium-smask-blend.pdf | 17.7 | 17.7 | 21.8 | 18.4 | 9.2 | 15.5 |
| pdfium-type3.pdf | 17.0 | 17.3 | 21.0 | 18.7 | 6.4 | 19.6 |
| synthetic-cjk-nonembedded.pdf | 78.7 | 75.3 | 81.1 | 76.2 | 22.5 | 30.9 |
| synthetic-text-1000.pdf | 20.1 | 20.5 | 31.3 | 25.5 | 33.1 | 34.6 |
| synthetic-vector-200k.pdf | 70.3 | 68.2 | 102.7 | 70.5 | 374.3 | 222.9 |
| usrguide.pdf | 37.6 | 37.4 | 53.8 | 47.5 | 36.1 | 39.8 |
| wdl6812-manuscript.pdf | 67.0 | 50.0 | 62.6 | 51.5 | 66.8 | 56.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.0 / 83.5 | 50.0 / 83.2 | 50.0 / 83.3 | 50.0 / 83.4 | 50.0 / 66.6 | 50.0 / 66.5 |
| bunka-kokugo-series-019-p4.pdf | 117.0 / 132.9 | 117.1 / 133.2 | 199.9 / 217.2 | 166.6 / 166.6 | 183.3 / 183.6 | 66.6 / 66.6 |
| f1040.pdf | 50.0 / 100.0 | 50.5 / 83.6 | 66.9 / 100.0 | 66.7 / 99.9 | 50.0 / 67.0 | 50.0 / 67.3 |
| mhlw-doc.pdf | 50.0 / 83.2 | 50.4 / 83.1 | 50.5 / 116.6 | 50.4 / 116.1 | 49.8 / 100.2 | 33.3 / 66.6 |
| nics-background-checks-2015-11.pdf | 83.2 / 83.3 | 66.6 / 83.2 | 83.2 / 83.2 | 83.6 / 84.1 | 82.6 / 83.0 | 99.7 / 99.9 |
| patent-us223898.pdf | 83.1 / 183.9 | 67.1 / 133.4 | 99.8 / 149.9 | 83.2 / 149.8 | 66.8 / 117.1 | 50.0 / 83.3 |
| pdfium-jpx-lzw.pdf | 49.9 / 50.6 | 49.9 / 49.9 | 66.3 / 66.7 | 50.0 / 99.8 | 116.4 / 117.0 | 67.1 / 83.2 |
| pdfium-smask-blend.pdf | 50.3 / 50.6 | 50.0 / 50.3 | 49.8 / 49.9 | 50.0 / 50.2 | 33.3 / 33.3 | 32.9 / 33.2 |
| pdfium-type3.pdf | 49.9 / 50.7 | 49.9 / 50.7 | 49.9 / 50.0 | 50.2 / 50.4 | 32.8 / 32.9 | 49.8 / 49.9 |
| synthetic-cjk-nonembedded.pdf | 99.9 / 100.4 | 100.0 / 100.0 | 99.9 / 150.2 | 100.0 / 100.3 | 50.0 / 50.1 | 49.9 / 50.6 |
| synthetic-text-1000.pdf | 50.0 / 50.8 | 50.0 / 50.6 | 50.0 / 50.8 | 50.0 / 50.8 | 34.0 / 66.4 | 50.0 / 66.6 |
| synthetic-vector-200k.pdf | 100.0 / 100.6 | 99.8 / 99.9 | 116.6 / 116.6 | 99.9 / 99.9 | 400.2 / 400.4 | 250.1 / 250.7 |
| usrguide.pdf | 50.0 / 66.6 | 50.0 / 66.5 | 50.0 / 66.6 | 50.0 / 66.6 | 33.5 / 66.6 | 49.8 / 66.5 |
| wdl6812-manuscript.pdf | 67.3 / 100.5 | 66.7 / 83.4 | 67.2 / 83.3 | 50.3 / 83.3 | 67.4 / 99.3 | 50.0 / 83.3 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 122 | 85 | 89 | 65 | 74 | 75 |
| bunka-kokugo-series-019-p4.pdf | 26 | 17 | 88 | 55 | 32 | 13 |
| f1040.pdf | 66 | 48 | 32 | 23 | 18 | 19 |
| mhlw-doc.pdf | 50 | 49 | 35 | 24 | 18 | 17 |
| nics-background-checks-2015-11.pdf | 32 | 22 | 17 | 12 | 14 | 15 |
| patent-us223898.pdf | 56 | 45 | 111 | 100 | 44 | 31 |
| pdfium-jpx-lzw.pdf | 10 | 8 | 15 | 9 | 20 | 13 |
| pdfium-smask-blend.pdf | 9 | 8 | 9 | 8 | 4 | 4 |
| pdfium-type3.pdf | 8 | 9 | 11 | 9 | 5 | 7 |
| synthetic-cjk-nonembedded.pdf | 48 | 39 | 17 | 15 | 7 | 8 |
| synthetic-text-1000.pdf | 104 | 84 | 68 | 62 | 61 | 66 |
| synthetic-vector-200k.pdf | 56 | 22 | 33 | 16 | 92 | 54 |
| usrguide.pdf | 121 | 104 | 74 | 67 | 52 | 59 |
| wdl6812-manuscript.pdf | 26 | 20 | 30 | 22 | 24 | 19 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 2.5 / 33.6 | 1.2 / 18.8 | 2.0 / 10.4 | 1.1 / 1.4 | 1.4 / 4.1 | 1.3 / 3.6 |
| bunka-kokugo-series-019-p4.pdf | 3.0 / 5.6 | 1.0 / 1.1 | 6.4 / 57.1 | 1.4 / 38.8 | 1.1 / 1.4 | 1.1 / 1.3 |
| f1040.pdf | 14.4 / 24.9 | 13.6 / 16.4 | 1.7 / 5.5 | 1.1 / 1.3 | 1.1 / 2.5 | 1.3 / 3.0 |
| mhlw-doc.pdf | 5.5 / 27.6 | 5.9 / 26.9 | 1.6 / 6.7 | 1.3 / 1.4 | 1.2 / 2.5 | 1.5 / 2.4 |
| nics-background-checks-2015-11.pdf | 15.1 / 15.1 | 14.6 / 14.6 | 1.4 / 5.8 | 1.1 / 1.1 | 1.2 / 2.9 | 1.1 / 1.2 |
| patent-us223898.pdf | 1.3 / 3.6 | 1.2 / 1.5 | 4.4 / 17.4 | 13.1 / 18.6 | 1.0 / 1.9 | 1.3 / 2.1 |
| pdfium-jpx-lzw.pdf | 2.7 / 2.7 | 1.1 / 1.1 | 7.4 / 7.4 | 1.2 / 1.2 | 1.3 / 1.5 | 1.3 / 2.5 |
| pdfium-smask-blend.pdf | 1.9 / 1.9 | 0.9 / 0.9 | 1.4 / 1.4 | 1.3 / 1.3 | 1.1 / 1.1 | 0.7 / 0.7 |
| pdfium-type3.pdf | 1.1 / 1.1 | 1.0 / 1.0 | 2.8 / 2.8 | 1.1 / 1.1 | 1.3 / 1.3 | 1.3 / 1.3 |
| synthetic-cjk-nonembedded.pdf | 33.3 / 33.3 | 27.4 / 27.4 | 1.4 / 5.1 | 1.1 / 1.2 | 1.3 / 1.3 | 1.4 / 1.4 |
| synthetic-text-1000.pdf | 4.5 / 8.9 | 2.2 / 7.3 | 1.3 / 4.6 | 1.0 / 1.2 | 1.3 / 2.3 | 1.1 / 3.1 |
| synthetic-vector-200k.pdf | 27.7 / 27.7 | 2.3 / 4.4 | 4.5 / 10.6 | 1.1 / 1.5 | 1.2 / 2.2 | 1.3 / 1.4 |
| usrguide.pdf | 5.5 / 10.9 | 4.0 / 10.4 | 1.5 / 4.4 | 1.1 / 1.5 | 1.4 / 2.3 | 1.2 / 2.8 |
| wdl6812-manuscript.pdf | 1.5 / 2.5 | 1.1 / 1.5 | 4.1 / 5.2 | 1.6 / 3.7 | 1.0 / 1.3 | 1.2 / 1.3 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 120 + 4 | 83 + 3 | 106 + 4 | 107 + 4 | 42 + 3 | 23 + 3 |
| bunka-kokugo-series-019-p4.pdf | 78 + 3 | 80 + 3 | 106 + 4 | 103 + 4 | 40 + 3 | 26 + 12 |
| f1040.pdf | 81 + 6 | 83 + 5 | 102 + 6 | 102 + 6 | 36 + 5 | 23 + 12 |
| mhlw-doc.pdf | 82 + 5 | 112 + 6 | 132 + 5 | 140 + 7 | 40 + 4 | 22 + 12 |
| nics-background-checks-2015-11.pdf | 78 + 3 | 81 + 3 | 110 + 3 | 109 + 3 | 38 + 2 | 23 + 3 |
| patent-us223898.pdf | 86 + 3 | 79 + 3 | 99 + 3 | 99 + 3 | 36 + 2 | 23 + 3 |
| pdfium-jpx-lzw.pdf | 81 + 2 | 77 + 3 | 108 + 3 | 111 + 4 | 37 + 1 | 26 + 3 |
| pdfium-smask-blend.pdf | 82 + 3 | 83 + 3 | 106 + 3 | 103 + 3 | 37 + 2 | 21 + 2 |
| pdfium-type3.pdf | 76 + 2 | 78 + 3 | 104 + 3 | 119 + 3 | 52 + 2 | 27 + 2 |
| synthetic-cjk-nonembedded.pdf | 93 + 3 | 84 + 4 | 131 + 5 | 108 + 4 | 36 + 3 | 21 + 12 |
| synthetic-text-1000.pdf | 75 + 51 | 77 + 49 | 102 + 51 | 100 + 52 | 46 + 5 | 27 + 28 |
| synthetic-vector-200k.pdf | 76 + 3 | 77 + 3 | 101 + 4 | 97 + 4 | 35 + 3 | 21 + 12 |
| usrguide.pdf | 78 + 6 | 75 + 6 | 98 + 7 | 99 + 7 | 36 + 3 | 25 + 13 |
| wdl6812-manuscript.pdf | 86 + 3 | 81 + 3 | 100 + 3 | 99 + 3 | 39 + 3 | 23 + 3 |

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

