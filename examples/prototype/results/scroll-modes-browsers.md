# ParaPDF runtime prototype: scripted scroll across browsers

Each browser's full report: [Chromium 156.0.8078.4](scroll-modes-chromium.md) (2026-10-20T06:38:23.324Z), [WebKit 27.2](scroll-modes-webkit.md) (2026-10-20T07:01:47.002Z), [Firefox 157.0](scroll-modes-firefox.md) (2026-10-20T07:07:43.992Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.1 ms (p95); animation frames arrive every 16.7 ms.
- WebKit 27.2: on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.9 ms (p95); animation frames arrive every 13.9 ms.
- Firefox 157.0: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95); animation frames arrive every 16.7 ms.
- Method: the scroll benchmark's method in every browser, 4000 ms of scrolling, median of 3 runs. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls. Dropped frames are frames longer than 1.5 idle frame intervals.
- Cells: blank viewport (%) · main thread blocked (ms) · longest stall (ms) · dropped frames.

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 0.0 · 7 · 5 · 0 | 0.0 · 4 · 6 · 0 | 0.0 · 57 · 20 · 0 |
| pdfjs-hwa, vertical, fit-page | 0.0 · 7 · 5 · 0 | 0.0 · 3 · 6 · 0 | 0.0 · 27 · 9 · 0 |
| pdfjs-hwa, vertical, scale 0.5 | 0.0 · 16 · 7 · 0 | 0.0 · 6 · 6 · 0 | 0.0 · 44 · 10 · 0 |
| pdfjs-hwa, horizontal, fit-width | 0.0 · 2 · 3 · 0 | 0.0 · 1 · 5 · 0 | 0.0 · 57 · 16 · 0 |
| pdfjs-hwa, horizontal, fit-page | 0.0 · 8 · 6 · 0 | 0.0 · 7 · 7 · 0 | 0.0 · 35 · 12 · 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 0.0 · 19 · 7 · 0 | 0.0 · 38 · 12 · 1 | 0.0 · 83 · 12 · 0 |
| pdfjs-hwa, wrapped, fit-width | 0.0 · 4 · 5 · 0 | 0.0 · 2 · 5 · 0 | 0.0 · 37 · 16 · 0 |
| pdfjs-hwa, wrapped, fit-page | 0.0 · 7 · 6 · 0 | 0.0 · 8 · 7 · 0 | 0.0 · 39 · 13 · 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 0.0 · 60 · 9 · 0 | 0.0 · 113 · 15 · 1 | 0.0 · 167 · 18 · 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 0.0 · 7 · 5 · 0 | 0.0 · 5 · 7 · 0 | 0.0 · 85 · 19 · 0 |
| pdfjs-hwa, vertical, fit-page | 0.0 · 8 · 5 · 0 | 0.0 · 3 · 6 · 0 | 0.0 · 34 · 7 · 0 |
| pdfjs-hwa, vertical, scale 0.5 | 0.0 · 24 · 5 · 0 | 0.0 · 22 · 9 · 0 | 0.0 · 175 · 12 · 0 |
| pdfjs-hwa, horizontal, fit-width | 0.0 · 4 · 4 · 0 | 0.0 · 4 · 6 · 0 | 0.0 · 86 · 21 · 0 |
| pdfjs-hwa, horizontal, fit-page | 0.0 · 39 · 7 · 0 | 0.0 · 7 · 7 · 0 | 0.0 · 39 · 8 · 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 0.0 · 50 · 6 · 0 | 0.0 · 11 · 7 · 0 | 0.0 · 174 · 11 · 0 |
| pdfjs-hwa, wrapped, fit-width | 0.0 · 14 · 6 · 0 | 0.0 · 15 · 8 · 0 | 0.0 · 62 · 20 · 0 |
| pdfjs-hwa, wrapped, fit-page | 0.0 · 8 · 5 · 0 | 0.0 · 15 · 10 · 0 | 0.0 · 42 · 10 · 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 0.0 · 168 · 11 · 0 | 0.0 · 57 · 14 · 0 | 0.0 · 286 · 17 · 0 |

## First paint (ms)

Time from navigation start until page 1 shows pixels, median over both scroll speeds' runs.

| File · variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · pdfjs-hwa, vertical, fit-width | 429 | 426 | 484 |
| synthetic-text-1000.pdf · pdfjs-hwa, vertical, fit-page | 426 | 441 | 458 |
| synthetic-text-1000.pdf · pdfjs-hwa, vertical, scale 0.5 | 411 | 458 | 466 |
| synthetic-text-1000.pdf · pdfjs-hwa, horizontal, fit-width | 410 | 459 | 490 |
| synthetic-text-1000.pdf · pdfjs-hwa, horizontal, fit-page | 437 | 432 | 504 |
| synthetic-text-1000.pdf · pdfjs-hwa, horizontal, scale 0.5 | 412 | 434 | 458 |
| synthetic-text-1000.pdf · pdfjs-hwa, wrapped, fit-width | 429 | 440 | 482 |
| synthetic-text-1000.pdf · pdfjs-hwa, wrapped, fit-page | 446 | 452 | 476 |
| synthetic-text-1000.pdf · pdfjs-hwa, wrapped, scale 0.5 | 417 | 446 | 478 |

## React commits while scrolling

Commits depend on the pages crossed, not on the browser; a browser that commits more is rendering React in the hot path. Where the run counted them, the store's changes of the mounted window and of the current page follow in parentheses: commits should not outnumber the two together, and stay far below the frames drawn.

| File · speed · variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, vertical, fit-width | 4 (2 / 2) | 4 (2 / 2) | 4 (2 / 2) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, vertical, fit-page | 8 (4 / 4) | 8 (4 / 4) | 8 (4 / 4) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, vertical, scale 0.5 | 23 (14 / 9) | 23 (14 / 9) | 22 (14 / 9) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, horizontal, fit-width | 5 (2 / 3) | 5 (2 / 3) | 5 (2 / 3) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, horizontal, fit-page | 15 (9 / 6) | 15 (9 / 6) | 15 (9 / 6) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, horizontal, scale 0.5 | 17 (14 / 6) | 17 (15 / 6) | 17 (14 / 6) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, wrapped, fit-width | 4 (2 / 2) | 4 (2 / 2) | 4 (2 / 2) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, wrapped, fit-page | 8 (4 / 4) | 8 (4 / 4) | 8 (4 / 4) |
| synthetic-text-1000.pdf · 900 px/s · pdfjs-hwa, wrapped, scale 0.5 | 24 (15 / 9) | 24 (15 / 9) | 23 (15 / 9) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, vertical, fit-width | 24 (15 / 9) | 24 (15 / 9) | 24 (15 / 9) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, vertical, fit-page | 33 (16 / 17) | 33 (16 / 17) | 33 (16 / 17) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, vertical, scale 0.5 | 63 (55 / 36) | 67 (55 / 36) | 63 (53 / 36) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, horizontal, fit-width | 22 (11 / 11) | 22 (11 / 11) | 22 (11 / 11) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, horizontal, fit-page | 41 (41 / 22) | 42 (41 / 22) | 37 (37 / 22) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, horizontal, scale 0.5 | 53 (49 / 23) | 52 (49 / 23) | 52 (48 / 23) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, wrapped, fit-width | 24 (15 / 9) | 24 (15 / 9) | 24 (15 / 9) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, wrapped, fit-page | 33 (16 / 17) | 33 (16 / 17) | 33 (16 / 17) |
| synthetic-text-1000.pdf · 3600 px/s · pdfjs-hwa, wrapped, scale 0.5 | 64 (56 / 36) | 67 (56 / 36) | 62 (50 / 36) |

