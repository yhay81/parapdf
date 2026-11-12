# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-11-12T14:30:16.035Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms. The run waited once (2 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 2 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh-controls- pnpm bench`

## Engine payload

| Engine | Files | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| pdfjs | 2 | 1676 KiB | 500 KiB | 411 KiB |
| pdfjs-next (workers unminified) | 2 | 1 KiB | 0 KiB | 0 KiB |
| pdfium | 3 | 4691 KiB | 2136 KiB | 1645 KiB |
| hayro | 3 | 3967 KiB | 1707 KiB | 1364 KiB |

## First page visible, cold (ms)

Frame-aligned, so values move in steps of about 16.7 ms; use the committed table for finer engine differences.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 100.7 | 100.1 |
| patent-us223898.pdf | 82.2 | 81.3 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 79.5 | 81.6 |
| patent-us223898.pdf | 62.8 | 61.1 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 54.4 / 119.4 | 52.8 / 102.0 |
| patent-us223898.pdf | 82.6 / 102.4 | 81.3 / 85.2 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 34 | 36 |
| patent-us223898.pdf | 19 | 17 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 12.9 / 15.1 | 12.1 / 15.2 |
| patent-us223898.pdf | 9.6 / 13.3 | 9.2 / 11.6 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | 139 + 3 | 142 + 3 |
| patent-us223898.pdf | 140 + 3 | 146 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| bill-hr815.pdf | — | — |
| patent-us223898.pdf | — | — |

