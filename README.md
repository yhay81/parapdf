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

One machine (Apple M2 Pro, headless Chromium 156 on the Metal GPU), 14 PDFs,
median of three runs; details in
[`bench/results/latest.md`](bench/results/latest.md). Mobile, Safari, and
Firefox are not measured yet.

- **Payload.** Released pdf.js is 404 KiB brotli; PDFium is 1,645 KiB and
  hayro 1,364 KiB.
- **Non-embedded Japanese fonts.** Only pdf.js draws them, through the
  operating system's fonts. PDFium and hayro need shipped fallback fonts.
- **Main thread.** On f1040, nics, the CJK page, and the vector page, released
  pdf.js reaches a 95th-percentile event-loop lag of 14–33 ms while it draws.
  pdf.js master with its renderer worker stays at 1.1–4.5 ms. Image-heavy scans
  (patent, bunka) still block the main thread on master: an upstream
  investigation candidate.
- **Speed.** The WebAssembly engines commit text pages first (40–49 ms versus
  54–96 ms for pdf.js). hayro is fastest on the large scan (44 ms). pdf.js is
  fastest on 200,000 vector segments (68–70 ms versus 223 ms for hayro and
  374 ms for PDFium).
- **Fidelity.** Released pdf.js 6.4.299 fails a JPEG 2000 image behind LZW that
  master fixes. Every pdf.js build differs from PDFium's reference rendering of
  a soft-mask blend fixture, which PDFium and hayro match.
- **Direction.** Keep pdf.js with the renderer worker as the default engine for
  its size, CJK coverage, and vector speed. Keep hayro as a research backend for
  scans and transparency fidelity.

### Runtime prototype (2026-10-18)

[`packages/parapdf`](packages/parapdf) implements the React-first runtime on
the pdf.js core API. [`examples/prototype`](examples/prototype) measures it
with a scripted scroll at devicePixelRatio 2; details in
[`examples/prototype/results/latest.md`](examples/prototype/results/latest.md).

- **React stays out of the hot path.** Scrolling across 7–9 pages over 241
  frames caused 20–24 React commits, one batch per change of the mounted
  window or the current page.
- **No blank pages.** At 900 and 3,600 CSS pixels per second, low-resolution
  base renders stayed ahead of the viewport; full-resolution renders waited
  until scrolling settled.
- **Main thread.** With full-resolution renders running during slow scrolling,
  pdf.js master's renderer worker on a GPU-backed canvas kept main-thread
  blocking at 0–2 ms. Released pdf.js on its default CPU canvas reached
  64–91 ms, with single stalls of 40–58 ms.
- **Startup.** Starting the PDF download with React's `preload()` moved first
  paint of bill-hr815 from 800 to 684 ms on released pdf.js and from 619 to
  503 ms with the renderer worker (median of five runs; see
  [`startup-preload.md`](examples/prototype/results/startup-preload.md) and
  [`startup-no-preload.md`](examples/prototype/results/startup-no-preload.md)).
- **Text, search, and accessibility.** pdf.js text layers make pages
  selectable and readable by screen readers; whole-document search normalizes
  full-width characters and case, and paints results with the CSS Custom
  Highlight API without touching the text layer DOM. Pages are labelled
  regions and the viewport is a focusable document.
  [`check-text.ts`](examples/prototype/scripts/check-text.ts) verifies
  selection, search, Japanese and full-width matching, and these semantics.
- **Text layer cost.** Text layers are built only after scrolling settles, one
  page per idle period. With the renderer worker on a GPU-backed canvas,
  slow scrolling blocked the main thread for 0–1 ms with text layers versus
  0 ms without; fast scrolling builds none.
- **Not yet built.** Annotation layer, structure-tree semantics for tagged
  PDFs, text for pages outside the mounted window, and region rendering beyond
  the 16 MP detail cap.

## License

[MIT](LICENSE)
