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
  selectable and readable by screen readers; whole-document search normalizes
  full-width characters and case, and paints results with the CSS Custom
  Highlight API without touching the text layer DOM. Pages are labelled
  regions and the viewport is a focusable document.
  [`check-text.ts`](examples/prototype/scripts/check-text.ts) verifies
  selection, including a drag past a line's end, search, Japanese and
  full-width matching, and these semantics in all three browsers.
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
- **Browser notes.** WebKit has neither `requestIdleCallback` nor
  `scheduler.yield`, so idle work falls back to timers. On a second visit in
  the same browser context, WebKit refused pdf.js's module worker scripts in
  the cross-origin-isolated demo, apparently when taken from its cache, and
  pdf.js silently parsed on the main thread; the demo isolates itself only
  for precise timers. In WebKit, a drag selection across the gap between two
  pages still jumps to the end of the next page.
- **Not yet built.** Form filling, structure-tree semantics for tagged PDFs,
  text for pages outside the mounted window, and region rendering beyond the
  16 MP detail cap.

### Hybrid engine experiment (2026-10-18, measurement pending)

The engine benchmark found one clear WebAssembly win: hayro renders the three
scans faster than pdf.js master with its renderer worker in every browser and
without main-thread stalls, while pdf.js stays ahead on vector pages and is
the only engine that draws non-embedded Japanese fonts. The hybrid engine
(`?engine=hybrid` in the demo, `createHybridEngine` in the package) tests
whether a viewer can take that win per page; another engine replaces pdf.js
only after a reproducible win, so it stays an experiment.

- **Routing.** A classifier built from hayro's parser alone reads each page's
  content stream before its first render, without decoding images. Image-only
  pages render with hayro; everything else, and every page's text layer,
  links, and search, stays on pdf.js. OCR text in rendering mode 3 counts as
  invisible, so OCR'd scans such as the patent qualify. On the corpus, the
  three scans and the JPEG 2000 fixture go to hayro and every other page to
  pdf.js; see
  [`hybrid-classifier.md`](examples/prototype/results/hybrid-classifier.md).
- **Cost of classifying.** Natively, the median page costs 1–117 µs
  depending on the file (0.9 ms on `f1040.pdf`, whose 53 form fields are read
  first), and parsing a document 0.01–14 ms; the 200,000-segment vector page
  is never decoded because its content stream is over the 256 KiB limit. The
  in-browser cost, as WebAssembly in a worker, awaits the benchmark.
- **Payload.** 95 KiB brotli with every document (the classifier and the
  worker), 1,363 KiB more only once a document has an image-only page. Text
  documents never request the hayro module.
- **Behavior.** [`check-hybrid.ts`](examples/prototype/scripts/check-hybrid.ts)
  passes in Chromium, WebKit, and Firefox: routing, the lazy load, hayro's
  page 1 within 0.5–1.2 of 255 per channel of pdf.js's, OCR text search and
  selection on hayro-rendered pages, and zoom. `check-text.ts` and
  `check-links.ts` pass unchanged on the hybrid engine
  ([`hybrid-checks.md`](examples/prototype/results/hybrid-checks.md)).
- **Known costs.** The worker fetches the PDF again (from the HTTP cache when
  the response allows), the classifier and hayro parse it twice more, and
  hayro decodes a page's images for every render (base and detail), where
  pdf.js keeps decoded images between renders of a page.
- **Not measured yet.** First paint, full-resolution page 1, the main
  thread's longest stall, render times, and WebAssembly memory come from
  [`hybrid-bench.ts`](examples/prototype/scripts/hybrid-bench.ts), which runs
  only while no other Playwright browser is open and the load average is at
  most half the logical cores. Neither held on 2026-10-18 (load average
  14–145 on 12 cores, and another session's WebKit run open for hours).
  Firefox numbers from the demo also need its device pixel ratio fixed first:
  Playwright's Firefox ignores `deviceScaleFactor` on cross-origin-isolated
  pages and renders the demo at devicePixelRatio 1.

## License

[MIT](LICENSE)
