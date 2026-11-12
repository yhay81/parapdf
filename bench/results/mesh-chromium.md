# ParaPDF engine benchmark: Chromium 156.0.8078.4

- Run at: 2026-11-12T14:22:01.903Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Chromium 156.0.8078.4 (Playwright build, headless), WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version), crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 0.6 ms late (median) / 1.2 ms (p95), and animation frames arrive every 16.7 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 1 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=chromium ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh- pnpm bench`

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
| synthetic-mesh-sparse.pdf | 49.8 | 50.0 |
| synthetic-mesh-dense.pdf | 49.7 | 50.1 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 40.2 | 17.9 |
| synthetic-mesh-dense.pdf | 42.5 | 18.1 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 49.8 / 50.0 | 50.0 / 50.2 |
| synthetic-mesh-dense.pdf | 49.7 / 50.1 | 50.1 / 50.6 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 20 | 0 |
| synthetic-mesh-dense.pdf | 23 | 0 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 22.3 / 22.3 | 1.2 / 1.2 |
| synthetic-mesh-dense.pdf | 24.5 / 24.5 | 1.0 / 1.0 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 107 + 3 | 105 + 4 |
| synthetic-mesh-dense.pdf | 104 + 3 | 105 + 4 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | — | — |
| synthetic-mesh-dense.pdf | — | — |

