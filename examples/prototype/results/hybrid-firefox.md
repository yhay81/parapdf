# ParaPDF hybrid engine: Firefox 157.0

- Run at: 2026-10-19T05:39:39.346Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.0 ms (p95); animation frames every 16.7 ms.
- Load: jobs started only while no other Playwright browser was open and the 1-minute load average was at most 6; at job start it was 5.4 (median), 6.3 at most, on 12 logical cores.
- Variants: `pdfjs-next-hwa` is pdf.js master with its renderer worker on a GPU-backed canvas; `hybrid-hwa` is the same engine with image-only pages rendered by hayro (wasm, simd128) in the hybrid worker. Text, links, and search come from pdf.js in both.
- Method: fresh browser context per job, 1280×900 viewport at devicePixelRatio 2, fit-width zoom; 5 runs per file, speed, and variant, alternating which variant goes first; startup numbers pool both speeds (10 jobs per cell). Medians throughout. 79 jobs come from an interrupted run of the same build and settings.
- **Firefox renders at devicePixelRatio 1 here**: Playwright's Firefox ignores `deviceScaleFactor` on cross-origin-isolated pages, so its detail canvases hold a quarter of the pixels of the Chromium and WebKit runs. Compare Firefox's variants with each other, not with other browsers.
- First paint: navigation start until page 1 shows pixels (its low-resolution base layer). Page 1 sharp: until page 1's full-resolution layer is on the canvas.
- Longest stall: the largest lateness of a 4 ms timer on the main thread, from startup until the scroll begins (startup) or during the scroll. Blocked: summed lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger.
- Render: from the scheduler's request until the pixels are on the canvas, per canvas layer (base at half a device pixel per CSS pixel, detail at full resolution) and per engine; median of each job's median. Renders overlap (two at a time), so this is latency, not CPU time.
- Reproduce: `pnpm bench:build && pnpm --filter @parapdf/prototype build && BROWSER=firefox pnpm --filter @parapdf/prototype bench:hybrid`

## Startup

| File | Variant | First paint (ms) | Page 1 sharp (ms) | Longest stall (ms) | Blocked (ms) | Render base hayro (ms) | Render base pdfjs (ms) | Render detail hayro (ms) | Render detail pdfjs (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 486 | 516 | 9.8 | 16 | — | 139 | — | 27 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 403 | 434 | 6.5 | 8 | 57 | — | 30 | — |
| patent-us223898.pdf | pdfjs-next-hwa | 468 | 487 | 10.3 | 33 | — | 73 | — | 18 |
| patent-us223898.pdf | hybrid-hwa | 407 | 449 | 8.2 | 19 | 54 | — | 31 | — |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 428 | 452 | 7.9 | 9 | — | 81 | — | 21 |
| wdl6812-manuscript.pdf | hybrid-hwa | 419 | 488 | 6.7 | 10 | 66 | — | 69 | — |
| bill-hr815.pdf | pdfjs-next-hwa | 417 | 456 | 6.6 | 11 | — | 25 | — | 27 |
| bill-hr815.pdf | hybrid-hwa | 416 | 458 | 7.4 | 13 | — | 23 | — | 26 |

## Hybrid engine internals

Times are medians across jobs. Classifier ready: navigation start until the worker had fetched the PDF and parsed it. Classify: time inside the worker per page, and the round trip from the main thread. hayro load: fetching and compiling the module, then parsing the PDF a second time.

| File | Pages to hayro / pdf.js | Classifier ready (ms) | Fetch / wait for module / parse (ms) | Classify p50 / max (ms) | Round trip p50 (ms) | hayro load / parse (ms) | hayro ready (ms) | Classifier / hayro memory (MiB) | Fallbacks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| bunka-kokugo-series-019-p4.pdf | 1 / 0 | 341 | 2.3 / 0.0 / 0.3 | 0.22 / 0.22 | 4.3 | 30 / 0.2 | 403 | 1.3 / 34.8 | none |
| patent-us223898.pdf | 4 / 0 | 345 | 2.9 / 0.0 / 0.3 | 0.42 / 0.82 | 3.4 | 33 / 0.2 | 407 | 1.6 / 27.2 | none |
| wdl6812-manuscript.pdf | 2 / 0 | 345 | 4.3 / 0.0 / 0.3 | 0.08 / 0.27 | 2.3 | 31 / 0.2 | 419 | 1.4 / 28.5 | none |
| bill-hr815.pdf | 0 / 8 | 346 | 3.2 / 0.0 / 1.2 | 0.24 / 0.44 | 1.4 | — / — | — | 1.7 / 0.0 | none |

## Scrolling

| File | Speed (px/s) | Variant | Pages crossed | Blank (%) | Blocked (ms) | Longest stall (ms) | Dropped frames |
|---|---:|---|---:|---:|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | 900 | pdfjs-next-hwa | 0 | 0.0 | 0 | 1.4 | 0 / 65 |
| bunka-kokugo-series-019-p4.pdf | 900 | hybrid-hwa | 0 | 0.0 | 0 | 2.2 | 0 / 64 |
| bunka-kokugo-series-019-p4.pdf | 3600 | pdfjs-next-hwa | 0 | 0.0 | 0 | 1.3 | 0 / 17 |
| bunka-kokugo-series-019-p4.pdf | 3600 | hybrid-hwa | 0 | 0.0 | 0 | 1.1 | 0 / 17 |
| patent-us223898.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 27 | 11.4 | 0 / 241 |
| patent-us223898.pdf | 900 | hybrid-hwa | 2 | 0.0 | 19 | 6.8 | 0 / 240 |
| patent-us223898.pdf | 3600 | pdfjs-next-hwa | 3 | 0.0 | 12 | 7.2 | 0 / 111 |
| patent-us223898.pdf | 3600 | hybrid-hwa | 3 | 0.0 | 15 | 5.5 | 0 / 111 |
| wdl6812-manuscript.pdf | 900 | pdfjs-next-hwa | 1 | 0.0 | 5 | 6.9 | 0 / 165 |
| wdl6812-manuscript.pdf | 900 | hybrid-hwa | 1 | 0.0 | 3 | 3.0 | 0 / 164 |
| wdl6812-manuscript.pdf | 3600 | pdfjs-next-hwa | 1 | 0.0 | 2 | 4.4 | 0 / 42 |
| wdl6812-manuscript.pdf | 3600 | hybrid-hwa | 1 | 0.0 | 6 | 4.7 | 0 / 42 |
| bill-hr815.pdf | 900 | pdfjs-next-hwa | 2 | 0.0 | 33 | 8.1 | 0 / 241 |
| bill-hr815.pdf | 900 | hybrid-hwa | 2 | 0.0 | 26 | 8.7 | 0 / 241 |
| bill-hr815.pdf | 3600 | pdfjs-next-hwa | 7 | 0.0 | 20 | 8.1 | 0 / 241 |
| bill-hr815.pdf | 3600 | hybrid-hwa | 7 | 0.0 | 10 | 8.0 | 0 / 241 |

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

