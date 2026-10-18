# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-10-18T12:05:11.172Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.8 ms late (median) / 5.6 ms (p95), and animation frames arrive every 16.7 ms.
- Engines: pdfjs-dist 6.4.299 (main-thread drawing), pdf.js master 157d30e 2026-10-17 (renderer worker), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 10 pages rendered one after another, fresh page per job, median of 3 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit pnpm bench`

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
| bill-hr815.pdf | 116.3 | 99.8 | 99.9 | 99.9 | 67.0 | 66.7 |
| bunka-kokugo-series-019-p4.pdf | 149.9 | 133.2 | 186.3 | 200.0 | 100.7 | 66.7 |
| f1040.pdf | 99.9 | 99.9 | 116.6 | 116.6 | 81.9 | 67.0 |
| mhlw-doc.pdf | 83.4 | 83.5 | 99.9 | 100.0 | 66.4 | 67.6 |
| nics-background-checks-2015-11.pdf | 83.2 | 84.2 | 99.6 | 99.9 | 84.6 | 83.3 |
| patent-us223898.pdf | 99.9 | 83.2 | 99.8 | 100.1 | 83.5 | 67.5 |
| pdfium-jpx-lzw.pdf | 49.9 | 49.9 | 66.5 | 65.7 | 83.5 | 66.6 |
| pdfium-smask-blend.pdf | 49.8 | 49.9 | 49.7 | 49.9 | 33.3 | 33.2 |
| pdfium-type3.pdf | 49.9 | 49.9 | 49.6 | 50.0 | 33.3 | 33.3 |
| synthetic-cjk-nonembedded.pdf | 100.0 | 99.4 | 100.2 | 99.9 | 49.6 | 50.3 |
| synthetic-text-1000.pdf | 49.9 | 50.1 | 49.9 | 66.5 | 49.8 | 49.9 |
| synthetic-vector-200k.pdf | 166.6 | 99.6 | 153.0 | 116.4 | 399.8 | 266.9 |
| usrguide.pdf | 83.5 | 83.3 | 83.3 | 83.3 | 66.2 | 50.4 |
| wdl6812-manuscript.pdf | 99.9 | 100.0 | 84.4 | 99.8 | 83.2 | 66.6 |

## First page committed to the canvas, cold (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 97.8 | 56.3 | 73.8 | 78.8 | 42.0 | 38.5 |
| bunka-kokugo-series-019-p4.pdf | 129.3 | 101.5 | 161.1 | 176.5 | 82.1 | 49.2 |
| f1040.pdf | 73.5 | 74.0 | 84.6 | 89.3 | 52.8 | 49.3 |
| mhlw-doc.pdf | 58.3 | 58.6 | 73.9 | 73.9 | 45.3 | 43.3 |
| nics-background-checks-2015-11.pdf | 55.5 | 55.9 | 68.5 | 68.6 | 54.1 | 54.4 |
| patent-us223898.pdf | 68.2 | 51.6 | 81.8 | 82.4 | 61.6 | 39.9 |
| pdfium-jpx-lzw.pdf | 17.1 | 17.2 | 34.9 | 34.2 | 57.8 | 41.8 |
| pdfium-smask-blend.pdf | 18.2 | 17.6 | 19.3 | 19.8 | 13.6 | 7.7 |
| pdfium-type3.pdf | 17.6 | 17.5 | 18.7 | 19.5 | 5.1 | 6.0 |
| synthetic-cjk-nonembedded.pdf | 72.4 | 67.2 | 74.3 | 74.5 | 20.3 | 33.3 |
| synthetic-text-1000.pdf | 20.2 | 20.3 | 31.3 | 33.9 | 27.4 | 30.6 |
| synthetic-vector-200k.pdf | 88.7 | 72.1 | 128.2 | 84.9 | 378.7 | 234.3 |
| usrguide.pdf | 56.1 | 54.4 | 66.6 | 62.5 | 39.1 | 33.3 |
| wdl6812-manuscript.pdf | 66.8 | 67.3 | 65.9 | 69.0 | 61.5 | 44.2 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 50.0 / 116.3 | 50.0 / 99.8 | 50.1 / 99.9 | 50.0 / 99.9 | 33.4 / 67.0 | 49.9 / 66.7 |
| bunka-kokugo-series-019-p4.pdf | 149.9 / 167.1 | 133.2 / 133.5 | 186.3 / 217.0 | 200.0 / 200.0 | 100.7 / 115.6 | 66.7 / 66.8 |
| f1040.pdf | 50.8 / 99.9 | 50.0 / 101.5 | 66.5 / 116.8 | 66.6 / 116.9 | 50.7 / 84.6 | 50.0 / 84.8 |
| mhlw-doc.pdf | 50.5 / 101.4 | 50.0 / 84.0 | 50.1 / 100.9 | 50.0 / 101.1 | 34.2 / 83.2 | 32.1 / 68.1 |
| nics-background-checks-2015-11.pdf | 83.2 / 83.3 | 84.2 / 84.6 | 99.6 / 99.9 | 99.9 / 100.1 | 84.6 / 84.9 | 83.3 / 83.3 |
| patent-us223898.pdf | 83.3 / 100.2 | 83.2 / 84.1 | 83.3 / 99.9 | 83.1 / 101.0 | 81.5 / 84.0 | 50.0 / 67.8 |
| pdfium-jpx-lzw.pdf | 49.9 / 49.9 | 49.9 / 50.9 | 66.5 / 66.6 | 65.7 / 66.6 | 83.5 / 85.6 | 66.6 / 66.7 |
| pdfium-smask-blend.pdf | 49.8 / 50.3 | 49.9 / 50.0 | 49.7 / 50.0 | 49.9 / 50.0 | 33.3 / 33.4 | 33.2 / 33.9 |
| pdfium-type3.pdf | 49.9 / 51.6 | 49.9 / 49.9 | 49.6 / 50.7 | 50.0 / 50.0 | 33.3 / 33.3 | 33.3 / 33.6 |
| synthetic-cjk-nonembedded.pdf | 100.0 / 100.5 | 99.4 / 99.6 | 100.2 / 100.4 | 99.9 / 100.3 | 49.6 / 49.9 | 50.3 / 66.5 |
| synthetic-text-1000.pdf | 49.9 / 51.7 | 50.0 / 50.5 | 50.0 / 50.9 | 50.0 / 66.5 | 33.4 / 49.9 | 34.9 / 51.0 |
| synthetic-vector-200k.pdf | 166.6 / 166.9 | 99.6 / 99.9 | 153.0 / 181.3 | 116.4 / 116.9 | 399.8 / 416.5 | 266.9 / 267.1 |
| usrguide.pdf | 50.0 / 83.5 | 50.0 / 83.3 | 50.0 / 83.3 | 50.0 / 83.3 | 33.4 / 66.2 | 33.4 / 50.4 |
| wdl6812-manuscript.pdf | 83.3 / 99.9 | 83.3 / 100.1 | 82.8 / 85.3 | 83.3 / 101.5 | 67.4 / 83.3 | 50.0 / 66.7 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 36 | 1 | 1 | 0 | 1 | 1 |
| bunka-kokugo-series-019-p4.pdf | 20 | 0 | 23 | 25 | 0 | 0 |
| f1040.pdf | 6 | 4 | 0 | 0 | 0 | 0 |
| mhlw-doc.pdf | 1 | 2 | 0 | 1 | 0 | 0 |
| nics-background-checks-2015-11.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| patent-us223898.pdf | 0 | 0 | 17 | 14 | 0 | 0 |
| pdfium-jpx-lzw.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-smask-blend.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| pdfium-type3.pdf | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic-cjk-nonembedded.pdf | 9 | 10 | 0 | 0 | 0 | 0 |
| synthetic-text-1000.pdf | 0 | 1 | 0 | 0 | 0 | 0 |
| synthetic-vector-200k.pdf | 5 | 2 | 0 | 0 | 1 | 1 |
| usrguide.pdf | 0 | 1 | 0 | 1 | 0 | 1 |
| wdl6812-manuscript.pdf | 1 | 0 | 0 | 0 | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 5.8 / 23.2 | 5.7 / 6.0 | 5.4 / 5.8 | 5.4 / 5.8 | 5.7 / 5.7 | 5.4 / 6.0 |
| bunka-kokugo-series-019-p4.pdf | 5.9 / 25.1 | 5.0 / 5.3 | 5.4 / 28.3 | 5.6 / 29.9 | 4.9 / 5.3 | 5.4 / 5.4 |
| f1040.pdf | 5.9 / 10.4 | 5.9 / 7.6 | 5.3 / 5.6 | 5.4 / 5.7 | 5.5 / 5.9 | 5.0 / 5.5 |
| mhlw-doc.pdf | 5.1 / 6.6 | 5.4 / 7.7 | 5.2 / 5.4 | 5.2 / 5.8 | 5.8 / 5.8 | 4.9 / 4.9 |
| nics-background-checks-2015-11.pdf | 5.3 / 5.3 | 5.3 / 5.3 | 4.6 / 4.9 | 5.0 / 5.7 | 5.1 / 5.1 | 5.8 / 5.8 |
| patent-us223898.pdf | 5.4 / 5.7 | 5.3 / 5.8 | 8.5 / 15.1 | 6.8 / 13.3 | 5.6 / 5.7 | 5.6 / 5.7 |
| pdfium-jpx-lzw.pdf | 4.3 / 4.3 | 4.8 / 4.8 | 5.8 / 5.8 | 5.6 / 5.6 | 5.5 / 5.5 | 5.4 / 5.4 |
| pdfium-smask-blend.pdf | 5.5 / 5.5 | 5.0 / 5.0 | 5.6 / 5.6 | 5.4 / 5.4 | 1.0 / 1.0 | 1.0 / 1.0 |
| pdfium-type3.pdf | 5.4 / 5.4 | 5.1 / 5.1 | 5.1 / 5.1 | 5.0 / 5.0 | 1.0 / 1.0 | 1.1 / 1.1 |
| synthetic-cjk-nonembedded.pdf | 14.3 / 14.3 | 15.9 / 15.9 | 5.9 / 5.9 | 5.6 / 5.6 | 3.3 / 3.3 | 4.7 / 4.7 |
| synthetic-text-1000.pdf | 5.5 / 5.9 | 5.7 / 6.5 | 5.6 / 5.8 | 5.6 / 5.9 | 5.3 / 5.9 | 5.8 / 6.0 |
| synthetic-vector-200k.pdf | 5.4 / 10.6 | 7.3 / 7.3 | 5.5 / 5.9 | 5.6 / 5.6 | 5.7 / 6.0 | 5.7 / 6.0 |
| usrguide.pdf | 5.7 / 6.0 | 5.9 / 6.0 | 5.6 / 5.8 | 5.6 / 5.9 | 5.5 / 5.9 | 5.7 / 5.9 |
| wdl6812-manuscript.pdf | 5.9 / 5.9 | 5.8 / 5.9 | 5.7 / 5.9 | 5.6 / 6.0 | 5.0 / 5.1 | 4.9 / 5.7 |

## Engine init + document open (ms)

| File | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa | pdfium | hayro |
|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | 99 + 5 | 87 + 5 | 122 + 6 | 119 + 6 | 56 + 4 | 27 + 3 |
| bunka-kokugo-series-019-p4.pdf | 92 + 5 | 101 + 5 | 110 + 5 | 127 + 5 | 46 + 2 | 35 + 2 |
| f1040.pdf | 86 + 6 | 101 + 7 | 111 + 8 | 118 + 8 | 33 + 7 | 29 + 3 |
| mhlw-doc.pdf | 105 + 7 | 93 + 7 | 113 + 7 | 115 + 8 | 44 + 3 | 27 + 2 |
| nics-background-checks-2015-11.pdf | 112 + 4 | 98 + 4 | 113 + 5 | 110 + 4 | 41 + 2 | 25 + 1 |
| patent-us223898.pdf | 100 + 5 | 85 + 4 | 109 + 5 | 114 + 5 | 47 + 2 | 27 + 2 |
| pdfium-jpx-lzw.pdf | 87 + 4 | 110 + 4 | 126 + 4 | 107 + 4 | 35 + 1 | 27 + 1 |
| pdfium-smask-blend.pdf | 83 + 4 | 84 + 4 | 112 + 4 | 113 + 4 | 40 + 1 | 33 + 1 |
| pdfium-type3.pdf | 82 + 4 | 86 + 4 | 110 + 4 | 126 + 4 | 36 + 1 | 26 + 1 |
| synthetic-cjk-nonembedded.pdf | 102 + 5 | 90 + 5 | 111 + 5 | 122 + 5 | 38 + 2 | 37 + 2 |
| synthetic-text-1000.pdf | 105 + 52 | 92 + 52 | 123 + 53 | 128 + 55 | 42 + 4 | 25 + 20 |
| synthetic-vector-200k.pdf | 106 + 6 | 99 + 6 | 131 + 6 | 131 + 6 | 38 + 2 | 33 + 2 |
| usrguide.pdf | 99 + 9 | 97 + 10 | 129 + 10 | 133 + 10 | 36 + 2 | 32 + 5 |
| wdl6812-manuscript.pdf | 94 + 4 | 91 + 4 | 132 + 5 | 126 + 4 | 35 + 3 | 29 + 1 |

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

