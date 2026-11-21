# 0055. Stop scanning completed layers and create the structure canvas on demand

- Status: adopted
- Date: 2026-11-21

## Decision

The DOM-layer scheduler remembers when all mounted text, annotation and editor layers are built and every visible layer is current. Further scroll frames over the same pages can skip the idle callback. A page attachment, annotation invalidation, change of visible pages, scale or rotation reopens the scan. A scan that yielded to a visible drawing or a layer in flight can still retry.

A page creates its zero-sized structure canvas when pdf.js returns a structure tree. Tagged content keeps its own accessible canvas beside the text layer. Raster canvases, draw order, pixel budgets and the number of pages available for selection follow the existing policies.

## Evidence

The [release comparison](../../examples/prototype/results/reader-comparison-0.10.0.md) found lower canvas backing storage and fewer DOM elements in ParaPDF than in a virtualized react-pdf reader. ParaPDF nevertheless mounted more canvas elements. On the released text and bill fixtures, slow scrolling also blocked the main thread longer than react-pdf in several browser/document combinations. These two findings motivated the changes.

### Idle callbacks and page elements

In Chromium, a diagnostic counted completed `requestIdleCallback` callbacks between the first and last scroll events of a four-second, 900 CSS px/s scroll on the 1,000-page PDF. The only scheduler using this API in the ParaPDF source is DomLayers. The release, candidate and react-pdf used fresh contexts in rotating order. One warmup round was discarded. Instrumentation was disabled in the timing comparison.

| Three trials | ParaPDF 0.10.0 | This change | react-pdf + react-window |
| --- | --- | --- | --- |
| Idle callbacks during scroll | 239, 239, 239 | 8, 8, 8 | 0, 0, 0 |
| Scroll events | 240, 240, 240 | 241, 239, 240 | 240, 239, 240 |

At rest on page 10 of the same document, ParaPDF mounted five pages and react-pdf seven. Both drew the same full-resolution pixels on the link fixture in all nine paired checks across Chromium, WebKit and Firefox. All three browsers selected the same word and activated the embedded link with Enter. [Reader checks](../../examples/prototype/scripts/compare-readers.ts)

| After the jump | ParaPDF 0.10.0 | This change | react-pdf + react-window |
| --- | ---: | ---: | ---: |
| Page hosts and their descendants | 570 | 565 | 770 |
| Canvas elements in those hosts | 20 | 15 | 7 |

The five eliminated elements already held zero pixels. ParaPDF still has a base drawing, detail drawing and a spare to keep an existing detail on screen during replacement. The tagged-document, form, link and two-viewer checks exercise the structure tree and annotation names through the normal viewer.

### Scrolling

The before and after builds and the react-pdf reader were driven by the same [scroll benchmark](../../examples/prototype/scripts/scroll-bench.ts). Text and links were enabled at fit-width, 1,280 × 900 CSS pixels and DPR 2. Jobs used fresh browser contexts, measured the idle page first, and scrolled vertically for four seconds. Each condition ran five rounds on AC power. The react-pdf column uses the candidate prototype's unchanged comparison entry.

| Browser | PDF | Speed (px/s) | 0.10.0 (ms) | This change (ms) | react-pdf (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | 11.0 | 7.5 | 4.3 |
| Chromium | 1,000-page text | 3600 | 14.9 | 26.5 | 21.2 |
| Chromium | 110-page bill | 900 | 9.6 | 9.7 | 2.7 |
| Chromium | 110-page bill | 3600 | 5.6 | 11.7 | 25.3 |
| WebKit | 1,000-page text | 900 | 4.6 | 5.0 | 3.0 |
| WebKit | 1,000-page text | 3600 | 4.4 | 4.9 | 11.7 |
| WebKit | 110-page bill | 900 | 13.0 | 10.4 | 7.9 |
| WebKit | 110-page bill | 3600 | 5.9 | 9.3 | 89.5 |
| Firefox | 1,000-page text | 900 | 21.6 | 17.6 | 18.5 |
| Firefox | 1,000-page text | 3600 | 47.7 | 34.3 | 96.4 |
| Firefox | 110-page bill | 900 | 118.7 | 204.0 | 26.7 |
| Firefox | 110-page bill | 3600 | 113.0 | 12.8 | 101.7 |

At 900 px/s, the changed build reduced median blocked time on the text PDF in Chromium (11.0 to 7.5 ms) and Firefox (21.6 to 17.6 ms), and on the bill in WebKit (13.0 to 10.4 ms). React-pdf had the lower median in five of the six slow-scroll conditions. At 3,600 px/s, ParaPDF had the lower median in five of six. The slow Firefox bill and fast Chromium runs had large within-condition spreads. All 60 trials per viewer had zero sampled blank frames. Before and after had the same median canvas backing storage in each condition.

<details>
<summary>Main-thread blocked time in each of five trials (ms)</summary>

| Browser | PDF | Speed (px/s) | 0.10.0 | This change | react-pdf | react-pdf in the before build |
| --- | --- | ---: | --- | --- | --- | --- |
| Chromium | 1,000-page text | 900 | 11.0, 13.8, 4.3, 4.5, 11.2 | 7.5, 8.1, 4.3, 1.1, 16.8 | 7.8, 7.5, 1.2, 2.1, 4.3 | 3.4, 2.2, 4.3, 3.9, 13.9 |
| Chromium | 1,000-page text | 3600 | 5.3, 9.1, 30.6, 14.9, 25.8 | 39.5, 1.3, 2.8, 43.2, 26.5 | 25.9, 17.5, 21.3, 10.0, 21.2 | 40.7, 14.9, 36.7, 22.4, 15.7 |
| Chromium | 110-page bill | 900 | 5.2, 9.6, 9.9, 7.6, 20.3 | 8.8, 6.3, 11.0, 9.7, 10.5 | 4.3, 2.7, 1.1, 4.9, 1.6 | 6.7, 2.7, 5.7, 7.9, 3.0 |
| Chromium | 110-page bill | 3600 | 7.4, 5.6, 4.5, 0.0, 37.3 | 22.4, 13.7, 2.6, 2.8, 11.7 | 24.2, 26.0, 25.3, 19.5, 65.4 | 21.8, 17.1, 22.2, 49.5, 20.3 |
| WebKit | 1,000-page text | 900 | 4.6, 7.6, 5.6, 4.4, 1.0 | 14.1, 7.5, 1.7, 4.3, 5.0 | 3.0, 3.3, 0.8, 2.2, 82.9 | 1.7, 4.9, 2.4, 0.4, 1.9 |
| WebKit | 1,000-page text | 3600 | 4.4, 2.2, 4.3, 5.5, 10.6 | 2.9, 4.9, 1.5, 8.2, 13.1 | 9.2, 13.6, 25.9, 11.7, 6.7 | 2.1, 8.0, 9.4, 5.7, 84.6 |
| WebKit | 110-page bill | 900 | 11.7, 11.3, 13.0, 14.7, 15.9 | 13.1, 4.0, 10.4, 14.2, 5.1 | 6.8, 10.8, 4.0, 7.9, 18.8 | 7.5, 6.5, 3.9, 19.6, 11.5 |
| WebKit | 110-page bill | 3600 | 5.9, 4.9, 10.9, 2.9, 7.0 | 6.3, 7.8, 9.3, 10.7, 9.6 | 97.4, 89.5, 83.1, 100.9, 89.0 | 99.1, 96.3, 83.3, 100.1, 93.4 |
| Firefox | 1,000-page text | 900 | 52.4, 11.9, 21.6, 85.8, 11.5 | 51.6, 11.3, 28.3, 17.6, 13.7 | 327.8, 18.5, 21.0, 6.3, 11.3 | 22.0, 44.1, 45.2, 23.6, 9.9 |
| Firefox | 1,000-page text | 3600 | 20.4, 72.7, 120.2, 47.7, 21.3 | 34.3, 13.7, 167.0, 30.2, 54.5 | 96.4, 112.3, 250.6, 91.2, 61.9 | 65.5, 138.6, 0.0, 106.4, 53.5 |
| Firefox | 110-page bill | 900 | 5.4, 22.3, 181.0, 118.7, 225.1 | 16.7, 33.2, 428.0, 373.2, 204.0 | 26.7, 141.0, 0.0, 193.1, 11.2 | 19.6, 146.1, 22.0, 82.6, 15.2 |
| Firefox | 110-page bill | 3600 | 552.8, 291.6, 12.2, 49.7, 113.0 | 6.3, 31.0, 12.8, 54.0, 12.0 | 101.7, 112.2, 79.0, 182.2, 56.2 | 583.1, 98.8, 123.1, 231.5, 45.5 |

</details>

| Browser | Load at start | Load at end | Waits | Overlap retries |
| --- | ---: | ---: | ---: | ---: |
| Chromium 159.0.8154.6 | 2 | 7.7 | 2 | 2 |
| WebKit 27.2 | 7.7 | 18.2 | 2 | 2 |
| Firefox 159.0 | 18.2 | 8.4 | 4 | 0 |

### Reverse-order checks

The primary run put the changed viewer first in each pair. A separate nine-round repeat put 0.10.0 first to check the higher medians in Chromium on fast scrolls and in Firefox on the slow bill. It used the same builds, idle calibration and load ceiling, with only the two ParaPDF variants. No trial in the 27 pairs crossed the 1% blank-area threshold in any sampled frame.

| Browser | PDF | Speed (px/s) | 0.10.0 median (ms) | This change median (ms) | Pairs with less blocking after | 0.10.0 trials (ms) | This change trials (ms) |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Chromium | 1,000-page text | 3600 | 5.2 | 6.3 | 4/9 | 3.6, 6.5, 7.6, 3.1, 2.5, 5.2, 7.2, 3.0, 7.1 | 2.2, 3.7, 2.6, 3.6, 12.9, 6.3, 7.4, 8.7, 6.5 |
| Chromium | 110-page bill | 3600 | 4.1 | 6.1 | 4/9 | 1.5, 5.0, 2.4, 4.1, 9.3, 8.9, 2.5, 0.9, 11.1 | 1.5, 3.0, 1.0, 7.1, 9.3, 6.9, 8.1, 6.1, 5.1 |
| Firefox | 110-page bill | 900 | 25.0 | 28.4 | 5/9 | 25.0, 16.2, 25.6, 23.8, 25.9, 24.7, 231.4, 206.7, 10.3 | 62.7, 11.9, 17.7, 177.2, 18.8, 34.5, 117.5, 18.4, 28.4 |

In this repeat Chromium's medians increased by 1.1 ms on the text PDF and 2.0 ms on the bill over four seconds. The changed viewer had less blocking in four of nine pairs on each PDF. The Firefox slow-bill gap fell from 85.3 ms in the primary run to 3.4 ms in the repeat, with the changed build ahead in five of nine pairs. We adopted the predictable reduction in callbacks and DOM elements. The timings do not establish a general scrolling speedup.

### Installation size

Moving all byte-identical, bundled pdf.js files into the common dependency could recover at most 3,215,507 bytes from a 3,462,748-byte installation gap on macOS arm64. That would also change the copyable static asset directory applications use with `assetBase`. The packaged directory stays available. The minimal reader already loads 14,677 fewer gzip bytes of code on the Japanese PDF with the existing setup. [Installation and browser code measurements](../../examples/prototype/results/reader-comparison-0.10.0.md#install-and-download)

### Custom drawing

React-pdf also lets an application replace the page renderer. ParaPDF uses pdf.js drawings to decide when a page is sharp and which canvases can be reused on zoom or return. A replacement would need to participate in those lifecycle and memory decisions. Page overlays already add application content at PDF coordinates while preserving the existing renderer. [Rendering architecture](../architecture.md)

## Reproduce

Build the v0.10.0 prototype and this checkout to separate directories. Generate the corpus and install the browsers as in the [release measurements](../../examples/prototype/results/performance-0.10.0.md#reproduce).

```sh
export BEFORE=/absolute/path/to/v0.10.0/dist
export DIST=/absolute/path/to/the/changed/dist
for browser in chromium webkit firefox; do
  BROWSER=$browser MAX_LOAD=12 BEFORE_LABEL=0.10.0 VARIANTS=pdfjs-hwa,react-pdf-window \
    FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 DURATION=4000 RUNS=5 \
    OUTPUT="finished-layers-$browser" node examples/prototype/scripts/scroll-bench.ts
  BROWSER=$browser RUNS=3 node examples/prototype/scripts/compare-readers.ts
done
```

For the reverse-order repeat, swap the build paths, keep the same four-second duration, and run nine pairs of the ParaPDF viewer alone.

```sh
released=$BEFORE
changed=$DIST
BROWSER=chromium DIST="$released" BEFORE="$changed" BEFORE_LABEL=changed MAX_LOAD=12 \
  VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=3600 RUNS=9 \
  OUTPUT=reverse-fast-chromium node examples/prototype/scripts/scroll-bench.ts
BROWSER=firefox DIST="$released" BEFORE="$changed" BEFORE_LABEL=changed MAX_LOAD=12 \
  VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf SPEEDS=900 RUNS=9 \
  OUTPUT=reverse-slow-firefox node examples/prototype/scripts/scroll-bench.ts
```

For the separate Chromium callback count, install the following probe with Playwright's `page.addInitScript` before navigating to either reader, and read `last - first` after the scroll finishes.

```js
const idle = window.requestIdleCallback.bind(window);
const probe = window.idleProbe = { count: 0, first: null, last: null };
window.requestIdleCallback = (callback, options) => idle((deadline) => {
  probe.count++;
  callback(deadline);
}, options);
document.addEventListener("scroll", () => {
  probe.first ??= probe.count;
  probe.last = probe.count;
}, { capture: true, passive: true });
```

## Reopen if

A new DOM layer can become stale without an existing invalidation signal, or a smaller drawing surface policy preserves sharp zoom replacements and improves measured storage or main-thread stalls.
