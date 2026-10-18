# ParaPDF runtime prototype: zoom, Chromium 156.0.8078.4

- Run at: 2026-10-18T14:41:38.201Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 2 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | pdfjs-hwa | 0.58 | 0/2 runs sharp | 228 (228) | 0.58 | 0/2 runs sharp | 228 (228) |
| desktop | 4 | pdfjs-next-hwa | 0.58 | 0/2 runs sharp | 228 (228) | 0.58 | 0/2 runs sharp | 228 (228) |
| desktop | 8 | pdfjs-hwa | 0.29 | 0/2 runs sharp | 335 (335) | 0.29 | 0/2 runs sharp | 335 (335) |
| desktop | 8 | pdfjs-next-hwa | 0.29 | 0/2 runs sharp | 335 (335) | 0.29 | 0/2 runs sharp | 335 (335) |
| phone | 4 | pdfjs-hwa | 0.39 | 0/2 runs sharp | 228 (228) | 0.39 | 0/2 runs sharp | 228 (228) |
| phone | 4 | pdfjs-next-hwa | 0.39 | 0/2 runs sharp | 228 (228) | 0.39 | 0/2 runs sharp | 228 (228) |
| phone | 8 | pdfjs-hwa | 0.19 | 0/2 runs sharp | 335 (335) | 0.19 | 0/2 runs sharp | 335 (335) |
| phone | 8 | pdfjs-next-hwa | 0.19 | 0/2 runs sharp | 335 (335) | 0.19 | 0/2 runs sharp | 335 (335) |

