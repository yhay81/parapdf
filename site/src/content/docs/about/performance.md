---
title: Performance
description: Compare ParaPDF and react-pdf on canvas memory, rendering quality, reading features, download size, and scrolling in three browsers.
head:
  - tag: style
    content: |
      .sl-markdown-content table { font-variant-numeric: tabular-nums; }
      @media (max-width: 25rem) {
        .sl-markdown-content :is(th, td) { padding-inline: 0.1875rem; }
      }
---

**ParaPDF 0.10.0** and **react-pdf 11.1.0** used the same pdf.js 6.5.438. The react-pdf reader used react-window 2.5.3 to display long documents. Tests ran on an Apple M2 Pro at 2× pixel density.

## Reading the same PDF

| Reader test | ParaPDF | react-pdf |
| --- | ---: | ---: |
| Fast scroll · canvas storage | 111.1 MiB | 249.3 MiB |
| Fast scroll · React commits | 11 | 43–44 |
| Fast scroll · trials with blank frames | 0/15 | 0/15 |
| Page 10 · mounted pages | 5 | 7 |
| Page 10 · canvas elements | 20 | 7 |
| Page 10 · all page elements | 570 | 770 |
| Select a word with the mouse | 3/3 browsers | 3/3 browsers |
| Activate an embedded link with Enter | 3/3 browsers | 3/3 browsers |
| Plain-text addresses turned into links | 3/3 | 0/3 |

Scrolling and page counts use a 1,000-page document. Canvas storage includes cached drawings. Both readers drew the same 1,224 × 1,584 pixels on the link-test page in each browser. ParaPDF enabled its optional automatic links. [Fixtures and results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/reader-comparison-0.10.0.md)

## Integrating a reader

| In a React application | ParaPDF | react-pdf |
| --- | --- | --- |
| Virtual scrolling | Built in | Add react-window |
| Search across pages | Built in | App code |
| Fill PDF forms | PdfForms | renderForms |
| Replace the page renderer | Fixed pdf.js renderer | Custom renderer |
| Set up the PDF worker | Automatic | Set workerSrc |
| First page · code (gzip) | 620.2 KiB | 634.5 KiB |
| Fresh npm install | 79.9 MiB | 76.6 MiB |

The code total includes scripts, styles and the worker loaded by a minimal Vite reader on a one-page Japanese PDF. The install includes all production dependencies on macOS arm64. [Package measurements](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/reader-comparison-0.10.0.md#install-and-download) · [react-pdf API](https://github.com/wojtekmaj/react-pdf/blob/aa36493db1568f1330f974b0acf27621d79d0cca/packages/react-pdf/README.md)

## Scrolling a 1,000-page document

Both viewers enabled text and links. Each cell is the median main-thread delay accumulated over a four-second scroll.

| Main thread blocked (ms) | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| ParaPDF at 900 px/s | 10.4 | 1.5 | 22.4 |
| react-pdf at 900 px/s | 8.6 | 3.2 | 15.5 |
| ParaPDF at 3,600 px/s | 6.9 | 18.6 | 31.1 |
| react-pdf at 3,600 px/s | 18.8 | 18.0 | 133.6 |

[Both scroll speeds and PDFs](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/performance-0.10.0.md#scrolling)

## Opening a document

Time from navigation to a full-resolution first page, across nine cold opens at 820 × 900. ParaPDF matched direct pdf.js pixel for pixel.

| First page (ms) | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| 110-page bill | 165 | 143 | 210 |
| Same bill, direct pdf.js | 125 | 116 | 160 |
| 1,000-page text | 175 | 169 | 258 |
| Scanned patent | 156 | 193 | 237 |

## Turning pages and zooming

On the 110-page bill, we clicked Next as soon as page 1 appeared. Times are in milliseconds. Return and zoom end when the visible pages stay sharp.

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
