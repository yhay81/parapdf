# 0014. No PDF preload in WebKit browsers

- Status: adopted
- Date: 2026-10-28

## Decision

`PdfDocument` preloads a URL source with React's `preload(url, { as:
"fetch" })`, so the download starts before pdf.js has loaded. In a WebKit
browser it does not: `documentRequestMode()` returns null for a user agent
with `AppleWebKit/` and without `Chrome/` or `Chromium/`, which covers Safari
and every browser on iOS and iPadOS (headless Chromium's `HeadlessChrome/`
counts as Chromium). WebKit gives a fetch a preload only once it has
finished downloading, so the preload downloaded the PDF twice.

A page rendered on the server keeps the preload, since the server cannot
tell the browser; such a page can still download a PDF twice in Safari.

## Evidence

- `preload-timing.ts`: Safari 27.0.1 makes a second request for a fetch
  0 to 700 ms after the preload and takes it only once it has finished;
  Playwright's WebKit never takes it; Chromium and Firefox always do
  ([`safari-macos.md`](../../examples/prototype/results/safari-macos.md)).
- `preload-reuse.ts`, the demo with bill-hr815.pdf at 1 MB/s, three runs
  ([`preload-webkit.md`](../../examples/prototype/results/preload-webkit.md)):
  without the preload Safari and WebKit download the PDF once instead of
  twice, and the first page comes 20 to 35% sooner by the medians (Safari
  cold 1140 → 779 ms, WebKit cold 1221 → 950 ms). Chromium does not change.

## Reopen if

Safari gives a fetch a preload still downloading (`preload-timing.ts`
counts one request at every delay), or a server-side way to leave the
preload out for WebKit browsers is wanted.
