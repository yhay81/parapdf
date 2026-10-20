# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-20T07:15:54.383Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC; one-minute load average 5.2 at the start, 3.5 at the end; waited 2 times (36 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 0.5 ms (median) / 1.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 168 | 2 | 0.0 | 0.0 | 25 | 1.2 / 11 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 179 | 2 | 0.0 | 0.0 | 9 | 1.2 / 7 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 247 | 2 | 0.0 | 0.0 | 25 | 1.2 / 16 | 1 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 243 | 2 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 181 | 9 | 0.0 | 0.0 | 17 | 1.2 / 8 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 180 | 9 | 0.0 | 0.0 | 29 | 1.2 / 8 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 267 | 9 | 0.0 | 0.0 | 1 | 1.2 / 3 | 1 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 243 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 156 | 2 | 0.0 | 0.0 | 28 | 1.2 / 11 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 137 | 2 | 0.0 | 0.0 | 10 | 1.1 / 9 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 224 | 2 | 0.0 | 0.0 | 32 | 1.2 / 18 | 1 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 200 | 2 | 0.0 | 0.0 | 7 | 1.1 / 7 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 150 | 7 | 0.0 | 0.0 | 10 | 1.2 / 5 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 146 | 7 | 0.0 | 0.0 | 9 | 1.2 / 6 | 1 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next | 214 | 7 | 0.0 | 0.0 | 3 | 1.2 / 4 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 207 | 7 | 0.0 | 0.0 | 2 | 1.1 / 3 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |

