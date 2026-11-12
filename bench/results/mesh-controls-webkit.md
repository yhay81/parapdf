# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-11-12T14:27:00.561Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms. The run waited once (0 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-webgpu` requests GPU rasterization of mesh shadings. The fidelity run counts actual GPU draws.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit FILES=bill-hr815.pdf,patent-us223898.pdf PAGES=2 RUNS=5 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh-controls- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1676 KiB | 500 KiB | 411 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 13.9 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 83.3 | 83.2 |
| patent-us223898.pdf | 83.3 | 83.7 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 41.0 | 48.3 |
| patent-us223898.pdf | 57.0 | 57.3 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 42.0 / 97.2 | 41.7 / 97.1 |
| patent-us223898.pdf | 83.3 / 96.2 | 83.6 / 97.2 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 1 | 1 |
| patent-us223898.pdf | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 4.7 / 5.6 | 4.9 / 5.7 |
| patent-us223898.pdf | 4.8 / 4.8 | 4.8 / 5.0 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 110 + 5 | 109 + 6 |
| patent-us223898.pdf | 108 + 5 | 110 + 5 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | — | — |
| patent-us223898.pdf | — | — |
