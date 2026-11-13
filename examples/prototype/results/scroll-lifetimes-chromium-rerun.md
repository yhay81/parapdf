# ParaPDF runtime prototype: scripted scroll, Chromium 158.0.8127.18

- Run at: 2026-11-12T18:23:35.913Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 158.0.8127.18 (Playwright build, headless); power: AC; one-minute load average 2.6 at the start, 1.7 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 7 runs. Variants named "before" ran on main ce61e6e, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 RUNS=7 DURATION=4000 OUTPUT=scroll-lifetimes-chromium-rerun pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 182 | 2 | 0.0 | 0.0 | 17 | 1.6 / 8 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |
| pdfjs-hwa, before | 180 | 2 | 0.0 | 0.0 | 20 | 1.5 / 10 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 181 | 9 | 0.0 | 0.0 | 66 | 1.6 / 12 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 181 | 9 | 0.0 | 0.0 | 74 | 1.7 / 13 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 160 | 2 | 0.0 | 0.0 | 20 | 1.6 / 10 | 1 / 240 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| pdfjs-hwa, before | 158 | 2 | 0.0 | 0.0 | 25 | 1.5 / 9 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 157 | 7 | 0.0 | 0.0 | 56 | 1.7 / 11 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 | 127 |
| pdfjs-hwa, before | 143 | 7 | 0.0 | 0.0 | 56 | 1.7 / 10 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 | 127 |

