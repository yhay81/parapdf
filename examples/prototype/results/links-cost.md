# ParaPDF runtime prototype: scripted scroll

- Run at: 2026-10-17T23:51:17.483Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (headless, Metal GPU)
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of constant-speed scrolling after the first page is painted, median of 3 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness beyond 2 ms of a 4 ms timer while scrolling, plus the raw p95 and maximum lateness.
- Reproduce: `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`

## usrguide.pdf, 15 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 445 | 2 | 0.0 | 0.0 | 52 | 1.2 / 29 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no links | 449 | 2 | 0.0 | 0.0 | 50 | 1.2 / 29 | 0 / 241 | 4 | 2 / 2 / 2 / 0 / 0 |
| pdfjs-next-hwa | 437 | 2 | 0.0 | 0.0 | 16 | 1.1 / 11 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no links | 440 | 2 | 0.0 | 0.0 | 13 | 1.2 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 0 / 0 |

## usrguide.pdf, 60 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 448 | 8 | 0.0 | 0.0 | 34 | 1.3 / 16 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no links | 431 | 8 | 0.0 | 0.0 | 21 | 1.1 / 9 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 444 | 8 | 0.0 | 0.0 | 4 | 1.2 / 5 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no links | 472 | 8 | 0.0 | 0.0 | 4 | 1.1 / 6 | 0 / 241 | 22 | 8 / 0 / 0 / 0 / 0 |

