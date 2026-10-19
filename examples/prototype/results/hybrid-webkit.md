# ParaPDF hybrid engine: WebKit 27.2

- Run at: 2026-10-19T00:04:03.266Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 5.6 ms (p95); animation frames every 13.9 ms.
- Load: jobs started only while no other Playwright browser was open and the 1-minute load average was at most 6; at job start it was 4.4 (median), 5.9 at most, on 12 logical cores.
- Variants: `pdfjs-next-hwa` is pdf.js master with its renderer worker on a GPU-backed canvas; `hybrid-hwa` is the same engine with image-only pages rendered by hayro (wasm, simd128) in the hybrid worker. Text, links, and search come from pdf.js in both.
- Method: fresh browser context per job, 1280×900 viewport at devicePixelRatio 2, fit-width zoom; 5 runs per file, speed, and variant, alternating which variant goes first; startup numbers pool both speeds (10 jobs per cell). Medians throughout.
- First paint: navigation start until page 1 shows pixels (its low-resolution base layer). Page 1 sharp: until page 1's full-resolution layer is on the canvas.
- Longest stall: the largest lateness of a 4 ms timer on the main thread, from startup until the scroll begins (startup) or during the scroll. Blocked: summed lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger.
- Render: from the scheduler's request until the pixels are on the canvas, per canvas layer (base at half a device pixel per CSS pixel, detail at full resolution) and per engine; median of each job's median. Renders overlap (two at a time), so this is latency, not CPU time.
- Reproduce: `pnpm bench:build && pnpm --filter @parapdf/prototype build && BROWSER=webkit pnpm --filter @parapdf/prototype bench:hybrid`

## Startup

| File | Variant | First paint (ms) | Page 1 sharp (ms) | Longest stall (ms) | Blocked (ms) | Render base hayro (ms) | Render base pdfjs (ms) | Render detail hayro (ms) | Render detail pdfjs (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 535 | 571 | 31.8 | 43 | — | 176 | — | 33 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 411 | 469 | 13.9 | 14 | 48 | — | 58 | — |
| patent-us223898.pdf | pdfjs-next-hwa | 498 | 543 | 29.4 | 71 | — | 121 | — | 38 |
| patent-us223898.pdf | hybrid-hwa | 408 | 466 | 14.7 | 24 | 45 | — | 34 | — |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 477 | 523 | 16.1 | 16 | — | 114 | — | 49 |
| wdl6812-manuscript.pdf | hybrid-hwa | 425 | 514 | 14.1 | 13 | 65 | — | 92 | — |
| bill-hr815.pdf | pdfjs-next-hwa | 439 | 505 | 12.4 | 29 | — | 44 | — | 49 |
| bill-hr815.pdf | hybrid-hwa | 448 | 505 | 13.1 | 31 | — | 41 | — | 51 |

## Hybrid engine internals

Times are medians across jobs. Classifier ready: navigation start until the worker had fetched the PDF and parsed it. Classify: time inside the worker per page, and the round trip from the main thread. hayro load: fetching and compiling the module, then parsing the PDF a second time.

| File | Pages to hayro / pdf.js | Classifier ready (ms) | Fetch / wait for module / parse (ms) | Classify p50 / max (ms) | Round trip p50 (ms) | hayro load / parse (ms) | hayro ready (ms) | Classifier / hayro memory (MiB) | Fallbacks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| bunka-kokugo-series-019-p4.pdf | 1 / 0 | 351 | 6.5 / 0.0 / 2.2 | 0.45 / 0.45 | 1.1 | 19 / 1.8 | 411 | 1.3 / 102.9 | none |
| patent-us223898.pdf | 4 / 0 | 350 | 5.1 / 0.0 / 1.9 | 0.70 / 1.53 | 2.4 | 18 / 1.1 | 408 | 1.6 / 83.9 | none |
| wdl6812-manuscript.pdf | 2 / 0 | 349 | 6.0 / 0.0 / 1.5 | 0.24 / 0.58 | 1.3 | 20 / 1.2 | 424 | 1.4 / 51.3 | none |
| bill-hr815.pdf | 0 / 8 | 346 | 6.4 / 0.0 / 4.4 | 0.22 / 1.64 | 1.8 | — / — | — | 1.7 / 0.0 | none |

## Scrolling

| File | Speed (px/s) | Variant | Pages crossed | Blank (%) | Blocked (ms) | Longest stall (ms) | Dropped frames |
|---|---:|---|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | 900 | pdfjs-next-hwa | 0 | 0.0 | 1 | 5.9 | 0 / 77 |
| bunka-kokugo-series-019-p4.pdf | 900 | hybrid-hwa | 0 | 0.0 | 1 | 6.0 | 0 / 77 |
| bunka-kokugo-series-019-p4.pdf | 3600 | pdfjs-next-hwa | 0 | 0.0 | 0 | 5.9 | 0 / 21 |
| bunka-kokugo-series-019-p4.pdf | 3600 | hybrid-hwa | 0 | 0.0 | 0 | 5.8 | 0 / 21 |
| patent-us223898.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 28 | 15.4 | 1 / 289 |
| patent-us223898.pdf | 900 | hybrid-hwa | 2 | 0.0 | 27 | 11.7 | 0 / 289 |
| patent-us223898.pdf | 3600 | pdfjs-next-hwa | 3 | 0.0 | 14 | 13.4 | 2 / 133 |
| patent-us223898.pdf | 3600 | hybrid-hwa | 3 | 0.0 | 4 | 8.0 | 4 / 132 |
| wdl6812-manuscript.pdf | 900 | pdfjs-next-hwa | 1 | 0.0 | 3 | 6.0 | 0 / 197 |
| wdl6812-manuscript.pdf | 900 | hybrid-hwa | 1 | 0.0 | 1 | 6.0 | 0 / 197 |
| wdl6812-manuscript.pdf | 3600 | pdfjs-next-hwa | 1 | 0.0 | 0 | 5.0 | 0 / 51 |
| wdl6812-manuscript.pdf | 3600 | hybrid-hwa | 1 | 0.0 | 0 | 5.0 | 0 / 51 |
| bill-hr815.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 26 | 13.1 | 0 / 289 |
| bill-hr815.pdf | 900 | hybrid-hwa | 2 | 0.0 | 29 | 12.2 | 0 / 289 |
| bill-hr815.pdf | 3600 | pdfjs-next-hwa | 7 | 0.0 | 6 | 7.1 | 0 / 289 |
| bill-hr815.pdf | 3600 | hybrid-hwa | 7 | 0.0 | 8 | 8.4 | 0 / 289 |

## Payload

Brotli quality 11 of the built assets. The hybrid engine's main-thread code is part of the app bundle and is not counted.

| Loads | Asset | Raw | Brotli |
|---|---|---:|---:|
| with every document | `hybrid.worker-9WMFxH8H.js` | 6 KiB | 2 KiB |
| with every document | `hayro_classify_bg-C4wq2lu2.wasm` | 278 KiB | 93 KiB |
| with the first image-only page | `hayro_wasm_bench-CppHVCme.js` | 4 KiB | 1 KiB |
| with the first image-only page | `hayro_wasm_bench_bg-B6N7ImOe.wasm` | 3961 KiB | 1362 KiB |
| pdf.js master (reference) | `pdf-29Jl64SC.js` | 430 KiB | 106 KiB |
| pdf.js master (reference) | `pdf.worker-A5U9OorG.mjs` | 2186 KiB | 372 KiB |
| pdf.js master (reference) | `pdf.renderer-GA8x22nu.mjs` | 236 KiB | 43 KiB |

Added by the hybrid engine: 95 KiB with every document, 1363 KiB more once a document has an image-only page. pdf.js master itself: 521 KiB.

