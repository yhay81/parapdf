# 0057. Keep visible content ready during reading-speed scrolls

- Status: adopted
- Date: 2026-11-21

## Decision

During a slow scroll, the renderer draws visible pages and one neighboring page on each side. It builds the visible text and annotation layers and honors explicit editor requests. The rest of the mounted window resumes after the last movement. Fast scrolling uses the existing preview policy. The functional tests exercise stopping on the same page and requesting an offscreen editor before stopping.

A page allocates each canvas when the first drawing needs it. A whole-page detail releases the preview it covers when the total canvas budget is unlimited. Under a finite budget the viewer retains a base when it may need to draw a replacement detail in place. Drawings still in progress stay attached and count toward canvas storage. A zoom into a region can keep showing the whole-page detail until there is a replacement underneath.

On page 10 of the 1,000-page PDF, the build before this change had 15 drawing canvases. Lazy allocation alone left 10. Releasing covered previews took the count to 5, one for each mounted page. The react-window reader mounted seven pages with seven canvases. The released ParaPDF 0.10.0 also allocated a structure canvas on untagged pages and had 20 canvases. [Previous experiment](0055-finished-dom-layers.md)

## Measurements

The two builds were the prototype at 52af9f3 and the prototype with this change. The third reader used react-pdf 11.1.0 and react-window 2.5.3 with their default overscan. All three used React 19.3.1, pdfjs-dist 6.5.438, fit-width, selectable text and PDF annotation links. The browser tests ran on an Apple M2 Pro with AC power and DPR 2. Playwright's WebKit figures describe WebKit.

### Scrolling

The 1,280 × 900 viewport scrolled for four seconds per job. Each job measured the idle page first in a fresh browser context. Blocked time sums the lateness of a 4 ms timer above 2 ms or the idle 95th percentile, whichever is larger. Six rounds rotated the three variants, so each occupied each position twice. A paired win means the candidate recorded less delay than react-pdf in the same round.

| Browser | PDF | CSS px/s | Before (ms) | ParaPDF (ms) | react-pdf (ms) | Lower than react-pdf in paired trials |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 4.1 | 0.4 | 4.8 | 6/6 |
| Chromium | 1,000-page text | 3,600 | 7.2 | 9.2 | 17.3 | 5/6 |
| Chromium | 110-page bill | 900 | 9.5 | 1.6 | 3.6 | 6/6 |
| Chromium | 110-page bill | 3,600 | 5.1 | 5.8 | 24.7 | 6/6 |
| WebKit | 1,000-page text | 900 | 1.7 | 1.6 | 2.4 | 4/6 |
| WebKit | 1,000-page text | 3,600 | 3.2 | 3.9 | 4.6 | 4/6 |
| WebKit | 110-page bill | 900 | 10.5 | 2.0 | 7.7 | 6/6 |
| WebKit | 110-page bill | 3,600 | 3.3 | 6.9 | 71.2 | 6/6 |
| Firefox | 1,000-page text | 900 | 22.9 | 20.0 | 18.0 | 3/6 |
| Firefox | 1,000-page text | 3,600 | 43.6 | 21.0 | 168.7 | 6/6 |
| Firefox | 110-page bill | 900 | 16.0 | 9.5 | 13.1 | 3/6 |
| Firefox | 110-page bill | 3,600 | 15.7 | 11.0 | 57.1 | 6/6 |

The candidate recorded less delay than react-pdf in eleven conditions.

<details>
<summary>Blocked milliseconds in each round</summary>

| Browser | PDF | CSS px/s | Before (ms) | ParaPDF (ms) | react-pdf (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 4.6, 8.3, 2.1, 3.5, 2.8, 6.9 | 2.5, 0.0, 1.1, 0.8, 0.0, 0.0 | 6.8, 2.7, 5.4, 8.1, 4.3, 3.0 |
| Chromium | 1,000-page text | 3,600 | 9.0, 8.9, 5.6, 14.7, 5.0, 3.5 | 6.4, 8.6, 15.8, 12.3, 8.0, 9.8 | 18.4, 19.9, 13.3, 16.9, 15.9, 17.7 |
| Chromium | 110-page bill | 900 | 13.6, 5.8, 10.1, 8.8, 6.4, 10.9 | 2.2, 0.0, 0.0, 2.3, 1.1, 2.5 | 3.7, 1.5, 2.3, 7.4, 4.0, 3.4 |
| Chromium | 110-page bill | 3,600 | 9.6, 3.1, 1.9, 1.7, 7.1, 7.0 | 3.5, 3.2, 6.3, 8.7, 9.3, 5.3 | 30.6, 28.3, 25.8, 23.7, 22.6, 21.0 |
| WebKit | 1,000-page text | 900 | 2.1, 3.2, 1.3, 3.1, 0.6, 1.3 | 1.5, 1.5, 4.0, 1.8, 1.7, 1.6 | 6.7, 2.0, 2.2, 0.6, 2.6, 4.4 |
| WebKit | 1,000-page text | 3,600 | 6.0, 2.4, 4.3, 4.0, 0.7, 1.2 | 0.5, 21.2, 4.5, 4.2, 3.7, 2.8 | 3.4, 2.7, 5.9, 2.7, 7.2, 6.4 |
| WebKit | 110-page bill | 900 | 14.8, 9.1, 12.5, 11.8, 4.6, 8.6 | 2.7, 1.7, 1.0, 2.2, 2.6, 1.4 | 6.7, 9.6, 5.9, 5.5, 8.7, 11.0 |
| WebKit | 110-page bill | 3,600 | 1.7, 5.6, 1.1, 7.6, 1.0, 4.8 | 5.1, 6.9, 3.3, 7.0, 8.6, 9.7 | 102.8, 68.5, 56.5, 73.8, 68.6, 84.7 |
| Firefox | 1,000-page text | 900 | 188.4, 12.5, 7.8, 7.3, 44.7, 33.3 | 47.9, 2.3, 3.4, 4.9, 37.3, 35.1 | 15.9, 12.4, 6.3, 20.0, 35.8, 20.4 |
| Firefox | 1,000-page text | 3,600 | 52.1, 117.5, 35.2, 71.2, 16.8, 15.0 | 100.8, 21.8, 18.1, 16.7, 24.2, 20.2 | 189.4, 188.5, 384.2, 149.0, 83.5, 37.3 |
| Firefox | 110-page bill | 900 | 12.3, 18.1, 9.4, 21.5, 13.9, 66.9 | 9.5, 9.5, 5.3, 9.8, 8.9, 36.0 | 6.7, 5.9, 45.4, 13.8, 19.6, 12.4 |
| Firefox | 110-page bill | 3,600 | 73.3, 11.8, 15.3, 8.6, 147.4, 16.1 | 63.1, 9.9, 11.8, 13.1, 10.0, 10.2 | 154.8, 41.4, 58.9, 55.4, 66.5, 31.3 |

</details>

Each cell below gives median canvas storage in MiB after scrolling and median React commits during motion. Storage includes drawings kept for unmounted pages.

| Browser | PDF | CSS px/s | Before | ParaPDF | react-pdf |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 155.9 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| Chromium | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.0 |
| Chromium | 110-page bill | 900 | 183.0 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| Chromium | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 289.0 / 46.0 |
| WebKit | 1,000-page text | 900 | 155.9 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| WebKit | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.5 |
| WebKit | 110-page bill | 900 | 183.0 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| WebKit | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 271.0 / 44.0 |
| Firefox | 1,000-page text | 900 | 155.9 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| Firefox | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.0 |
| Firefox | 110-page bill | 900 | 183.0 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| Firefox | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 289.0 / 46.0 |

| Browser | Load at start | Load at end | Waits | Overlapped jobs repeated |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 7.2 | 7.4 | 3 | 3 |
| WebKit | 7.4 | 6.4 | 0 | 0 |
| Firefox | 6.4 | 6.4 | 0 | 0 |

The one condition favoring react-pdf was Firefox at 900 CSS px/s on the 1,000-page text. A second nine-round series yielded medians of 13.6 ms before, 6.9 ms after and 9.4 ms for react-pdf. The candidate was lower than react-pdf in 3/6 pairs in the first series and 5/9 in the repeat. Individual trials ranged from 2.3 to 57.1 ms for ParaPDF across the two series, and 4.3 to 233.5 ms for react-pdf. These results do not establish a consistent leader in that condition.

Reading-speed canvas storage on the 1,000-page document fell from 155.9 to 124.7 MiB in Chromium. At 3,600 CSS px/s the fast-scroll policy kept the same 111.1 MiB in both builds. The fast Chromium and WebKit medians for the candidate were higher than the previous ParaPDF build despite being below react-pdf. The WebKit bill showed the largest of these increases, 3.3 to 6.9 ms over four seconds.

### Visible pages and reading

An independent eight-second scroll at 900 CSS px/s traveled more than 7,000 CSS pixels, past the initially mounted window. Each animation frame sampled every mounted page with at least four CSS pixels visible. The text marker had to be present and a visible canvas had to cover the visible region at device resolution. This probe ran separately from the timing benchmark. It also checked the pages immediately after scrolling stopped.

| Browser | Reader | Frames sampled | Missing text | Below full resolution | Longest wait at stop (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | ParaPDF | 1443 | 0 | 0 | 0.0 |
| Chromium | react-pdf | 1443 | 0 | 0 | 0.0 |
| WebKit | ParaPDF | 1724 | 12 | 0 | 0.0 |
| WebKit | react-pdf | 1731 | 0 | 0 | 0.0 |
| Firefox | ParaPDF | 1441 | 4 | 0 | 0.0 |
| Firefox | react-pdf | 1444 | 0 | 0 | 0.0 |

The link fixture had identical full-resolution 1,224 × 1,584 RGBA pixels in all nine pairs. Both readers selected “Read” with a real mouse and activated the embedded PDF link with Enter. ParaPDF recognized the three printed addresses with automatic links enabled. All page-10 checks found 555 page elements in ParaPDF and 770 in react-pdf. The counts include the page hosts and exclude react-window’s outer row wrappers. WebKit and Firefox briefly lacked newly visible text during motion. Both were ready at rest.

### Zooming

The 110-page bill was also checked at 820 × 1,000 CSS pixels before and after the change. One pass checked visible ink frame by frame. A separate pass measured the time until all visible pages reached 99% of device resolution and stayed there. Times below are medians of three runs. The two blank-frame columns sum the frames across all three.

| Browser | Zoom | Before (ms) | ParaPDF (ms) | Blank frames before | Blank frames after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | Fit × 1.75 | 11.2 | 12.8 | 0 | 0 |
| Chromium | Fit to 5× | 27.0 | 28.0 | 0 | 0 |
| Chromium | 0.5× to 1.5× | 8.1 | 15.7 | 0 | 0 |
| WebKit | Fit × 1.75 | 6.8 | 11.7 | 0 | 0 |
| WebKit | Fit to 5× | 32.2 | 38.9 | 0 | 0 |
| WebKit | 0.5× to 1.5× | 12.7 | 5.9 | 0 | 0 |
| Firefox | Fit × 1.75 | 58.2 | 58.2 | 0 | 0 |
| Firefox | Fit to 5× | 110.9 | 115.0 | 0 | 0 |
| Firefox | 0.5× to 1.5× | 36.9 | 41.7 | 0 | 0 |

The three-run Chromium median for the 0.5× to 1.5× zoom moved from 8.1 to 15.7 ms. In a separate nine-pair run of that same gesture it was 13.57 ms before and 13.61 ms after, with zero blank frames in either build. Peak canvas storage in the repeat was 190.1 and 189.2 MiB respectively.

### Reproduce

Generate the corpus and build the current prototype with `pnpm --filter @parapdf/bench corpus` and `pnpm --filter @parapdf/prototype build`. Build the prototype at 52af9f3 in a separate checkout. Set `DIST` and `BEFORE` to the absolute paths to the respective prototype build directories. Run from the repository root with Playwright's Chromium, WebKit and Firefox installed.

```sh
export BEFORE_LABEL=52af9f3
export FILES=synthetic-text-1000.pdf,bill-hr815.pdf
for browser in chromium webkit firefox; do
  BROWSER=$browser VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
    SPEEDS=900,3600 DURATION=4000 RUNS=6 node examples/prototype/scripts/scroll-bench.ts
  BROWSER=$browser SCROLL_QUALITY=1 RUNS=3 OUTPUT="/tmp/reading-$browser.json" \
    node examples/prototype/scripts/compare-readers.ts
  BROWSER=$browser ENGINE=pdfjs SCENARIOS=scale-up,zoom-in-far,zoom-in-whole RUNS=3 \
    node examples/prototype/scripts/commit-bench.ts
done

BROWSER=chromium ENGINE=pdfjs SCENARIOS=zoom-in-whole RUNS=9 \
  node examples/prototype/scripts/commit-bench.ts
BROWSER=firefox VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
  FILES=synthetic-text-1000.pdf SPEEDS=900 DURATION=4000 RUNS=9 \
  node examples/prototype/scripts/scroll-bench.ts
```

[Scroll benchmark](../../examples/prototype/scripts/scroll-bench.ts) · [Pixel and reading probes](../../examples/prototype/scripts/compare-readers.ts) · [Zoom probe](../../examples/prototype/scripts/commit-bench.ts) · [npm and browser download measurements](0056-share-installed-pdfjs-assets.md)
