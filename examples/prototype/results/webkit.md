# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-20T07:19:30.348Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 3.5 at the start, 8.8 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 4.9 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 185 | 2 | 0.0 | 0.0 | 2 | 4.8 / 6 | 7 / 277 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 202 | 2 | 0.0 | 0.0 | 1 | 4.8 / 5 | 0 / 289 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 309 | 2 | 0.0 | 0.0 | 3 | 4.8 / 5 | 7 / 281 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 242 | 2 | 0.0 | 0.0 | 2 | 4.8 / 6 | 0 / 289 | 4 | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 185 | 9 | 0.0 | 0.0 | 6 | 4.9 / 7 | 8 / 285 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 271 | 9 | 0.0 | 0.0 | 4 | 4.8 / 7 | 0 / 289 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 321 | 9 | 0.0 | 0.0 | 3 | 4.8 / 6 | 10 / 282 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 270 | 9 | 0.0 | 0.0 | 3 | 4.8 / 5 | 0 / 289 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 269 | 2 | 0.0 | 0.0 | 11 | 4.9 / 10 | 7 / 278 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 197 | 2 | 0.0 | 0.0 | 11 | 4.9 / 8 | 0 / 289 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 247 | 2 | 0.0 | 0.0 | 16 | 4.9 / 11 | 7 / 279 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 249 | 2 | 0.0 | 0.0 | 8 | 4.9 / 9 | 0 / 289 | 4 | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 189 | 7 | 0.0 | 0.0 | 2 | 4.8 / 5 | 10 / 281 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 144 | 7 | 0.0 | 0.0 | 7 | 4.8 / 8 | 0 / 289 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next | 252 | 7 | 0.0 | 0.0 | 8 | 4.8 / 8 | 12 / 273 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 234 | 7 | 0.0 | 0.0 | 2 | 4.8 / 5 | 0 / 290 | 20 | 8 / 0 / 0 / 0 / 0 |

