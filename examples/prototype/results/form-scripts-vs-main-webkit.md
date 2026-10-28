# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-28T05:08:54.361Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 9.2 at the start, 11.0 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 4.8 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on main, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa QUERY='forms=1&scripts=1' FILES=f1040.pdf SPEEDS=3600 RUNS=5 OUTPUT=form-scripts-vs-main-webkit pnpm --filter @parapdf/prototype bench`

## f1040.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 229 | 1 | 0.0 | 0.0 | 19 | 5.8 / 11 | 2 / 43 | 1 (1.4) | 1 (0 / 1) | 0 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, before | 225 | 1 | 0.0 | 0.0 | 22 | 5.9 / 12 | 1 / 42 | 1 (1.4) | 1 (0 / 1) | 0 / 0 / 0 / 0 / 0 |

