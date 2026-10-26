# ParaPDF runtime prototype: zoom, Chromium 156.0.8078.4

- Run at: 2026-10-25T23:55:31.689Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 5.0 at the start, 12.9 at the end, on 12 cores; times are only comparable between quiet runs. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 5 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document and those kept for pages that unmounted when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | M4 6325a81 | 1.00 | 60 | 82 (119) | 1.00 | 65 | 77 (142) |
| desktop | 4 | pdfjs-hwa | 1.00 | 51 | 82 (119) | 1.00 | 64 | 77 (142) |
| desktop | 8 | M4 6325a81 | 1.00 | 27 | 82 (111) | 1.00 | 49 | 82 (146) |
| desktop | 8 | pdfjs-hwa | 1.00 | 26 | 82 (111) | 1.00 | 49 | 82 (146) |
| phone | 4 | M4 6325a81 | 1.00 | 43 | 88 (95) | 1.00 | 15 | 81 (145) |
| phone | 4 | pdfjs-hwa | 1.00 | 58 | 88 (95) | 1.00 | 15 | 81 (145) |
| phone | 8 | M4 6325a81 | 1.00 | 72 | 88 (95) | 1.00 | 15 | 88 (152) |
| phone | 8 | pdfjs-hwa | 1.00 | 72 | 88 (95) | 1.00 | 15 | 88 (152) |

