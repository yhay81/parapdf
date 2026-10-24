# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-24T02:25:06.121Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC; one-minute load average 7.6 at the start, 6.2 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 0.5 ms (median) / 1.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 2 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium VARIANTS=pdfjs-hwa,pdfjs-hwa-frames OUTPUT=frames-scroll-chromium pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 176 | 2 | 0.0 | 0.0 | 2 | 1.2 / 4 | 1 / 240 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa-frames | 172 | 2 | 0.0 | 0.0 | 2 | 1.1 / 4 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 176 | 9 | 0.0 | 0.0 | 2 | 1.1 / 4 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa-frames | 172 | 9 | 0.0 | 0.0 | 4 | 1.1 / 4 | 1 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 154 | 2 | 0.0 | 0.0 | 8 | 1.1 / 6 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa-frames | 164 | 2 | 0.0 | 0.0 | 7 | 1.1 / 6 | 1 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 162 | 7 | 0.0 | 0.0 | 4 | 1.2 / 5 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa-frames | 139 | 7 | 0.0 | 0.0 | 6 | 1.1 / 5 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 |

