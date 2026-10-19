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
- **Firefox.** These Firefox runs rendered at devicePixelRatio 1, not 2:
  Playwright's Firefox drops the scale factor in cross-origin-isolated pages,
  which the scripts now work around, so they are not comparable with the other
  browsers until rerun. In them, every variant blocked for 25–96 ms, with
  stalls of 7–14 ms, the renderer worker on a GPU-backed canvas included
  (31–51 ms), while scrolling already rendered pages with nothing new to
  render blocked for 2–42 ms (median 5; see
  [`control.md`](examples/prototype/results/control.md)).
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
  selection, including drags past a line's end, across the gap between two
  pages in both directions, quickly and in 1 px steps, and from beside or
  between pages, search,
  Japanese, full-width, diacritic, and line-break matching, and these
  semantics in all three browsers.
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
  above when a drag enters it from below in WebKit and Firefox. Chromium sent
  a drag over the space beside a page to that page's start, and all three
  browsers started a drag pressed beside or between pages at the start of the
  first mounted page: 3,357 characters where the dragged line holds 49. Drags
  now hold beside a page too, and a drag pressed there starts at the nearest
  text. A page's box, rounded to whole pixels, can be a pixel wider and taller
  than its text layer, which pdf.js rounds down, and Chromium and WebKit sent
  a slow drag over that pixel to the page's start; during a drag only text
  layers are selectable now. In Firefox, re-inserting a text layer's
  `.endOfContent` at every selection change, as pdf.js does, made a quick drag
  into the page above select all of it; ParaPDF leaves the element in place.
- **High zoom.** Pages whose full-resolution render exceeds 16 MP now get
  detail only for the visible area plus a margin, as pdf.js's viewer does,
  and base canvases stop at 2 MP. At 4 and 8 CSS pixels per point on
  bill-hr815, the visible pages used to stay at 0.19–0.58 of full resolution
  while canvases held 228–335 MiB; they now reach full resolution with 66–88
  MiB, in Chromium, WebKit, and Firefox alike (see
  [`zoom-baseline.md`](examples/prototype/results/zoom-baseline.md) and
  [`zoom-chromium.md`](examples/prototype/results/zoom-chromium.md)). Full
  resolution arrived 29–77 ms after zooming in Chromium, 81–144 ms in WebKit,
  and 114–491 ms in Firefox, but other work kept the machine's load average
  near 400 during these runs, so the times are only indicative. The zoom now
  goes up to 10 CSS pixels per point.
- **Rotation and the document escape hatch.** The view turns pages in
  quarter turns: page boxes swap, pages render turned, and text layers,
  links, overlays, search highlights, and link jumps follow.
  [`check-rotation.ts`](examples/prototype/scripts/check-rotation.ts) verifies
  them in all three browsers. `usePdfDocument()` exposes the open document,
  and `pdfjsDocumentOf()` turns it into pdf.js's `PDFDocumentProxy` for the
  APIs ParaPDF does not wrap.
- **Embedding options (2026-10-20).** Trying the runtime as the PDF preview
  of a web app that shows uploaded drawings and documents showed what such an
  app needs; [`check-options.ts`](examples/prototype/scripts/check-options.ts)
  verifies all of it in Chromium, WebKit, and Firefox. "fit-width" now keeps
  fitting as the viewport resizes or turns instead of applying once. Pages of
  mixed sizes are centered in the viewport, not in the widest page, which had
  pushed the A4 pages of a document with one A3 sheet 173 CSS pixels right
  and cut 149 pixels off them. `maxDetailPixels`, `maxBasePixels`, and
  `maxCanvasPixels` bound canvas memory, the last for all of a viewer's
  canvases (a 24-page document held 93 MiB at 200%). Links to other
  documents can stay inert, and `documentOptions` passes getDocument
  parameters such as `canvasMaxAreaInBytes` through. A small visible page now
  draws its first pixels in one render, before its text layer: on
  synthetic-vector-200k in Chromium at devicePixelRatio 2 (released pdf.js,
  median of nine runs), the first pixels came at 440 instead of 474 ms and
  the sharp page at 456 instead of 515 ms. `pnpm --filter parapdf pack`
  builds a package from `dist/` with the notices pdf.js's license requires.
- **Pinch zoom (2026-10-20).** Only ctrl or meta with the wheel zoomed the
  document, which covers trackpad pinches in Chromium and Firefox. A touch
  pinch, or a trackpad pinch in Safari, zoomed the whole page instead and left
  the PDF stretched at its old resolution: in Chromium emulating a tablet, a
  pinch of 2 set the page's visual viewport to 2. Two touches now zoom the
  document around the point between them and pan with it while the page stays
  at 1, one finger still scrolls natively, and Safari's gesture events zoom
  the document instead of the page.
  [`check-pinch.ts`](examples/prototype/scripts/check-pinch.ts) verifies this
  in Chromium with touches the DevTools protocol feeds through the browser's
  own input handling, and with dispatched events in WebKit and Firefox;
  Safari and iPadOS themselves are not verified yet. Zooming also keeps its
  anchor on the same point of its page sideways now: one "Zoom in" on an A5
  page beside a wider landscape sheet used to move the viewport's center from
  half the page's width to 0.64 of it.
- **Zoom cost.** Against a React wrapper of pdf.js's own viewer
  (`PDFViewer`), measured in another project's harness, the main thread was
  1.4–5.6 times busier while zooming.
  [`main-thread-bench.ts`](examples/prototype/scripts/main-thread-bench.ts)
  traced it in Chromium. Zooming did not redraw base canvases: four 1.25×
  steps on bill-hr815 rendered six detail canvases and no base. The text
  layers were the cost. Every step changed `--total-scale-factor` on every
  mounted page, and Chromium recomputed style for all their runs and laid
  them out again: 20 ms of style and 12 ms of layout over the four steps with
  the renderer worker, while all JavaScript, pdf.js's re-measuring in
  `TextLayer.update` included, took 5 ms. Text layers now keep the zoom they
  were laid out for and follow later zooms with a CSS `scale`. A visible page
  is laid out again only after zooming in past twice that zoom, because
  Chromium places runs laid out small up to 2.4 points off where 4 CSS pixels
  per point gives 0.04. The four steps then took 35 instead of 64 ms of
  main-thread time with the renderer worker and 155 instead of 180 ms with
  released pdf.js; one 2× step from 100% at devicePixelRatio 1, the setting
  of that comparison, took 10 instead of 20 ms and 31 instead of 46 ms (see
  [`main-thread-before.md`](examples/prototype/results/main-thread-before.md),
  [`main-thread.md`](examples/prototype/results/main-thread.md),
  [`main-thread-dpr1-before.md`](examples/prototype/results/main-thread-dpr1-before.md),
  and [`main-thread-dpr1.md`](examples/prototype/results/main-thread-dpr1.md)).
  [`check-text.ts`](examples/prototype/scripts/check-text.ts) verifies that
  runs stay on their glyphs after a 3× zoom. With released pdf.js, most of
  what remains is pdf.js drawing on the main thread. The profile put most of
  it in `drawImage` calls of pdf.js's knockout-group compositing on page 1
  of bill-hr815, but a closer look found that the first of them mostly
  flushes the drawing Chromium has recorded on the GPU canvas, which
  presenting the canvas would do anyway; that flush took 16.8 ms for a
  5000×3360 detail canvas at 8 device pixels per point and 0.9 ms for the
  whole page at 4. `content-visibility: auto` on text layers
  saved another 5–8 ms over the four steps but was dropped, because Firefox
  then copies off-screen text layers as blank lines.
- **Slow-scroll cost.** The same comparison found slow scrolling up to 2.6
  times busier. Every page that slow scrolling brought into the mounted
  window got a base render and then a detail render; once scrolling settles,
  it now gets only the detail. Base renders fell from 4 to 0 at 1,200 CSS
  pixels per second for 3 seconds at devicePixelRatio 1, and from 2 to 0 at
  900 for 4 seconds at devicePixelRatio 2. Released pdf.js, which draws on
  the main thread, then spent 110 ms of main-thread time where it spent 120
  ms before and 136 ms in this build without the skip, and 68 ms where it
  spent 76 and 107: savings about as large as the variation between runs.
  With the renderer worker, which draws off the main thread, the times
  stayed within noise. A skipped base is drawn once a page needs one: in the
  four-step zoom, two pages outside the viewport needed theirs when region
  rendering dropped their detail, so the work moved rather than grew (155
  against 152 ms with released pdf.js; see
  [`main-thread-no-base-skip.md`](examples/prototype/results/main-thread-no-base-skip.md)
  and
  [`main-thread-dpr1-no-base-skip.md`](examples/prototype/results/main-thread-dpr1-no-base-skip.md)).
  The scroll benchmark still found no blank area at 900 and 3,600 CSS pixels
  per second on bill-hr815 and synthetic-text-1000, before and after (see
  [`scroll-skip-base-before.md`](examples/prototype/results/scroll-skip-base-before.md)
  and [`scroll-skip-base.md`](examples/prototype/results/scroll-skip-base.md)).
  The main-thread runs in this and the previous item took turns with the
  other Playwright browsers on the machine: the first waited 58 minutes for
  them, no job overlapped one, and the one-minute load average stayed
  between 5 and 7 on 12 cores.
- **Firefox text runs.** In Firefox, text layer runs on bill-hr815 came out
  12–15% narrower than the glyphs they cover, at every zoom and up to 49
  points short on page 1, so the end of a selection fell short of the glyphs.
  pdf.js measures each run on a canvas whose `lang` is the PDF's language, and
  for a PDF that declares none, like this one, that `lang` is empty: an
  unknown language. Generic fonts resolve by language, and Firefox resolves an
  unknown one to the system's (Japanese on this machine, where `serif` is 18%
  wider), while the runs follow the page's `lang="en"`. Chromium and WebKit
  resolve it to their default fonts instead, which matched on this English
  page but not on a Japanese one: under `lang="ja"` they drew the runs 14–18%
  too wide. The pdf.js adapter now measures in the language the runs are
  drawn in: the text content and the text layer both take the PDF's language
  or, when it declares none, the one the layer inherits from the page. Runs
  now end within 0.4 points of their glyphs in Firefox, 1.6 in Chromium, and
  0.04 in WebKit, on English and Japanese pages, and
  [`check-text.ts`](examples/prototype/scripts/check-text.ts) asserts it. A
  PDF that declares its language now has its text announced in it: the MHLW
  notice in Japanese on the English demo page. pdf.js's own viewer measures
  the same way and misplaces runs of PDFs without a language on a page whose
  `lang` resolves apart from an unknown one, Firefox's built-in viewer
  included when its UI language differs from the system's; not reported
  upstream yet.
- **Not yet built.** Form filling, structure-tree semantics for tagged PDFs,
  and text for pages outside the mounted window.

## License

[MIT](LICENSE)
