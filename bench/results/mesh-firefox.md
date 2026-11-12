# ParaPDF engine benchmark: Firefox 157.0

- Run at: 2026-11-12T14:24:55.038Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: Firefox 157.0 (Playwright build, headless), WebGL renderer: Apple M1, or similar, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95), and animation frames arrive every 16.7 ms. The run waited once (1 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Method: scale 2.7 (100% zoom at devicePixelRatio 2), first 1 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=firefox ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh- pnpm bench`

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
| synthetic-mesh-sparse.pdf | 53.2 | 55.0 |
| synthetic-mesh-dense.pdf | 67.7 | 66.6 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 46.9 | 49.0 |
| synthetic-mesh-dense.pdf | 54.8 | 52.6 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 53.2 / 67.8 | 55.0 / 70.1 |
| synthetic-mesh-dense.pdf | 67.7 / 71.3 | 66.6 / 71.1 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 28 | 32 |
| synthetic-mesh-dense.pdf | 35 | 32 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 29.7 / 29.7 | 32.4 / 32.4 |
| synthetic-mesh-dense.pdf | 36.8 / 36.8 | 32.8 / 32.8 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 146 + 2 | 125 + 3 |
| synthetic-mesh-dense.pdf | 129 + 3 | 148 + 3 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | — | — |
| synthetic-mesh-dense.pdf | — | — |

