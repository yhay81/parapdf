# ParaPDF runtime prototype: zoom, Chromium 156.0.8078.4

- Run at: 2026-10-29T14:09:46.314Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 13.7 at the start, 17.4 at the end, on 12 cores; times are only comparable between quiet runs. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf opens at the fit-width zoom on a desktop (1280×900, devicePixelRatio 2) and a phone-sized viewport (390×844, devicePixelRatio 3). Once page 1 is sharp, the view zooms around its center to the given scale in CSS pixels per PDF point, then pans by 60% of the viewport height and 30% of its width. Median of 3 runs.
- Sharpness: the resolution of the visible pixels as a share of full device resolution, weighted by area, when the measurement ended (it ends after half a second of sharpness or after 8 seconds). Time to sharp: until sharpness reached 0.99 and stayed there.
- Canvas memory: width × height × 4 bytes for every canvas in the document and those kept for pages that unmounted when the measurement ended, with the peak in parentheses; pixels held inside workers are not included.
- Renders: the base and detail drawings completed from the zoom until none completed for a second after the pan.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/zoom-bench.ts`

| Device | Scale | Variant | Zoom: sharpness | Zoom: time to sharp (ms) | Zoom: canvas MiB (peak) | Pan: sharpness | Pan: time to sharp (ms) | Pan: canvas MiB (peak) | Renders: base / detail |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| desktop | 1.5 | before | 1.00 | 5 | 83 (164) | 1.00 | 14 | 83 (83) | 0 / 3 |
| desktop | 1.5 | pdfjs-hwa | 1.00 | 5 | 83 (164) | 1.00 | 16 | 83 (83) | 0 / 3 |
| desktop | 2.5 | before | 1.00 | 61 | 51 (87) | 1.00 | 48 | 58 (98) | 2 / 2 |
| desktop | 2.5 | pdfjs-hwa | 1.00 | 49 | 51 (87) | 1.00 | 47 | 58 (98) | 2 / 2 |
| desktop | 4 | before | 1.00 | 71 | 82 (119) | 1.00 | 63 | 77 (142) | 2 / 2 |
| desktop | 4 | pdfjs-hwa | 1.00 | 62 | 82 (119) | 1.00 | 62 | 77 (142) | 2 / 2 |
| desktop | 8 | before | 1.00 | 48 | 82 (119) | 1.00 | 63 | 82 (146) | 2 / 2 |
| desktop | 8 | pdfjs-hwa | 1.00 | 49 | 82 (119) | 1.00 | 61 | 82 (146) | 2 / 2 |
| phone | 1.5 | before | 1.00 | 58 | 187 (201) | 1.00 | 16 | 240 (247) | 0 / 4 |
| phone | 1.5 | pdfjs-hwa | 1.00 | 67 | 187 (201) | 1.00 | 15 | 240 (247) | 0 / 4 |
| phone | 2.5 | before | 1.00 | 36 | 76 (79) | 1.00 | 45 | 84 (84) | 0 / 2 |
| phone | 2.5 | pdfjs-hwa | 1.00 | 50 | 76 (79) | 1.00 | 49 | 84 (84) | 0 / 2 |
| phone | 4 | before | 1.00 | 48 | 92 (92) | 1.00 | 15 | 85 (149) | 0 / 2 |
| phone | 4 | pdfjs-hwa | 1.00 | 38 | 92 (92) | 1.00 | 15 | 85 (149) | 0 / 2 |
| phone | 8 | before | 1.00 | 69 | 92 (92) | 1.00 | 15 | 92 (156) | 0 / 2 |
| phone | 8 | pdfjs-hwa | 1.00 | 56 | 92 (92) | 1.00 | 12 | 92 (156) | 0 / 2 |

