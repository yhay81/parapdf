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

### Hybrid engine experiment (2026-10-19)

The engine benchmark found one clear WebAssembly win: hayro renders the three
scans faster than pdf.js master with its renderer worker in every browser and
without main-thread stalls, while pdf.js stays ahead on vector pages and is
the only engine that draws non-embedded Japanese fonts. The hybrid engine
(`?engine=hybrid` in the demo, `createHybridEngine` in the package) takes that
win per page. Another engine replaces pdf.js only after a reproducible win, so
this stays an experiment behind an option.

[`hybrid-bench.ts`](examples/prototype/scripts/hybrid-bench.ts) compares it
with pdf.js master's renderer worker on a GPU-backed canvas in the demo, ten
cold page loads per document and browser (five at each of two scroll speeds),
alternating which engine goes first; jobs started only on AC power, with no
other Playwright browser open and a 1-minute load average of at most 6 on 12
cores (medians 3.6–5.4). Summary in
[`hybrid.md`](examples/prototype/results/hybrid.md), details in
[`hybrid-chromium.md`](examples/prototype/results/hybrid-chromium.md),
[`hybrid-webkit.md`](examples/prototype/results/hybrid-webkit.md), and
[`hybrid-firefox.md`](examples/prototype/results/hybrid-firefox.md). Firefox
ran at devicePixelRatio 1 (Playwright's Firefox ignores `deviceScaleFactor`
on cross-origin-isolated pages), so compare its two engines with each other
only.

- **First page.** On the three scans, page 1 shows pixels 9–124 ms sooner
  (bunka 501 → 403 ms in Chromium, 535 → 411 in WebKit, 486 → 403 in
  Firefox; patent 480 → 401, 498 → 408, 468 → 407). hayro draws the
  low-resolution base layer in 46–70 ms where pdf.js needs 72–176 ms,
  because pdf.js decodes the image before its first render.
- **Main thread.** The longest startup stall on bunka and the patent drops
  from 46–50 ms to 6.5–12 ms in Chromium and from 29–32 to 14–15 ms in WebKit
  (whose idle timers already run about 6 ms late); Firefox goes from about
  10 to 6.5–8 ms. Scrolling the patent at 900 px/s blocks the main thread for
  5 instead of 26 ms in Chromium (longest stall 6 instead of 28 ms), and 19
  instead of 27 ms in Firefox; WebKit stays at 27–28 ms.
- **Losses.** hayro decodes a page's images again for every render, while
  pdf.js reuses them, so hayro's full-resolution renders take 30–92 ms against
  10–49 ms. On the manuscript (JBIG2 and JPEG images), page 1 becomes sharp
  47 ms later in Chromium and 36 ms later in Firefox, and about the same in
  WebKit. hayro's WebAssembly memory grows to 51–103 MiB at devicePixelRatio 2
  (27–35 MiB in Firefox at 1) and does not shrink; the classifier uses
  1.3–1.7 MiB. The worker fetches the PDF again (from the HTTP cache when the
  response allows), and the classifier and hayro parse it twice more.
- **Text pages do not regress.** On bill-hr815, every page stays on pdf.js
  and the hayro module never loads. First paint (406 → 398 ms in Chromium,
  439 → 448 in WebKit, 417 → 416 in Firefox), render times, and stalls stay
  within run-to-run noise. The worker has fetched and parsed the PDF 341–351
  ms after navigation, 3–11 ms before pdf.js asks for page 1, so each page's
  first render waits only for one round trip to the worker: 1.4–1.8 ms
  (median) on bill-hr815, of which classifying the page takes 0.2 ms
  (0.0–0.9 ms on the other documents).
- **Payload.** 95 KiB brotli with every document (the classifier and the
  worker), 1,363 KiB more only once a document has an image-only page; the
  hayro module then loads and compiles in 13–33 ms from a local server.
- **Routing.** A classifier built from hayro's parser alone reads each page's
  content stream before its first render, without decoding images. Image-only
  pages render with hayro; everything else, and every page's text layer,
  links, and search, stays on pdf.js. OCR text in rendering mode 3 counts as
  invisible, so OCR'd scans such as the patent qualify. On the corpus, the
  three scans and the JPEG 2000 fixture go to hayro and every other page to
  pdf.js; natively a page costs 1–117 µs (median per file), and the
  200,000-segment vector page is never decoded because its content stream is
  over the 256 KiB limit; see
  [`hybrid-classifier.md`](examples/prototype/results/hybrid-classifier.md).
- **Behavior.** [`check-hybrid.ts`](examples/prototype/scripts/check-hybrid.ts)
  passes in Chromium, WebKit, and Firefox: routing, the lazy load, hayro's
  page 1 within 0.5–1.2 of 255 per channel of pdf.js's, OCR text search and
  selection on hayro-rendered pages, and zoom. `check-text.ts` and
  `check-links.ts` pass unchanged on the hybrid engine
  ([`hybrid-checks.md`](examples/prototype/results/hybrid-checks.md)).
- **Next.** A decoded-image cache in hayro (or rendering the detail layer
  once and deriving the base from it) would remove the sharpening loss; a
  measurement in Safari itself and on a real network, where the 1.36 MiB
  hayro download counts, would decide whether the first-page win survives
  outside this machine.

## License

[MIT](LICENSE)
