# ParaPDF runtime prototype: zoom, Chromium 156.0.8078.4

- Run at: 2026-10-24T03:40:54.392Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 3.9 at the start, 3.2 at the end, on 12 cores; times are only comparable between quiet runs. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: synthetic-vector-200k.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 3 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | before | 1.00 | 13 | 66 (100) | 1.00 | 48 | 66 (130) |
| desktop | 4 | pdfjs-hwa | 1.00 | 13 | 72 (100) | 1.00 | 47 | 72 (136) |
| desktop | 8 | before | 1.00 | 12 | 66 (100) | 1.00 | 48 | 66 (130) |
| desktop | 8 | pdfjs-hwa | 1.00 | 12 | 72 (100) | 1.00 | 48 | 72 (136) |
| phone | 4 | before | 1.00 | 28 | 72 (79) | 1.00 | 13 | 63 (127) |
| phone | 4 | pdfjs-hwa | 1.00 | 12 | 71 (71) | 1.00 | 15 | 61 (125) |
| phone | 8 | before | 1.00 | 27 | 72 (79) | 1.00 | 14 | 72 (136) |
| phone | 8 | pdfjs-hwa | 1.00 | 12 | 71 (71) | 1.00 | 15 | 71 (135) |

