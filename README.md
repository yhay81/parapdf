# ParaPDF

The fastest PDF viewer for React: rendering off the main thread, React out of
the hot path.

> **Status: Phase 0.** Engine benchmark and runtime prototype. Nothing is
> published and the API does not exist yet.

The name combines the Japanese "parapara", flipping quickly through pages, with
parallel rendering on worker threads.

## Phase 0

Phase 0 decides the rendering engine and validates the runtime architecture
with measurements instead of assumptions.

- Compare engines on the same corpus: pdf.js on the main thread, pdf.js with
  its renderer worker, PDFium compiled to WebAssembly, and hayro compiled to
  WebAssembly.
- Measure time to first page, per-page render time, main-thread blocking,
  memory, and transfer size.
- Publish the wins and losses in [`bench/results/`](bench/results/).

### Findings so far (2026-10-18)

One machine (Apple M2 Pro), 14 PDFs, median of three runs, in Playwright's
headless builds of Chromium 156, WebKit 27.2, and Firefox 157; summary in
[`bench/results/browsers.md`](bench/results/browsers.md), details per browser in
[`chromium.md`](bench/results/chromium.md), [`webkit.md`](bench/results/webkit.md),
and [`firefox.md`](bench/results/firefox.md). Playwright's WebKit is not Safari:
Safari itself and mobile browsers are not measured yet.

- **Payload.** Released pdf.js is 404 KiB brotli; PDFium is 1,645 KiB and
  hayro 1,364 KiB.
- **Non-embedded Japanese fonts.** Only pdf.js draws them, through the
  operating system's fonts, in all three browsers (Firefox picks a different
  fallback face). PDFium and hayro need shipped fallback fonts.
- **Main thread.** On five text-heavy documents, released pdf.js drawing on
  the main thread stalls the event loop for 16–17 ms at worst (median per
  document) in Chromium and 14–16 ms in Firefox. WebKit stalls for only
  6–7 ms on the same drawing; why is not verified (WebKit may defer canvas
  drawing to its GPU process). pdf.js master's renderer worker brings the
  worst stall down to 1.6 ms in Chromium on a GPU canvas, 4.2–4.6 ms in
  Firefox, and WebKit's idle level of about 6 ms. Image-heavy scans (patent,
  bunka) still stall the main thread for 13–34 ms with the renderer worker in
  Chromium and WebKit, but for 5–7 ms in Firefox: an upstream investigation
  candidate.
- **Speed.** PDFium and hayro commit text pages first in every browser
  (median 44–51 ms in Chromium, 43–45 ms in WebKit, 34–36 ms in Firefox,
  versus 53–80 ms for the pdf.js variants). hayro is fastest on the large
  scan in all three (39–49 ms). pdf.js is fastest on 200,000 vector segments:
  its best variant takes 68 ms in Chromium, 72 ms in WebKit, and 93 ms in
  Firefox, versus 224–261 ms for hayro and 375–410 ms for PDFium.
- **Fidelity.** Released pdf.js 6.4.299 fails a JPEG 2000 image behind LZW that
  master fixes. Every pdf.js build differs from PDFium's reference rendering of
  a soft-mask blend fixture, which PDFium and hayro match. Neither result
  depends on the browser.
- **Direction.** Keep pdf.js with the renderer worker as the default engine for
  its size, CJK coverage, and vector speed; it removes most main-thread
  drawing in Chromium and Firefox. In WebKit the gain is small and the first
  text page arrives later (74 versus 56 ms median for released pdf.js on a
  GPU canvas), so the choice there needs a measurement in Safari itself. Keep
  hayro as a research backend for scans and transparency fidelity.

### Runtime prototype (2026-10-18)

[`packages/parapdf`](packages/parapdf) implements the React-first runtime on
the pdf.js core API. [`examples/prototype`](examples/prototype) measures it
with a scripted scroll at devicePixelRatio 2 in Playwright's Chromium, WebKit,
and Firefox; summary in
[`examples/prototype/results/browsers.md`](examples/prototype/results/browsers.md),
details per browser in [`chromium.md`](examples/prototype/results/chromium.md),
[`webkit.md`](examples/prototype/results/webkit.md), and
[`firefox.md`](examples/prototype/results/firefox.md). Each cell is the median
of two runs, and a virtual machine used 40–80% of a CPU core during these
runs: compare blocked times within a browser, and treat differences under
about 20 ms as noise.

- **React stays out of the hot path.** In all three browsers, scrolling across
  7–9 pages over 241 frames caused 20–24 React commits, one batch per change
  of the mounted window or the current page.
- **No blank pages.** In all three browsers, at 900 and 3,600 CSS pixels per
  second, low-resolution base renders stayed ahead of the viewport;
  full-resolution renders waited until scrolling settled.
- **Main thread in Chromium.** During slow scrolling with full-resolution
  renders, pdf.js master's renderer worker on a GPU-backed canvas blocked the
  main thread for 3–18 ms, with stalls of at most 9 ms. Released pdf.js on its
  default CPU canvas reached 50–71 ms, with single stalls of 27–35 ms.
- **WebKit.** Every variant blocked for 4–40 ms, with stalls of at most
  14 ms. CPU-backed canvases dropped 6–12 frames in 4 seconds of scrolling
  where GPU-backed canvases dropped none: one more reason to default to
  `enableHWA`.
- **Firefox.** Every variant blocked for 25–96 ms, with stalls of 7–14 ms,
  the renderer worker on a GPU-backed canvas included (31–51 ms). Scrolling
  pages that are already rendered, with nothing new to render, blocks for
  2–42 ms (median 5; see
  [`control.md`](examples/prototype/results/control.md)), so rendering still
  costs Firefox's main thread time with the renderer worker; why is not known
  yet.
- **Startup.** Starting the PDF download with React's `preload()` moved first
  paint of bill-hr815 from 800 to 684 ms on released pdf.js and from 619 to
  503 ms with the renderer worker (Chromium, median of five runs; see
  [`startup-preload.md`](examples/prototype/results/startup-preload.md) and
  [`startup-no-preload.md`](examples/prototype/results/startup-no-preload.md)).
- **Text, search, and accessibility.** pdf.js text layers make pages
  selectable and readable by screen readers. Whole-document search normalizes
  text the way pdf.js's find controller does: it ignores full-width forms,
  case, and diacritics, and matches words that a line end splits, such as
  厚生労働 broken after 厚生 or "divi-" / "sions". Results are painted with the
  CSS Custom Highlight API without touching the text layer DOM. Pages are
  labelled regions and the viewport is a focusable document.
  [`check-text.ts`](examples/prototype/scripts/check-text.ts) verifies
  selection, including drags past a line's end and across the gap between
  two pages in both directions, search, Japanese, full-width, diacritic, and
  line-break matching, and these semantics in all three browsers.
- **Text layer cost.** Text layers are built only after scrolling settles, one
  page per idle period. With the renderer worker on a GPU-backed canvas in
  Chromium, slow scrolling blocked the main thread for 3–18 ms with text
  layers and 1–2 ms without; fast scrolling builds none.
- **Links and outline.** pdf.js annotation layers make links focusable and
  named by the text they cover; internal links, the outline, and named actions
  go through the runtime, which keeps a back stack (`Back`, Alt+Left). On
  `usrguide.pdf`, link and outline jumps land on the same page, and
  [`check-links.ts`](examples/prototype/scripts/check-links.ts) verifies mouse
  and keyboard activation, the back stack, and external link attributes in
  all three browsers. Annotation layers made no difference beyond noise during
  slow scrolling in Chromium (25 versus 20 ms with the renderer worker on a
  GPU-backed canvas, 61 versus 53 ms with released pdf.js; see
  [`links-cost.md`](examples/prototype/results/links-cost.md)). An earlier
  figure of 3 ms came from a run in Low Power Mode.
- **Document lifecycle.** Viewers of the same source share one loaded
  document. React StrictMode's double mount used to load bill-hr815 twice, and
  five remounts loaded it 12 times; both now load it once. Closing a viewer
  cancels its work, the document is destroyed a second after the last viewer
  goes, and work that outlives a closed viewer no longer raises "Transport
  destroyed" as unhandled rejections.
  [`check-lifecycle.ts`](examples/prototype/scripts/check-lifecycle.ts)
  verifies this in all three browsers.
- **Browser notes.** WebKit has neither `requestIdleCallback` nor
  `scheduler.yield`, so idle work falls back to timers. On a second visit in
  the same browser context, WebKit refused pdf.js's module worker scripts in
  the cross-origin-isolated demo, apparently when taken from its cache, and
  pdf.js silently parsed on the main thread; the same happens to the renderer
  worker of a document reopened in the same page. The demo isolates itself
  only for precise timers. Mouse selection in WebKit 27.2 ignores unprefixed
  `user-select`, so the viewer CSS also declares `-webkit-user-select`, as
  pdf.js's does. Over space without text, WebKit and Firefox put the end of a
  drag selection at the start of the page or gap under the pointer, so
  during a drag ParaPDF holds the selection over gaps and sends a page's
  blank space to the page boundary: drags between pages no longer jump to the
  start or end of a page. pdf.js's own viewer still selects the whole page
  above when a drag enters it from below in WebKit and Firefox.
- **Not yet built.** Form filling, structure-tree semantics for tagged PDFs,
  text for pages outside the mounted window, and region rendering beyond the
  16 MP detail cap.

## License

[MIT](LICENSE)
