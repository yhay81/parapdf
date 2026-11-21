# 0058. Prepare selectable text on the next page during slow scrolling

- Status: adopted
- Date: 2026-11-21

## Decision

While scrolling at reading speed, finish visible layers and explicitly requested editors first. Then use idle time to prepare text on the mounted page immediately before and after the visible range. Links, forms, editors and more distant pages can wait. Either scroll direction benefits, and a distant editor request still takes priority.

Waiting until each page became visible saved work in the preceding experiment. In WebKit that also left a newly exposed page without its selectable text in four frames in each eight-second trial, despite full-resolution pixels. The two readers were both ready when the scroll stopped. Preparing adjacent text removed that gap during motion. [Preceding experiment](0057-reading-speed-scrolls.md)

## Reading quality

| Browser | Reader | Frames sampled | Missing text | Below full resolution | Longest wait at stop (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | ParaPDF | 1443 | 0 | 0 | 0.0 |
| Chromium | react-pdf | 1443 | 0 | 0 | 0.0 |
| WebKit | ParaPDF | 1730 | 0 | 0 | 0.0 |
| WebKit | react-pdf | 1732 | 0 | 0 | 0.0 |
| Firefox | ParaPDF | 1425 | 0 | 0 | 0.0 |
| Firefox | react-pdf | 1441 | 0 | 0 | 0.0 |

The final build and react-pdf drew identical 1,224 × 1,584 RGBA pixels on the link fixture in all nine pairs. Both selected “Read” with a real mouse and activated the PDF link with Enter. ParaPDF also recognized all three printed web or email addresses with automatic links enabled. The react-pdf reader exposed the embedded link. On the 1,000-page text, all nine page-10 checks found 555 page elements in ParaPDF and 770 in react-pdf, including the page hosts. The react-window row wrappers sit outside those hosts.

## Scrolling

The “Before” build was 7ffee68, with the visible-only text policy of decision 0057. The three readers rotated positions across six rounds at each speed and on each document. The table gives the median calibrated main-thread delay over four seconds on an Apple M2 Pro at DPR 2. Each accepted job ran in a fresh browser context on AC power. The timing pass sampled its own idle threshold and ran separately from the reading-quality probe. [Baseline source](https://github.com/yhay81/parapdf/commit/7ffee68)

| Browser | PDF | CSS px/s | Before (ms) | ParaPDF (ms) | react-pdf (ms) | Lower than react-pdf in paired trials |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 2.6 | 2.7 | 3.7 | 5/6 |
| Chromium | 1,000-page text | 3,600 | 11.1 | 10.3 | 16.1 | 5/6 |
| Chromium | 110-page bill | 900 | 0.2 | 3.2 | 6.0 | 4/6 |
| Chromium | 110-page bill | 3,600 | 3.1 | 3.4 | 24.0 | 6/6 |
| WebKit | 1,000-page text | 900 | 3.9 | 2.9 | 3.8 | 4/6 |
| WebKit | 1,000-page text | 3,600 | 5.7 | 5.4 | 4.6 | 3/6 |
| WebKit | 110-page bill | 900 | 5.5 | 9.8 | 8.2 | 2/6 |
| WebKit | 110-page bill | 3,600 | 4.8 | 4.0 | 51.2 | 6/6 |
| Firefox | 1,000-page text | 900 | 138.4 | 135.2 | 136.8 | 3/6 |
| Firefox | 1,000-page text | 3,600 | 46.5 | 40.4 | 94.2 | 5/6 |
| Firefox | 110-page bill | 900 | 17.4 | 40.5 | 31.7 | 1/6 |
| Firefox | 110-page bill | 3,600 | 20.8 | 15.4 | 123.8 | 6/6 |

ParaPDF had the lower median in 9 of the twelve conditions.

<details>
<summary>Blocked milliseconds in each round</summary>

| Browser | PDF | CSS px/s | Before (ms) | ParaPDF (ms) | react-pdf (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 3.5, 0.7, 2.5, 2.7, 0.0, 3.2 | 3.5, 1.9, 0.9, 0.9, 4.1, 4.6 | 2.7, 4.2, 3.3, 1.6, 4.4, 7.1 |
| Chromium | 1,000-page text | 3,600 | 14.1, 6.2, 15.1, 13.2, 8.6, 9.0 | 15.7, 8.6, 11.9, 12.7, 4.5, 5.4 | 8.5, 27.5, 22.8, 16.3, 14.5, 15.9 |
| Chromium | 110-page bill | 900 | 0.3, 0.0, 1.7, 0.0, 0.9, 0.0 | 3.6, 2.8, 6.0, 1.6, 5.9, 2.6 | 0.3, 8.5, 5.5, 6.5, 7.0, 4.4 |
| Chromium | 110-page bill | 3,600 | 0.3, 2.9, 7.0, 2.7, 3.2, 5.2 | 7.9, 3.4, 3.4, 3.4, 2.3, 7.8 | 24.2, 22.3, 25.0, 23.9, 20.1, 26.8 |
| WebKit | 1,000-page text | 900 | 7.5, 2.6, 2.1, 2.7, 7.6, 5.0 | 1.2, 4.9, 1.9, 4.2, 2.8, 2.9 | 2.4, 5.2, 6.0, 5.7, 2.0, 1.0 |
| WebKit | 1,000-page text | 3,600 | 9.5, 8.4, 7.0, 4.4, 2.2, 2.4 | 4.5, 6.5, 3.7, 6.4, 6.3, 2.1 | 5.6, 3.2, 7.7, 3.8, 5.1, 4.2 |
| WebKit | 110-page bill | 900 | 7.5, 6.4, 2.2, 3.9, 4.7, 6.4 | 3.3, 7.7, 13.6, 11.4, 8.3, 11.9 | 6.8, 11.8, 8.7, 5.4, 7.8, 11.1 |
| WebKit | 110-page bill | 3,600 | 5.7, 5.8, 3.8, 3.3, 2.4, 6.5 | 7.1, 4.6, 3.5, 1.8, 0.8, 9.0 | 50.9, 52.8, 49.0, 60.5, 50.5, 51.5 |
| Firefox | 1,000-page text | 900 | 200.1, 19.9, 177.7, 74.0, 287.5, 99.0 | 14.6, 17.1, 176.0, 221.6, 278.3, 94.4 | 155.9, 12.2, 14.1, 278.7, 189.6, 117.7 |
| Firefox | 1,000-page text | 3,600 | 58.6, 74.3, 28.4, 231.6, 20.8, 34.4 | 58.5, 15.5, 15.2, 52.0, 92.6, 28.8 | 240.3, 79.3, 66.7, 109.0, 45.9, 340.5 |
| Firefox | 110-page bill | 900 | 24.6, 4.9, 61.8, 12.2, 22.7, 11.6 | 163.4, 14.7, 31.7, 79.1, 49.3, 18.5 | 38.5, 14.7, 30.5, 32.8, 13.5, 39.5 |
| Firefox | 110-page bill | 3,600 | 24.6, 72.6, 8.4, 14.2, 17.0, 31.3 | 14.9, 12.8, 28.2, 10.6, 45.8, 15.9 | 68.9, 257.6, 65.2, 117.7, 129.9, 147.2 |

</details>

Canvas storage includes drawings kept for unmounted pages. Each cell gives median MiB after scrolling and median React commits during motion.

| Browser | PDF | CSS px/s | Before | ParaPDF | react-pdf |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 124.7 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| Chromium | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.0 |
| Chromium | 110-page bill | 900 | 144.6 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| Chromium | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 289.0 / 45.5 |
| WebKit | 1,000-page text | 900 | 124.7 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| WebKit | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.5 |
| WebKit | 110-page bill | 900 | 144.6 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| WebKit | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 289.0 / 46.0 |
| Firefox | 1,000-page text | 900 | 126.7 / 2.0 | 124.7 / 2.0 | 187.0 / 10.0 |
| Firefox | 1,000-page text | 3,600 | 111.1 / 11.0 | 111.1 / 11.0 | 249.3 / 43.0 |
| Firefox | 110-page bill | 900 | 144.6 / 2.0 | 144.6 / 2.0 | 216.8 / 10.0 |
| Firefox | 110-page bill | 3,600 | 126.5 / 9.0 | 126.5 / 9.0 | 289.0 / 46.0 |

| Browser | Load at start | Load at end | Waits | Overlapped jobs repeated |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 7.9 | 7.4 | 0 | 0 |
| WebKit | 7.4 | 10.3 | 0 | 0 |
| Firefox | 10.3 | 11.1 | 1 | 1 |

Two WebKit conditions favored react-pdf in the six-round series. Both were repeated independently with nine rounds.

| WebKit, median blocked ms | Visible-only text | Neighboring text | react-pdf |
| --- | ---: | ---: | ---: |
| 1,000-page text, 3,600 CSS px/s | 2.5 | 4.1 | 1.4 |
| 110-page bill, 900 CSS px/s | 3.1 | 9.8 | 6.1 |

On the slow bill, the final viewer completed one additional text layer during the scroll. Both ParaPDF builds completed one detail drawing, performed two React commits, and had a median of zero dropped frames. The visible-only policy saved main-thread time but had left text unavailable on newly visible pages in the separate reading test. We kept the adjacent text layer for selection.

Firefox's reading-speed results varied widely between rounds. A six-round repeat limited the one-minute load average to 12 before each job on the twelve-core machine. The same reader had the lower median on each document in both series. The performance page uses this repeat for both Firefox reading-speed rows.

| Firefox at 900 CSS px/s, median blocked ms | Visible-only text | Neighboring text | react-pdf |
| --- | ---: | ---: | ---: |
| 1,000-page text | 5.7 | 4.6 | 9.1 |
| 110-page bill | 53.7 | 46.9 | 39.1 |

## Cold opening

Each fresh context primed the local connection on an idle page, then navigated to the reader at 820 × 900 CSS pixels. The first full-resolution drawing is timed from navigation start. One warmup per renderer was discarded before six rotating rounds. The direct pdf.js reference renders one page. ParaPDF and react-pdf use their normal neighboring-page behavior. Each timed first-page hash had to match the corresponding renderer's warmup. The discarded round also compared every RGBA pixel against direct pdf.js.

The one-minute system load rose from 10.3 to 35.1 during the Firefox series on twelve logical cores. On the bill ParaPDF's six opens ranged from 235 to 458 ms and react-pdf's from 238 to 1,199 ms. Median time to the first document request was 197 ms for ParaPDF and 171 ms for react-pdf. On the same page, ParaPDF had allocated 15.4 MiB of canvas pixels at full resolution and react-pdf 58.1 MiB.

| Browser | PDF | ParaPDF (ms) | react-pdf (ms) | Direct pdf.js (ms) | ParaPDF canvas (MiB) | react-pdf canvas (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 160.4 | 185.5 | 144.8 | 13.3 | 50.0 |
| Chromium | 110-page bill | 156.8 | 186.6 | 124.9 | 15.4 | 58.2 |
| WebKit | 1,000-page text | 181.1 | 183.2 | 154.2 | 13.3 | 50.0 |
| WebKit | 110-page bill | 190.9 | 275.9 | 142.3 | 15.4 | 58.2 |
| Firefox | 1,000-page text | 432.9 | 523.1 | 407.0 | 13.3 | 50.2 |
| Firefox | 110-page bill | 324.4 | 266.2 | 211.0 | 15.4 | 58.1 |

| Browser | PDF | Different RGBA pixels | Pixels compared | Largest channel difference (0–255) |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 110-page bill | 1,436 | 3,801,696 | 121 |
| Chromium | 1,000-page text | 0 | 3,279,520 | 0 |
| WebKit | 110-page bill | 1,115 | 3,801,696 | 76 |
| WebKit | 1,000-page text | 0 | 3,279,520 | 0 |
| Firefox | 110-page bill | 0 | 3,801,696 | 0 |
| Firefox | 1,000-page text | 0 | 3,279,520 | 0 |

The cold opens were repeated in Firefox with the same load limit used for the slower scrolling tests. Each timed trial used a fresh context. The retained lower-load series on the performance page includes both PDFs. The bill changed order relative to the first series. The full-resolution pixels matched direct pdf.js in every repeat for both readers.

| Firefox, six cold opens | ParaPDF median (ms) | react-pdf median (ms) | Direct median (ms) | ParaPDF lower in pairs |
| --- | ---: | ---: | ---: | ---: |
| 110-page bill | 201.6 | 231.3 | 158.9 | 6/6 |
| 1,000-page text | 323.8 | 331.4 | 350.6 | 5/6 |

On the bill, a Chromium diagnostic isolated the difference in the small graphic at the upper left. Drawing directly through pdf.js with hardware acceleration enabled reproduced ParaPDF's hash. Disabling it and supplying the same opaque 2D context as react-pdf reproduced react-pdf's hash. Changing the PDF annotation mode between its default, enabled annotations and HTML forms did not change either result.

## Package size

The same clean-install and Japanese first-page checks used in decision 0056 were repeated on the final packed build. Preparing neighboring text added 740 bytes to the installed package and 37 gzip bytes to the first-page code. Both readers still used the same pdfjs-dist and native canvas dependency.

| Bytes | ParaPDF | react-pdf + react-window | Single-page react-pdf |
| --- | ---: | ---: | ---: |
| macOS arm64 npm install | 80,442,160 | 80,602,859 | 80,175,275 |
| Linux x64 glibc npm target | 87,051,803 | 87,212,502 | — |
| Windows x64 npm target | 91,483,467 | 91,644,166 | — |
| First-page code, gzip | 635,324 | 649,744 | 643,929 |

Canvas memory is measured in the browser. These install counts sum regular files under `node_modules` on macOS, using npm target flags for Linux and Windows. The browser code includes the application, pdf.js, worker and CSS needed for a selectable Japanese page. [Package contents and method](0056-share-installed-pdfjs-assets.md)

## Reproduce

Build ParaPDF from this change for `DIST` and from 7ffee68 for `BEFORE` in separate checkouts as described in [the preceding experiment](0057-reading-speed-scrolls.md#reproduce). Then run from the repository root.

```sh
export BEFORE_LABEL=visible-text
for browser in chromium webkit firefox; do
  BROWSER=$browser VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
    FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 DURATION=4000 RUNS=6 \
    node examples/prototype/scripts/scroll-bench.ts
  BROWSER=$browser SCROLL_QUALITY=1 RUNS=3 OUTPUT="/tmp/ready-$browser.json" \
    node examples/prototype/scripts/compare-readers.ts
  BROWSER=$browser BEFORE= REACT_PDF=1 FILES=bill-hr815.pdf,synthetic-text-1000.pdf \
    RUNS=6 OUTPUT="/tmp/opening-$browser.json" node examples/prototype/scripts/startup-bench.ts
done

BROWSER=webkit VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
  FILES=synthetic-text-1000.pdf SPEEDS=3600 DURATION=4000 RUNS=9 \
  node examples/prototype/scripts/scroll-bench.ts
BROWSER=webkit VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
  FILES=bill-hr815.pdf SPEEDS=900 DURATION=4000 RUNS=9 \
  node examples/prototype/scripts/scroll-bench.ts
BROWSER=firefox MAX_LOAD=12 VARIANTS=pdfjs-hwa,react-pdf-window REFERENCE=react-pdf-window \
  FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900 DURATION=4000 RUNS=6 \
  node examples/prototype/scripts/scroll-bench.ts
BROWSER=firefox MAX_LOAD=12 BEFORE= REACT_PDF=1 FILES=bill-hr815.pdf,synthetic-text-1000.pdf \
  RUNS=6 OUTPUT=/tmp/opening-firefox-lower-load.json node examples/prototype/scripts/startup-bench.ts
```
