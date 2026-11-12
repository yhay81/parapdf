# ParaPDF engine benchmark: WebKit 27.2

- Run at: 2026-11-12T14:23:01.215Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores), 32 GiB
- Browser: WebKit 27.2 (Playwright build, headless), WebGL renderer: Apple GPU, crossOriginIsolated: true
- Power: AC. Idle baseline: on an idle page a 4 ms timer fires 3.8 ms late (median) / 4.9 ms (p95), and animation frames arrive every 13.9 ms. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Engines: pdfjs-dist 6.5.438 (main-thread drawing), @embedpdf/pdfium 2.15.1 (worker), hayro 0.8.0 (worker, wasm simd128). `-hwa` variants set `enableHWA` for a GPU-backed canvas. `-webgpu` requests GPU rasterization of mesh shadings. The fidelity run counts actual GPU draws.
- Method: scale 2.6667 (100% zoom at devicePixelRatio 2), first 1 pages rendered one after another, fresh page per job, median of 5 runs. "Visible" waits two animation frames after the pixels are committed to the canvas.
- Reproduce: `pnpm bench:build && BROWSER=webkit FILES=synthetic-mesh-sparse.pdf,synthetic-mesh-dense.pdf PAGES=1 RUNS=5 SCALE=2.6667 ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh- pnpm bench`

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
| synthetic-mesh-sparse.pdf | 69.3 | 55.4 |
| synthetic-mesh-dense.pdf | 69.4 | 55.5 |

## First page committed to the canvas, cold (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 35.1 | 22.5 |
| synthetic-mesh-dense.pdf | 41.3 | 24.0 |

## Per-page visible p50 / p95 (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 69.3 / 70.4 | 55.4 / 68.5 |
| synthetic-mesh-dense.pdf | 69.4 / 69.4 | 55.5 / 56.5 |

## Main thread blocked while rendering (ms)

Sum of event-loop lag measured by a 4 ms timer during the whole render phase, counting only lateness beyond 2 ms or the idle page's 95th percentile, whichever is larger. Lower means input and scrolling stay responsive while pages render.

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 14 | 1 |
| synthetic-mesh-dense.pdf | 20 | 3 |

## Event-loop lag p95 / max (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 18.7 / 18.7 | 6.0 / 6.0 |
| synthetic-mesh-dense.pdf | 24.9 / 24.9 | 7.4 / 7.4 |

## Engine init + document open (ms)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | 109 + 5 | 111 + 6 |
| synthetic-mesh-dense.pdf | 92 + 5 | 106 + 6 |

## Wasm linear memory after rendering (MiB)

| File | pdfjs-hwa | pdfjs-hwa-webgpu |
|---|---:|---:|
| synthetic-mesh-sparse.pdf | — | — |
| synthetic-mesh-dense.pdf | — | — |
