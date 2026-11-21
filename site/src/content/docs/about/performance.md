---
title: Performance
description: Compare ParaPDF and react-pdf on reading quality, canvas memory, startup, scrolling and package size.
head:
  - tag: style
    content: |
      .sl-markdown-content table { font-variant-numeric: tabular-nums; }
      @media (max-width: 25rem) {
        .sl-markdown-content :is(th, td) { padding-inline: 0.1875rem; }
        .sl-markdown-content th:not(:first-child) { min-width: min(4.5rem, 20vw); }
      }
---

**ParaPDF 0.11.0** and **react-pdf 11.1.0** use pdf.js 6.5.438 with selectable text and links. The long-document react-pdf reader adds react-window 2.5.3.

<figure class="performance-highlights">
  <figcaption>ParaPDF vs react-pdf at 3,600 CSS px/s in Chromium, WebKit and Firefox</figcaption>
  <ul role="list">
    <li><strong>86–92%</strong><span>less main-thread delay<small>110-page bill</small></span></li>
    <li><strong>55%</strong><span>less canvas memory<small>1,000-page text</small></span></li>
    <li><strong>74–77%</strong><span>fewer React commits<small>1,000-page text</small></span></li>
  </ul>
</figure>

## Reading a 1,000-page PDF

| During scrolling | ParaPDF | react-pdf |
| --- | ---: | ---: |
| Fast · canvas storage | **111.1 MiB** | 249.3 MiB |
| Fast · React commits per trial | **11** | 43–48 |
| Fast · trials with blank frames | 0/18 | 0/18 |
| Reading speed · frames below full resolution | 0/4,598 | 0/4,616 |
| Reading speed · frames without selectable text | 0/4,598 | 0/4,616 |

Fast scrolling ran at 3,600 CSS px/s. Canvas storage includes cached drawings. A separate eight-second reading test at 900 CSS px/s checked the visible text layers and canvas resolution every frame.

| At rest on page 10 | ParaPDF | react-pdf |
| --- | ---: | ---: |
| Mounted pages | 5 | 7 |
| Canvas elements | 5 | 7 |
| Page elements, including canvases | 555 | 770 |

## Scrolling

Main-thread delay accumulated during four seconds of scrolling. Each value is the median of six trials on an Apple M2 Pro at 2× pixel density. Bold timings show at least 50% less delay than the other reader.

### 1,000-page text

| Browser | CSS px/s | ParaPDF (ms) | react-pdf (ms) |
| --- | ---: | ---: | ---: |
| Chromium | 900 | 2.7 | 3.7 |
| Chromium | 3,600 | 10.3 | 16.1 |
| WebKit | 900 | 2.9 | 3.8 |
| WebKit | 3,600 | 5.4 | 4.6 |
| Firefox | 900 | 4.6 | 9.1 |
| Firefox | 3,600 | **40.4** | 94.2 |

### 110-page bill

| Browser | CSS px/s | ParaPDF (ms) | react-pdf (ms) |
| --- | ---: | ---: | ---: |
| Chromium | 900 | 3.2 | 6.0 |
| Chromium | 3,600 | **3.4** | 24.0 |
| WebKit | 900 | 9.8 | 8.2 |
| WebKit | 3,600 | **4.0** | 51.2 |
| Firefox | 900 | 46.9 | 39.1 |
| Firefox | 3,600 | **15.4** | 123.8 |

ParaPDF recorded less main-thread delay in 9 of 12 conditions. The Firefox reading-speed rows use a lower-load repeat. [Individual trials and repeats](https://github.com/yhay81/parapdf/blob/v0.11.0/docs/decisions/0058-prepare-neighboring-text.md#scrolling)

## Opening a PDF

Median time from navigation to a full-resolution first page, over six cold opens at 820 × 900.

| PDF and browser | ParaPDF (ms) | react-pdf (ms) |
| --- | ---: | ---: |
| 1,000-page text · Chromium | 160 | 186 |
| 1,000-page text · WebKit | 181 | 183 |
| 1,000-page text · Firefox | 324 | 331 |
| 110-page bill · Chromium | 157 | 187 |
| 110-page bill · WebKit | 191 | 276 |
| 110-page bill · Firefox | 202 | 231 |

The Firefox rows use a lower-load repeat. Under heavier system load, the bill opened in 324 ms with ParaPDF and 266 ms with react-pdf. [Both series](https://github.com/yhay81/parapdf/blob/v0.11.0/docs/decisions/0058-prepare-neighboring-text.md#cold-opening)

The text PDF matched pixel for pixel in all three browsers. The bill also matched in Firefox. Its first page differed on 0.03% of pixels in WebKit and 0.04% in Chromium. ParaPDF matched direct pdf.js in every run.

## Download and install size

| Reader | First-page code (gzip) | macOS arm64 install |
| --- | ---: | ---: |
| ParaPDF | 620.4 KiB | 76.72 MiB |
| react-pdf + react-window | 634.5 KiB | 76.87 MiB |
| Single-page react-pdf | 628.8 KiB | 76.46 MiB |

| npm install target | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| Linux x64 (glibc) | 83.02 MiB | 83.17 MiB |
| Windows x64 | 87.25 MiB | 87.40 MiB |

Code includes the JavaScript, CSS and worker requested for a selectable Japanese page. Install sizes include production dependencies and the native binary for each npm target. [Package measurements](https://github.com/yhay81/parapdf/blob/v0.11.0/docs/decisions/0058-prepare-neighboring-text.md#package-size)

## Reading features

| In the reader | ParaPDF | react-pdf |
| --- | --- | --- |
| Select a word with the mouse | 3/3 browsers | 3/3 browsers |
| Activate a PDF link with Enter | 3/3 browsers | 3/3 browsers |
| Recognize printed web and email addresses | 3/3 addresses with automatic links | 0/3 addresses |
| Virtual scrolling | Built in | Add react-window |
| Find text across pages | Built in | App code |
| Fill PDF forms | `PdfForms` | `renderForms` |
| Customize a page | Add overlays in PDF coordinates | Replace the renderer or individual text runs |
| Set up the PDF worker | Automatic | Set `workerSrc` |

[Fixtures and reproduction](https://github.com/yhay81/parapdf/blob/v0.11.0/docs/decisions/0058-prepare-neighboring-text.md) · [react-pdf API](https://github.com/wojtekmaj/react-pdf/blob/aa36493db1568f1330f974b0acf27621d79d0cca/packages/react-pdf/README.md) · [Page turns, zoom and search in ParaPDF 0.10.0](https://github.com/yhay81/parapdf/blob/v0.11.0/examples/prototype/results/performance-0.10.0.md)
