# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-18T12:34:27.546Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 0.5 ms (median) / 1.3 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 3 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench`

## usrguide.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 398 | 2 | 0.0 | 0.0 | 61 | 1.5 / 31 | 1 / 240 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no links | 411 | 2 | 0.0 | 0.0 | 53 | 1.5 / 31 | 0 / 241 | 4 | 2 / 2 / 2 / 0 / 0 |
| pdfjs-next-hwa | 405 | 2 | 0.0 | 0.0 | 25 | 1.4 / 14 | 0 / 240 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no links | 405 | 2 | 0.0 | 0.0 | 20 | 1.2 / 12 | 0 / 241 | 4 | 2 / 2 / 2 / 0 / 0 |

## usrguide.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 397 | 8 | 0.0 | 0.0 | 26 | 1.2 / 10 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no links | 403 | 8 | 0.0 | 0.0 | 18 | 1.2 / 9 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 403 | 8 | 0.0 | 0.0 | 4 | 1.3 / 4 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no links | 404 | 8 | 0.0 | 0.0 | 7 | 1.2 / 6 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |

