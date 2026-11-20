---
title: Performance
description: First-page and page-turn times, scrolling costs against react-pdf, and memory use in ParaPDF.
head:
  - tag: style
    content: |
      .sl-markdown-content table { font-variant-numeric: tabular-nums; }
      @media (max-width: 25rem) {
        .sl-markdown-content :is(th, td) { padding-inline: 0.1875rem; }
      }
---

ParaPDF **0.10.0** on an Apple M2 Pro, with local PDFs at 2× pixel density. All timings are medians.

## Opening a document

Time to a full-resolution first page across nine cold opens at 820 × 900. ParaPDF matched direct pdf.js pixel for pixel.

| First page | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| 110-page bill | 165 ms | 143 ms | 210 ms |
| Same bill, direct pdf.js | 125 ms | 116 ms | 160 ms |
| 1,000-page text | 175 ms | 169 ms | 258 ms |
| Scanned patent | 156 ms | 193 ms | 237 ms |

## Scrolling a 1,000-page document

Four seconds of scrolling covered two pages at 900 px/s or nine at 3,600 px/s. react-pdf 11.1.0 used react-window 2.5.3. Both viewers enabled text and links.

| Main thread blocked | Chromium | WebKit |
| --- | ---: | ---: |
| ParaPDF at 900 px/s | 10.4 ms | 1.5 ms |
| react-pdf at 900 px/s | 8.6 ms | 3.2 ms |
| ParaPDF at 3,600 px/s | 6.9 ms | 18.6 ms |
| react-pdf at 3,600 px/s | 18.8 ms | 18.0 ms |

| Fast scroll | Chromium | WebKit |
| --- | ---: | ---: |
| ParaPDF · React commits | 11 | 11 |
| react-pdf · React commits | 44 | 43 |
| ParaPDF · canvas storage | 111.1 MiB | 111.1 MiB |
| react-pdf · canvas storage | 249.3 MiB | 249.3 MiB |
| Runs with a blank frame (both viewers) | 0/10 | 0/10 |

Blocked time sums main-thread delays during the scroll. A frame counts as blank if over 1% of the viewport lacks a drawing when sampled. Canvas storage includes cached pages after visible gaps fill. [Both scroll speeds and PDFs](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/performance-0.10.0.md#scrolling)

## Turning to page 2

We clicked Next as soon as page 1 of the bill appeared.

| Action | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| Next to first drawing of page 2 | 0.9 ms | 3.7 ms | 0.8 ms |
| Next to sharp page 2 | 13.2 ms | 72.9 ms | 11.7 ms |

## Canvas and search memory

Opening canvases count four bytes per pixel, including ParaPDF’s preview of page 2. The index stores source positions for one set of search options.

| PDF | ParaPDF canvases | pdf.js canvas | Index positions |
| --- | ---: | ---: | ---: |
| 110-page bill | 15.41 MiB | 14.50 MiB | 0.90 MiB |
| 1,000-page text | 13.29 MiB | 12.51 MiB | 11.39 MiB |
| Scanned patent | 15.09 MiB | 14.20 MiB | — |

[Playwright runs and reproduction steps](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/performance-0.10.0.md) · [Canvas memory options](/reference/options/#memory-and-rendering)
