# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-11-12T14:25:40.340Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-webgpu` requests GPU rasterization of mesh shadings. The fidelity run counts actual GPU draws.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium FILES=bill-hr815.pdf,patent-us223898.pdf PAGES=2 RUNS=5 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh-controls- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1676 KiB | 500 KiB | 411 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 82.5 | 83.0 |
| patent-us223898.pdf | 67.5 | 67.0 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 53.0 | 53.3 |
| patent-us223898.pdf | 35.1 | 34.6 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 50.8 / 84.0 | 50.8 / 83.3 |
| patent-us223898.pdf | 66.8 / 84.1 | 66.6 / 83.3 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 16 | 18 |
| patent-us223898.pdf | 0 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 2.7 / 17.4 | 3.9 / 17.1 |
| patent-us223898.pdf | 1.2 / 1.5 | 1.1 / 1.3 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 77 + 3 | 93 + 6 |
| patent-us223898.pdf | 93 + 3 | 106 + 4 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | — | — |
| patent-us223898.pdf | — | — |
