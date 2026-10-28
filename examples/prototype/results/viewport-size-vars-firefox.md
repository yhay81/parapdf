# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-28T11:49:10.398Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC; one-minute load average 35.4 at the start, 3.5 at the end; waited 3 times (6 min in all) for other Playwright browsers or a load average above 6 and repeated 1 job that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on main, with a size query container, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf,synthetic-text-1000.pdf SPEEDS=900,3600 RUNS=5 OUTPUT=viewport-size-vars-firefox pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 225 | 2 | 0.0 | 0.0 | 40 | 1.3 / 14 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, before | 215 | 2 | 0.0 | 0.0 | 59 | 1.4 / 20 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 233 | 7 | 0.0 | 0.0 | 88 | 1.8 / 16 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, before | 230 | 7 | 0.0 | 0.0 | 89 | 1.6 / 25 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 |

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 275 | 2 | 0.0 | 0.0 | 58 | 1.3 / 22 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, before | 276 | 2 | 0.0 | 0.0 | 51 | 1.3 / 21 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 273 | 9 | 0.0 | 0.0 | 94 | 1.5 / 20 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, before | 289 | 9 | 0.0 | 0.0 | 76 | 1.6 / 20 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |

