# ParaPDF runtime prototype: zoom, Firefox 157.0

- Run at: 2026-10-18T14:53:27.969Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 398.9 at the start, 390.7 at the end, on 12 cores; times are only comparable between quiet runs.
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 2 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| desktop | 4 | pdfjs-hwa | 1.00 | 491 | 71 (71) | 1.00 | 161 | 66 (71) |
| desktop | 4 | pdfjs-next-hwa | 1.00 | 277 | 71 (71) | 1.00 | 87 | 66 (71) |
| desktop | 8 | pdfjs-hwa | 1.00 | 228 | 71 (71) | 1.00 | 104 | 71 (71) |
| desktop | 8 | pdfjs-next-hwa | 1.00 | 188 | 71 (71) | 1.00 | 113 | 71 (71) |
| phone | 4 | pdfjs-hwa | 1.00 | 351 | 88 (88) | 1.00 | 10 | 81 (88) |
| phone | 4 | pdfjs-next-hwa | 1.00 | 204 | 88 (88) | 1.00 | 13 | 81 (88) |
| phone | 8 | pdfjs-hwa | 1.00 | 370 | 88 (88) | 1.00 | 9 | 88 (88) |
| phone | 8 | pdfjs-next-hwa | 1.00 | 114 | 88 (88) | 1.00 | 18 | 88 (88) |

