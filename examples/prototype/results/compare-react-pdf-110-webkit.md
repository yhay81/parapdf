# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-28T10:31:35.709Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 14.5 at the start, 4.6 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 4.8 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.4.299; react-pdf 11.0.0 (on pdfjs-dist 6.3.289) and react-window 2.5.1, in compare.html, which sizes every page as the first.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa,react-pdf-window,react-pdf FILES=bill-hr815.pdf SPEEDS=900,3600 RUNS=5 OUTPUT=compare-react-pdf-110-webkit pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 184 | 2 | 0.0 | 0.0 | 20 | 4.9 / 9 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| react-pdf | 1156 | 2 | 0.0 | 0.0 | 2752 | 62.5 / 158 | 30 / 142 | 1 (0.2) | — (— / —) | 0 / 0 / 105 / 0 / 0 | 3972 |
| react-pdf-window | 272 | 2 | 0.0 | 0.0 | 20 | 4.9 / 11 | 0 / 241 | 10 (2.5) | — (— / —) | 2 / 0 / 2 / 2 / 0 | 217 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 172 | 7 | 0.0 | 0.0 | 18 | 4.9 / 10 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 | 127 |
| react-pdf | 517 | 7 | 0.0 | 0.0 | 3255 | 105.1 / 186 | 38 / 86 | 0 (0.0) | — (— / —) | 0 / 0 / 84 / 0 / 0 | 3972 |
| react-pdf-window | 278 | 7 | 0.0 | 0.0 | 122 | 5.6 / 18 | 2 / 241 | 46 (11.5) | — (— / —) | 7 / 0 / 8 / 8 / 0 | 289 |

