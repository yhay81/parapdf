# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:48:03.034Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC; one-minute load average 6.9 at the start, 7.0 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 404 | 2 | 0.0 | 0.0 | 24 | 1.5 / 13 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 412 | 2 | 0.0 | 0.0 | 10 | 1.5 / 7 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 436 | 7 | 0.0 | 0.0 | 33 | 1.5 / 8 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 429 | 7 | 0.0 | 0.0 | 5 | 1.5 / 4 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 437 | 2 | 0.0 | 0.0 | 9 | 1.5 / 6 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 433 | 2 | 0.0 | 0.0 | 2 | 1.5 / 3 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 418 | 9 | 0.0 | 0.0 | 41 | 1.5 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 443 | 9 | 0.0 | 0.0 | 6 | 1.6 / 5 | 1 / 240 | 24 | 9 / 0 / 0 / 0 / 0 |

