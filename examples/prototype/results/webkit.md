# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-18T12:25:05.036Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 4.0 ms (median) / 5.6 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 459 | 2 | 0.0 | 0.0 | 10 | 5.7 / 9 | 7 / 221 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 458 | 2 | 0.0 | 0.0 | 6 | 5.7 / 8 | 7 / 229 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 462 | 2 | 0.0 | 0.0 | 9 | 5.7 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 438 | 2 | 0.0 | 0.0 | 5 | 5.6 / 7 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 443 | 2 | 0.0 | 0.0 | 8 | 5.7 / 8 | 7 / 233 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 464 | 2 | 0.0 | 0.0 | 4 | 5.6 / 7 | 7 / 227 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 457 | 2 | 0.0 | 0.0 | 20 | 5.7 / 8 | 0 / 242 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 450 | 2 | 0.0 | 0.0 | 10 | 5.7 / 9 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 446 | 9 | 0.0 | 0.0 | 19 | 5.7 / 9 | 10 / 232 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 451 | 9 | 0.0 | 0.0 | 15 | 5.6 / 8 | 10 / 233 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 450 | 9 | 0.0 | 0.0 | 20 | 5.8 / 10 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 440 | 9 | 0.0 | 0.0 | 10 | 5.6 / 9 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 459 | 9 | 0.0 | 0.0 | 8 | 5.8 / 8 | 9 / 230 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 458 | 9 | 0.0 | 0.0 | 5 | 5.7 / 7 | 9 / 230 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 470 | 9 | 0.0 | 0.0 | 5 | 5.7 / 7 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 443 | 9 | 0.0 | 0.0 | 6 | 5.7 / 8 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 443 | 2 | 0.0 | 0.0 | 28 | 5.9 / 12 | 7 / 233 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 433 | 2 | 0.0 | 0.0 | 5 | 5.6 / 8 | 7 / 234 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 427 | 2 | 0.0 | 0.0 | 38 | 5.9 / 11 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 407 | 2 | 0.0 | 0.0 | 5 | 5.7 / 6 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 444 | 2 | 0.0 | 0.0 | 30 | 5.8 / 11 | 7 / 231 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 431 | 2 | 0.0 | 0.0 | 8 | 5.4 / 6 | 7 / 229 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 430 | 2 | 0.0 | 0.0 | 40 | 5.8 / 14 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 449 | 2 | 0.0 | 0.0 | 9 | 5.7 / 7 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 444 | 7 | 0.0 | 0.0 | 15 | 5.7 / 9 | 12 / 225 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 436 | 7 | 0.0 | 0.0 | 4 | 5.6 / 7 | 10 / 223 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 417 | 7 | 0.0 | 0.0 | 26 | 5.6 / 11 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 409 | 7 | 0.0 | 0.0 | 19 | 5.6 / 8 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next | 447 | 7 | 0.0 | 0.0 | 10 | 5.6 / 12 | 11 / 227 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 433 | 7 | 0.0 | 0.0 | 4 | 5.6 / 6 | 12 / 227 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 459 | 7 | 0.0 | 0.0 | 29 | 5.8 / 12 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 430 | 7 | 0.0 | 0.0 | 10 | 5.7 / 7 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |

