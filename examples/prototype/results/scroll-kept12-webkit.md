# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-27T09:35:41.990Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 7.2 at the start, 31.0 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.8 ms (median) / 5.6 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 2 runs. Variants named "before" ran on main, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs,pdfjs-hwa OUTPUT=scroll-kept12-webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 216 | 2 | 0.0 | 0.0 | 5 | 5.5 / 7 | 7 / 253 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs, before | 215 | 2 | 0.0 | 0.0 | 6 | 5.5 / 6 | 7 / 252 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 184 | 2 | 0.0 | 0.0 | 4 | 5.4 / 7 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, before | 197 | 2 | 0.0 | 0.0 | 3 | 5.6 / 6 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 209 | 9 | 0.0 | 0.0 | 9 | 5.6 / 7 | 26 / 213 | 24 (6.0) | 24 (15 / 9) | 8 / 4 / 2 / 1 / 0 |
| pdfjs, before | 199 | 9 | 0.0 | 0.0 | 8 | 5.6 / 8 | 23 / 205 | 24 (5.9) | 24 (15 / 9) | 8 / 4 / 4 / 4 / 0 |
| pdfjs-hwa | 195 | 9 | 0.0 | 0.0 | 9 | 5.5 / 7 | 0 / 289 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, before | 193 | 9 | 0.0 | 0.0 | 4 | 5.5 / 7 | 1 / 289 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 224 | 2 | 0.0 | 0.0 | 15 | 5.6 / 12 | 7 / 250 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs, before | 234 | 2 | 0.0 | 0.0 | 11 | 5.5 / 10 | 7 / 256 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 184 | 2 | 0.0 | 0.0 | 11 | 5.6 / 9 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, before | 172 | 2 | 0.0 | 0.0 | 16 | 5.6 / 12 | 1 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 286 | 7 | 0.0 | 0.0 | 22 | 5.7 / 9 | 24 / 193 | 19 (4.7) | 19 (13 / 7) | 6 / 3 / 4 / 4 / 0 |
| pdfjs, before | 216 | 7 | 0.0 | 0.0 | 5 | 5.7 / 7 | 12 / 267 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 171 | 7 | 0.0 | 0.0 | 6 | 5.6 / 7 | 1 / 288 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, before | 178 | 7 | 0.0 | 0.0 | 5 | 5.5 / 7 | 0 / 289 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 |

