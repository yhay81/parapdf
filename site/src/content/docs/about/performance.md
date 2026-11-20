---
title: Performance
description: ParaPDF opening, scrolling, navigation, zoom, search, and memory use measured in Chromium, WebKit, and Firefox.
head:
  - tag: style
    content: |
      .sl-markdown-content table { font-variant-numeric: tabular-nums; }
      .sl-markdown-content td:not(:first-child) { white-space: nowrap; }
      @media (max-width: 25rem) {
        .sl-markdown-content :is(th, td) { padding-inline: 0.1875rem; }
      }
---

ParaPDF **0.10.0** on an Apple M2 Pro, with local PDFs at 2× pixel density. All times are medians in milliseconds.

## Opening a document

Time from navigation to a full-resolution first page, across nine cold opens at 820 × 900. ParaPDF matched direct pdf.js pixel for pixel.

| First page (ms) | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| 110-page bill | 165 | 143 | 210 |
| Same bill, direct pdf.js | 125 | 116 | 160 |
| 1,000-page text | 175 | 169 | 258 |
| Scanned patent | 156 | 193 | 237 |

## Scrolling a 1,000-page document

Four seconds of scrolling covered two pages at 900 px/s or nine at 3,600 px/s. react-pdf 11.1.0 used react-window 2.5.3. Both viewers enabled text and links.

| Main thread blocked (ms) | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| ParaPDF at 900 px/s | 10.4 | 1.5 | 22.4 |
| react-pdf at 900 px/s | 8.6 | 3.2 | 15.5 |
| ParaPDF at 3,600 px/s | 6.9 | 18.6 | 31.1 |
| react-pdf at 3,600 px/s | 18.8 | 18.0 | 133.6 |

| Fast scroll | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| ParaPDF · React commits | 11 | 11 | 11 |
| react-pdf · React commits | 44 | 43 | 43 |
| ParaPDF · canvases (MiB) | 111.1 | 111.1 | 111.1 |
| react-pdf · canvases (MiB) | 249.3 | 249.3 | 249.3 |
| Runs with blanks (both viewers) | 0/10 | 0/10 | 0/10 |

Blocked time sums main-thread delays during the scroll. A frame counts as blank if over 1% of the viewport lacks a drawing when sampled. Canvas storage includes cached pages after visible gaps fill. [Both scroll speeds and PDFs](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/performance-0.10.0.md#scrolling)

## Turning pages and zooming

On the 110-page bill, we clicked Next as soon as page 1 appeared. Return and zoom times run from the jump or zoom commit until the visible pages stay sharp.

| Action | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| First drawing of page 2 | 0.9 | 3.7 | 0.8 |
| Sharp page 2 | 13.2 | 72.9 | 11.7 |
| Page 13 to page 1, default cache | 2.9 | 7.1 | 10.1 |
| Same return, cache disabled | 20.3 | 37.0 | 151.4 |
| 1.75× fit-width zoom to sharp | 6.8 | 6.5 | 51.3 |
| Blank frames across five zooms | 0 | 0 | 0 |

## Searching a large document

After pdf.js extracted text from all 1,000 pages, ParaPDF built the index once and searched it for “lorem” and “dolor”.

| Search time (ms) | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| Build the index | 139.5 | 97.4 | 196.2 |
| Run both queries on the index | 12.6 | 6.5 | 11.3 |

## Canvas and search memory (MiB)

Canvas storage counts four bytes per pixel at first draw, including ParaPDF’s preview of page 2. For the two text PDFs, index storage counts source positions for one set of search options.

| PDF | ParaPDF canvases | pdf.js canvas | Index positions |
| --- | ---: | ---: | ---: |
| 110-page bill | 15.41 | 14.50 | 0.90 |
| 1,000-page text | 13.29 | 12.51 | 11.39 |
| Scanned patent | 15.09 | 14.20 | — |

[Playwright runs and reproduction steps](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/performance-0.10.0.md) · [Canvas memory options](/reference/options/#memory-and-rendering)
