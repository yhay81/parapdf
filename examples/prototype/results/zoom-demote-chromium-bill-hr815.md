# ParaPDF runtime prototype: zoom, Chromium 156.0.8078.4

- Run at: 2026-10-24T03:40:06.442Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 4.9 at the start, 3.9 at the end, on 12 cores; times are only comparable between quiet runs. The run waited once (2 min in all) for other Playwright browsers or a load average above 10 and repeated 1 job that another browser overlapped.
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 3 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | before | 1.00 | 66 | 82 (119) | 1.00 | 47 | 77 (142) |
| desktop | 4 | pdfjs-hwa | 1.00 | 65 | 88 (119) | 1.00 | 65 | 83 (147) |
| desktop | 8 | before | 1.00 | 49 | 82 (119) | 1.00 | 46 | 82 (146) |
| desktop | 8 | pdfjs-hwa | 1.00 | 29 | 88 (119) | 1.00 | 46 | 88 (152) |
| phone | 4 | before | 1.00 | 206 | 88 (95) | 1.00 | 13 | 81 (145) |
| phone | 4 | pdfjs-hwa | 1.00 | 23 | 85 (85) | 1.00 | 16 | 78 (142) |
| phone | 8 | before | 1.00 | 76 | 88 (95) | 1.00 | 15 | 88 (152) |
| phone | 8 | pdfjs-hwa | 1.00 | 60 | 85 (85) | 1.00 | 15 | 85 (149) |

