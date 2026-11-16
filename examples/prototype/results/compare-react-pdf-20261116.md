# ParaPDF 0.9.0 versus react-pdf + react-window

Measured source: [`b1a6aa3aee58`](https://github.com/yhay81/parapdf/commit/b1a6aa3aee5874b70ef26cc4cab80359e68a41b5).
The source snapshot was verified file by file against this commit; see the [provenance](compare-react-pdf-20261116-provenance.json).

## Results

Each cell is **ParaPDF / react-pdf + react-window**. Times are milliseconds,
canvas memory is MiB, and commits are counts during four seconds of scrolling.
Every value is the median of five runs. These are viewer-stack measurements
with different rendering policies; read the metric definitions below.

| Browser | Document pages | Speed (CSS px/s) | First paint (ms) | React commits | Canvas (MiB) | Blocked (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium 158.0.8127.18 | 1,000 | 900 | 180.4 / 199.6 | 4 / 10 | 155.9 / 186.9 | 10.2 / 10.4 |
| Chromium 158.0.8127.18 | 1,000 | 3,600 | 161.6 / 180.0 | 25 / 43 | 111.1 / 249.1 | 51.2 / 16.7 |
| Chromium 158.0.8127.18 | 110 | 900 | 141.0 / 187.7 | 4 / 10 | 183.0 / 216.6 | 10.6 / 5.1 |
| Chromium 158.0.8127.18 | 110 | 3,600 | 138.8 / 192.7 | 21 / 46 | 126.5 / 288.9 | 44.9 / 38.2 |
| WebKit 27.2 | 1,000 | 900 | 234.2 / 293.6 | 4 / 10 | 155.9 / 186.9 | 1.6 / 1.8 |
| WebKit 27.2 | 1,000 | 3,600 | 332.0 / 382.0 | 25 / 43 | 111.1 / 249.1 | 4.7 / 21.9 |
| WebKit 27.2 | 110 | 900 | 229.5 / 350.3 | 4 / 10 | 183.0 / 216.6 | 23.3 / 19.1 |
| WebKit 27.2 | 110 | 3,600 | 156.1 / 231.7 | 21 / 46 | 126.5 / 288.9 | 28.5 / 162.8 |
| Firefox 159.0 | 1,000 | 900 | 322.4 / 342.5 | 4 / 10 | 155.9 / 186.9 | 56.8 / 39.3 |
| Firefox 159.0 | 1,000 | 3,600 | 280.7 / 315.2 | 25 / 43 | 111.1 / 249.1 | 80.4 / 139.9 |
| Firefox 159.0 | 110 | 900 | 237.2 / 302.2 | 4 / 10 | 183.0 / 216.6 | 53.7 / 44.2 |
| Firefox 159.0 | 110 | 3,600 | 220.4 / 313.6 | 21 / 43 | 126.5 / 252.7 | 63.8 / 179.2 |

Across all 12 document/speed/browser conditions, ParaPDF committed React
less often (about 42–60% fewer commits) and held fewer canvas pixels at the
sampling point (about 16–56% less estimated canvas memory). All 120 primary
jobs reported zero sampled blank area, and no job returned an error or a
recorded failed render. Blank area is not a pixel-fidelity comparison.

For 1,000 pages at 3,600 CSS px/s in Chromium, commits were 25 versus 43 and
canvas memory was 111.1 versus 249.1 MiB. Main-thread blocked time was worse
for ParaPDF: 51.2 versus 16.7 ms. Chromium also blocked longer on the 110-page
document at both speeds; its 1,000-page slow-scroll result was nearly equal.
WebKit and Firefox blocked less with ParaPDF at the higher speed, while both
blocked more on the 110-page slow-scroll condition; Firefox also blocked
more on the 1,000-page slow-scroll condition.

Every first-paint median was lower with ParaPDF, but it can initially draw a
lower-resolution base. This does not establish a win for reaching equally
sharp pages. First-paint samples vary, and scroll-time blocking excludes
work deferred until scrolling stops. The measurements support fewer React
commits and fewer retained canvas pixels under these conditions, not a
claim that ParaPDF is faster or uses less total memory in every situation.

## Reports and raw data

- chromium: [report](compare-react-pdf-20261116-chromium.md), [summary JSON](compare-react-pdf-20261116-chromium.json), [all individual runs](compare-react-pdf-20261116-chromium-raw.json).
- webkit: [report](compare-react-pdf-20261116-webkit.md), [summary JSON](compare-react-pdf-20261116-webkit.json), [all individual runs](compare-react-pdf-20261116-webkit-raw.json).
- firefox: [report](compare-react-pdf-20261116-firefox.md), [summary JSON](compare-react-pdf-20261116-firefox.json), [all individual runs](compare-react-pdf-20261116-firefox-raw.json).

The first Chromium series ended at a load average of 12.0, and two of the
final condition's ParaPDF first paints were 373 and 491 ms. The complete
series was repeated with the same immutable build and viewer settings. The table
uses the later series in full, without choosing faster individual runs.
The first [report](compare-react-pdf-20261116-chromium-initial.md), [summary](compare-react-pdf-20261116-chromium-initial.json),
and [raw data](compare-react-pdf-20261116-chromium-initial-raw.json) are retained for review.

The first Firefox series recorded 23,620 React profiling timestamp events
and 43 warnings about reordered microtasks through `DIAGNOSTICS`, with no
page errors or failed requests. The listener and per-event writes could
affect timing, so the complete series was repeated without diagnostic
recording. The table uses that repeat in full. Chromium and WebKit
recorded no diagnostic events. Both viewers still use the same React
profiling build to count commits.
The first Firefox [report](compare-react-pdf-20261116-firefox-diagnostics.md),
[summary](compare-react-pdf-20261116-firefox-diagnostics.json), and
[raw data](compare-react-pdf-20261116-firefox-diagnostics-raw.json) are retained.

## Scope and method

Measured on 2026-11-16 on an Apple M2 Pro (12 logical cores), 32 GiB RAM,
macOS 27.2 (Darwin 27.2.0 arm64), connected to AC power without Low Power Mode. Playwright
1.65.0 runs headless Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0.
Playwright WebKit is not Safari. React and React DOM are both 19.3.1.
Both viewers use React's profiling renderer so commits can be counted.

The same separately built prototype supplies both viewers. For every
document, speed, and run, ParaPDF is followed by react-pdf + react-window
in a fresh browser context. Results are medians of five runs per viewer
and condition. The harness waits for other Playwright browsers and a
one-minute load average above 10, and discards and repeats any job that
another detected Playwright browser overlaps. Per-browser reports retain
load averages, wait counts, and overlap retries. The initial Chromium
series used a threshold of 8. After a long wait without starting any
WebKit job, the remaining series and complete Chromium repeat used 10,
matching the concurrent release review. The threshold is checked before
each job and is not a guarantee that load stays below it throughout a job.
Other work continued on this shared machine, so residual background-load
variation remains. Treat the times as observations under these conditions,
not universal latency or speedup guarantees.

- Documents: `synthetic-text-1000.pdf` (1,000 generated text pages) and
  `bill-hr815.pdf` (110-page US government document); sources and licensing
  are in the corpus README. Both are text-focused documents.
- Viewport: 1280 x 900 CSS pixels, devicePixelRatio 2, vertical, fit-width.
- First page: wait until it has pixels, then wait 600 ms before scrolling.
- Scroll: 900 or 3,600 CSS px/s for four seconds from the beginning of the
  document. This crosses about 2 pages at the lower speed and 7 or 9 at
  the higher speed, depending on the document. It does not traverse all
  1,000 pages.
- Text and link layers are enabled in both viewers. ParaPDF uses its
  default GPU-backed canvas mode (`pdfjs-hwa`), with no optional drawing
  worker. The comparison uses react-window's defaults, including overscan,
  and sizes all rows from the first page; it does not test mixed page sizes,
  zooming, navigation, or cache reuse when returning to earlier pages.
- ParaPDF uses pdfjs-dist 6.5.438. react-pdf 11.0.0 uses its own
  pdfjs-dist 6.3.289, with react-window 2.5.3. The comparison includes the
  libraries' different pdf.js versions and rendering policies; it does not
  isolate the viewer layer or represent every possible react-pdf setup.
- PDFs and assets are served locally without added network delay or
  bandwidth limits. First paint is not a production network benchmark.

## Reading the metrics

- **First paint:** navigation start to page 1 having pixels. ParaPDF can
  show a low-resolution base before refinement. This is not time to equally
  sharp pages. Five-run medians can move by an animation frame; each
  individual first paint is included in the reports and raw data.
- **React commits:** commits of the instrumented viewer tree during the
  four seconds of scrolling, not the total cost of rendering the PDF.
- **Canvas memory:** canvas pixels at four bytes each, including ParaPDF's
  kept canvases, sampled after scrolling and after visible blank areas have
  filled. It does not wait for idle full-resolution refinement or all DOM
  layers, and excludes JavaScript, pdf.js, GPU allocation overhead, and
  other browser memory. The number reflects each viewer's rendering and
  retention policy at that time.
- **Main-thread blocked time:** summed lateness of a 4 ms timer above
  max(2 ms, the same context's idle p95), during scrolling. It is not
  CPU time or the duration of one freeze. Compare it within a browser.
  ParaPDF postpones detail and DOM layers while scrolling quickly;
  deferred work after scrolling is outside this measure.
- **Blank area:** sampled visible page area without a completed canvas,
  as a percentage of the viewport. Zero means no such area was observed,
  not that pixels were compared against a reference image or that text
  and link layers were ready during scrolling.

## Reproduce

Use the recorded source commit, generate the synthetic corpus, and build
the prototype into a separate directory. In a checkout with dependencies
and Playwright browsers installed:

```sh
pnpm --filter @parapdf/bench corpus
pnpm --filter @parapdf/prototype build
BROWSER=chromium DIAGNOSTICS=/tmp/parapdf-comparison-chromium \
  VARIANTS=pdfjs-hwa,react-pdf-window \
  TEXT=1 LINKS=1 SCROLL=vertical SCALE=fit-width \
  FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 \
  RUNS=5 DURATION=4000 MAX_LOAD=10 OUTPUT=compare-react-pdf-reproduction \
  pnpm --filter @parapdf/prototype bench
```

Repeat with `BROWSER=webkit` and `BROWSER=firefox`, using a different
`OUTPUT` for each. Keep diagnostic recording for WebKit, and unset
`DIAGNOSTICS` for Firefox to reproduce the primary series. Set `DIST` to a dedicated build directory when another
session is using the checkout's default build.

Implementation: [scroll runner](../scripts/scroll-bench.ts),
[ParaPDF driver](../src/BenchDriver.tsx), [comparison viewer](../src/compare.tsx),
and [corpus sources](../../../bench/corpus/README.md).
