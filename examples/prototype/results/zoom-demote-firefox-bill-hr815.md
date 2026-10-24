# ParaPDF runtime prototype: zoom, Firefox 157.0

- Run at: 2026-10-24T03:43:31.000Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 4.3 at the start, 4.8 at the end, on 12 cores; times are only comparable between quiet runs. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 3 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | before | 1.00 | 107 | 82 (119) | 1.00 | 47 | 77 (142) |
| desktop | 4 | pdfjs-hwa | 1.00 | 96 | 88 (119) | 1.00 | 48 | 83 (147) |
| desktop | 8 | before | 1.00 | 73 | 82 (119) | 1.00 | 64 | 82 (146) |
| desktop | 8 | pdfjs-hwa | 1.00 | 68 | 88 (119) | 1.00 | 63 | 88 (152) |
| phone | 4 | before | 1.00 | 221 | 88 (95) | 1.00 | 15 | 81 (145) |
| phone | 4 | pdfjs-hwa | 1.00 | 56 | 85 (85) | 1.00 | 12 | 78 (142) |
| phone | 8 | before | 1.00 | 234 | 88 (95) | 1.00 | 14 | 88 (152) |
| phone | 8 | pdfjs-hwa | 1.00 | 59 | 85 (85) | 1.00 | 14 | 85 (149) |

