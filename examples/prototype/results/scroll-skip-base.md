# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:50:21.363Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC; one-minute load average 7.0 at the start, 4.7 at the end; waited 1 times (1 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.5 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 410 | 2 | 0.0 | 0.0 | 15 | 1.5 / 10 | 0 / 242 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 416 | 2 | 0.0 | 0.0 | 6 | 1.5 / 5 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 426 | 7 | 0.0 | 0.0 | 37 | 1.5 / 11 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 423 | 7 | 0.0 | 0.0 | 10 | 1.5 / 6 | 1 / 240 | 20 | 8 / 0 / 0 / 0 / 0 |

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 445 | 2 | 0.0 | 0.0 | 9 | 1.5 / 7 | 0 / 242 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 448 | 2 | 0.0 | 0.0 | 3 | 1.5 / 4 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 420 | 9 | 0.0 | 0.0 | 48 | 1.6 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 433 | 9 | 0.0 | 0.0 | 3 | 1.6 / 4 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

