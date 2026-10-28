# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-28T10:47:46.101Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC; one-minute load average 5.1 at the start, 4.6 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.0 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.4.299; react-pdf 11.0.0 (on pdfjs-dist 6.3.289) and react-window 2.5.1, in compare.html, which sizes every page as the first.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox VARIANTS=pdfjs-hwa,react-pdf-window TEXT=1,0 LINKS=1,0 FILES=bill-hr815.pdf SPEEDS=900 RUNS=5 OUTPUT=ff-layers-attrib pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 220 | 2 | 0.0 | 0.0 | 39 | 1.1 / 17 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| pdfjs-hwa, no links | 219 | 2 | 0.0 | 0.0 | 28 | 1.1 / 14 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 0 / 0 | 183 |
| pdfjs-hwa, no text | 220 | 2 | 0.0 | 0.0 | 18 | 1.0 / 9 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 0 / 2 / 0 | 183 |
| pdfjs-hwa, no text, no links | 207 | 2 | 0.0 | 0.0 | 15 | 1.0 / 6 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 0 / 0 / 0 | 183 |
| react-pdf-window | 262 | 2 | 0.0 | 0.0 | 24 | 1.0 / 12 | 0 / 240 | 10 (2.5) | — (— / —) | 2 / 0 / 2 / 2 / 0 | 217 |
| react-pdf-window, no links | 266 | 2 | 0.0 | 0.0 | 22 | 1.1 / 9 | 0 / 241 | 8 (2.0) | — (— / —) | 2 / 0 / 2 / 0 / 0 | 217 |
| react-pdf-window, no text | 254 | 2 | 0.0 | 0.0 | 18 | 1.0 / 9 | 0 / 241 | 8 (2.0) | — (— / —) | 2 / 0 / 0 / 2 / 0 | 217 |
| react-pdf-window, no text, no links | 254 | 2 | 0.0 | 0.0 | 23 | 1.0 / 11 | 0 / 241 | 6 (1.5) | — (— / —) | 2 / 0 / 0 / 0 / 0 | 217 |

