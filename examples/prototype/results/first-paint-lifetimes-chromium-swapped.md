# ParaPDF runtime prototype: scripted scroll, Chromium 158.0.8127.18

- Run at: 2026-11-12T19:12:40.897Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 158.0.8127.18 (Playwright build, headless); power: AC; one-minute load average 5.5 at the start, 7.0 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 200 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 60 runs. Variants named "before" ran on this change (the builds swapped, so the variants not named so ran on main ce61e6e), each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf SPEEDS=900 RUNS=60 DURATION=200 OUTPUT=first-paint-lifetimes-chromium-swapped pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 157 | 0 | 0.0 | 0.0 | 0 | 1.5 / 2 | 0 / 13 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 156 | 0 | 0.0 | 0.0 | 0 | 1.4 / 2 | 0 / 13 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 138, 158, 159, 141, 159, 139, 139, 160, 139, 160, 138, 158, 144, 161, 141, 159, 160, 155, 160, 138, 158, 156, 158, 173, 158, 159, 139, 175, 156, 159, 142, 141, 157, 161, 156, 139, 160, 142, 160, 143, 143, 158, 160, 143, 141, 158, 176, 142, 159, 159, 161, 138, 158, 144, 170, 157, 158, 155, 145, 139
- pdfjs-hwa, before: 142, 139, 159, 139, 157, 160, 159, 142, 136, 139, 157, 159, 142, 142, 141, 156, 144, 161, 138, 141, 144, 156, 139, 158, 157, 170, 140, 156, 137, 158, 142, 141, 157, 157, 140, 158, 160, 157, 174, 142, 157, 164, 156, 142, 159, 141, 158, 143, 160, 157, 157, 139, 175, 157, 169, 140, 145, 156, 141, 138

