# ParaPDF hybrid engine: Chromium 156.0.8078.4

- Run at: 2026-10-18T23:45:49.640Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 0.5 ms (median) / 1.3 ms (p95); animation frames every 16.7 ms.
- Load: jobs started only while no other Playwright browser was open and the 1-minute load average was at most 6; at job start it was 3.6 (median), 5.1 at most, on 12 logical cores.
- Variants: `pdfjs-next-hwa` is pdf.js master with its renderer worker on a GPU-backed canvas; `hybrid-hwa` is the same engine with image-only pages rendered by hayro (wasm, simd128) in the hybrid worker. Text, links, and search come from pdf.js in both.
- Method: fresh browser context per job, 1280×900 viewport at devicePixelRatio 2, fit-width zoom; 5 runs per file, speed, and variant, alternating which variant goes first; startup numbers pool both speeds (10 jobs per cell). Medians throughout.
- First paint: navigation start until page 1 shows pixels (its low-resolution base layer). Page 1 sharp: until page 1's full-resolution layer is on the canvas.
- Longest stall: the largest lateness of a 4 ms timer on the main thread, from startup until the scroll begins (startup) or during the scroll. Blocked: summed lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger.
- Render: from the scheduler's request until the pixels are on the canvas, per canvas layer (base at half a device pixel per CSS pixel, detail at full resolution) and per engine; median of each job's median. Renders overlap (two at a time), so this is latency, not CPU time.
- Reproduce: `pnpm bench:build && pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench:hybrid`

## Startup

| File | Variant | First paint (ms) | Page 1 sharp (ms) | Longest stall (ms) | Blocked (ms) | Render base hayro (ms) | Render base pdfjs (ms) | Render detail hayro (ms) | Render detail pdfjs (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 501 | 508 | 50.3 | 59 | — | 148 | — | 13 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 403 | 461 | 6.5 | 12 | 53 | — | 58 | — |
| patent-us223898.pdf | pdfjs-next-hwa | 480 | 514 | 46.3 | 91 | — | 72 | — | 13 |
| patent-us223898.pdf | hybrid-hwa | 401 | 457 | 11.8 | 36 | 50 | — | 41 | — |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 442 | 457 | 14.9 | 20 | — | 96 | — | 10 |
| wdl6812-manuscript.pdf | hybrid-hwa | 418 | 504 | 7.5 | 12 | 70 | — | 87 | — |
| bill-hr815.pdf | pdfjs-next-hwa | 406 | 446 | 8.5 | 15 | — | 23 | — | 20 |
| bill-hr815.pdf | hybrid-hwa | 397 | 432 | 7.4 | 13 | — | 26 | — | 21 |

## Hybrid engine internals

Times are medians across jobs. Classifier ready: navigation start until the worker had fetched the PDF and parsed it. Classify: time inside the worker per page, and the round trip from the main thread. hayro load: fetching and compiling the module, then parsing the PDF a second time.

| File | Pages to hayro / pdf.js | Classifier ready (ms) | Fetch / wait for module / parse (ms) | Classify p50 / max (ms) | Round trip p50 (ms) | hayro load / parse (ms) | hayro ready (ms) | Classifier / hayro memory (MiB) | Fallbacks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| bunka-kokugo-series-019-p4.pdf | 1 / 0 | 346 | 2.1 / 0.0 / 4.5 | 0.91 / 0.91 | 1.1 | 13 / 13.0 | 403 | 1.3 / 102.9 | none |
| patent-us223898.pdf | 4 / 0 | 344 | 1.9 / 0.0 / 2.4 | 0.50 / 1.26 | 1.9 | 14 / 2.3 | 401 | 1.6 / 83.9 | none |
| wdl6812-manuscript.pdf | 2 / 0 | 343 | 2.2 / 0.0 / 3.0 | 0.03 / 1.73 | 2.1 | 13 / 2.4 | 418 | 1.4 / 51.3 | none |
| bill-hr815.pdf | 0 / 8 | 345 | 1.9 / 0.0 / 3.0 | 0.20 / 1.52 | 1.5 | — / — | — | 1.7 / 0.0 | none |

## Scrolling

| File | Speed (px/s) | Variant | Pages crossed | Blank (%) | Blocked (ms) | Longest stall (ms) | Dropped frames |
|---|---:|---|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | 900 | pdfjs-next-hwa | 0 | 0.0 | 0 | 1.5 | 0 / 64 |
| bunka-kokugo-series-019-p4.pdf | 900 | hybrid-hwa | 0 | 0.0 | 0 | 1.5 | 0 / 64 |
| bunka-kokugo-series-019-p4.pdf | 3600 | pdfjs-next-hwa | 0 | 0.0 | 0 | 1.3 | 0 / 17 |
| bunka-kokugo-series-019-p4.pdf | 3600 | hybrid-hwa | 0 | 0.0 | 0 | 1.4 | 0 / 17 |
| patent-us223898.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 26 | 27.8 | 0 / 241 |
| patent-us223898.pdf | 900 | hybrid-hwa | 2 | 0.0 | 5 | 6.0 | 0 / 241 |
| patent-us223898.pdf | 3600 | pdfjs-next-hwa | 3 | 0.0 | 12 | 13.6 | 0 / 111 |
| patent-us223898.pdf | 3600 | hybrid-hwa | 3 | 0.0 | 1 | 2.6 | 0 / 111 |
| wdl6812-manuscript.pdf | 900 | pdfjs-next-hwa | 1 | 0.0 | 0 | 1.5 | 0 / 165 |
| wdl6812-manuscript.pdf | 900 | hybrid-hwa | 1 | 0.0 | 0 | 1.5 | 0 / 165 |
| wdl6812-manuscript.pdf | 3600 | pdfjs-next-hwa | 1 | 0.0 | 0 | 1.4 | 0 / 42 |
| wdl6812-manuscript.pdf | 3600 | hybrid-hwa | 1 | 0.0 | 0 | 1.5 | 0 / 42 |
| bill-hr815.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 2 | 3.2 | 0 / 241 |
| bill-hr815.pdf | 900 | hybrid-hwa | 2 | 0.0 | 6 | 6.3 | 0 / 241 |
| bill-hr815.pdf | 3600 | pdfjs-next-hwa | 7 | 0.0 | 3 | 5.0 | 0 / 241 |
| bill-hr815.pdf | 3600 | hybrid-hwa | 7 | 0.0 | 1 | 3.0 | 0 / 241 |

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

