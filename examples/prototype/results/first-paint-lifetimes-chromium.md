# ParaPDF runtime prototype: scripted scroll, Chromium 158.0.8127.18

- Run at: 2026-11-12T19:08:02.926Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 158.0.8127.18 (Playwright build, headless); power: AC; one-minute load average 1.9 at the start, 5.5 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 200 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 60 runs. Variants named "before" ran on main ce61e6e, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf SPEEDS=900 RUNS=60 DURATION=200 OUTPUT=first-paint-lifetimes-chromium pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 156 | 0 | 0.0 | 0.0 | 0 | 1.5 / 2 | 0 / 13 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 157 | 0 | 0.0 | 0.0 | 0 | 1.5 / 2 | 0 / 13 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 175, 158, 139, 159, 159, 140, 143, 154, 156, 188, 140, 143, 158, 157, 159, 154, 156, 140, 157, 159, 155, 144, 142, 142, 143, 141, 160, 142, 158, 142, 156, 159, 157, 174, 139, 175, 159, 157, 139, 143, 161, 157, 157, 157, 141, 158, 140, 140, 142, 140, 137, 161, 142, 158, 158, 159, 156, 172, 158, 158
- pdfjs-hwa, before: 138, 161, 159, 159, 137, 142, 159, 155, 174, 169, 159, 160, 140, 160, 143, 159, 159, 142, 141, 142, 161, 141, 143, 136, 143, 141, 160, 157, 138, 140, 160, 175, 155, 156, 161, 141, 142, 160, 156, 141, 138, 157, 138, 155, 157, 157, 161, 157, 159, 138, 158, 174, 144, 157, 175, 142, 176, 170, 157, 138

