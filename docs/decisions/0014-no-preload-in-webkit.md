# 0014. No PDF preload in WebKit browsers

- Status: adopted
- Date: 2026-10-28

## Context

`PdfDocument` preloads a URL source with React's `preload(url, { as:
"fetch" })` in the CORS mode of pdf.js's request, so that the download
starts before pdf.js has loaded, and from the page's head when it is
rendered on the server. Chromium and Firefox give pdf.js's fetch that
download. Issue #14 asked whether Safari does.

## Decision

A provider rendered in a WebKit browser does not preload its source:
`documentRequestMode()` returns null for a user agent with `AppleWebKit/`
and without `Chrome/` or `Chromium/`, which covers Safari and every browser
on iOS and iPadOS. Headless Chromium identifies itself as `HeadlessChrome/`
and is preloaded too. A page rendered on the server keeps the preload, since
the server cannot tell the browser (target.md, "Server rendering").

## Evidence

`examples/prototype/scripts/preload-timing.ts`, which needs neither ParaPDF
nor pdf.js, preloads a 300,000-byte file its server sends over a second and
fetches it after a delay with pdf.js's fetch options (results in
`examples/prototype/results/safari-macos.md`): Safari 27.0.1 makes a second
request for a fetch after 0, 50, 300, or 700 ms and takes the preload only
at 1500 ms, once it has finished. Playwright's WebKit 27.2 never takes it;
Firefox 157.0 and Chromium 156 always do.

`examples/prototype/scripts/preload-reuse.ts`, the demo with bill-hr815.pdf
(360,076 bytes) at 1 MB/s shared by the PDF's responses, before and after
the change, three runs each, job by job
(`examples/prototype/results/preload-webkit.md`):

| Browser, no-cache | Requests, before → after | Bytes, before → after | First page, before | First page, after |
| --- | --- | --- | --- | --- |
| Safari 27.0.1, cold | 2 → 1 | 720,152 → 360,076 | 1140, 1270, 1111 ms | 2636, 779, 667 ms |
| Safari 27.0.1, warm | 2 → 1 | 360,076 → 0 (a 304) | 452, 271, 284 ms | 292, 331, 214 ms |
| WebKit 27.2, cold | 2 → 1 | 720,152 → 360,076 | 1264, 1220, 1221 ms | 987, 927, 950 ms |
| WebKit 27.2, warm | 2 → 1 | 720,152 → 360,076 | 945, 892, 904 ms | 636, 578, 616 ms |
| Chromium 156, cold | 1 → 1 | 360,076 → 360,076 | 620, 603, 604 ms | 552, 633, 622 ms |

Without the preload, Safari and WebKit download the PDF once, and the first
page comes 20 to 35% sooner by the medians (Safari cold 1140 → 779 ms,
WebKit cold 1221 → 950 ms, WebKit warm 904 → 616 ms): the two downloads no
longer share the network. One job lost, Safari's first cold one after the
change (2636 ms); its other two are the fastest cold ones of all. Chromium
does not change.

Headless Chromium was mistakenly classified as WebKit because the `Chrome/`
token in `HeadlessChrome/` has no word boundary before it. After correcting
the detection, `scroll-bench.ts` compared the fix and the preceding build in
alternating jobs on Chromium 156, macOS, AC power, seven runs
(`examples/prototype/results/headless-chrome-preload{,-throttled}-chromium.md`).
With 100 ms latency and 20 Mbit/s, median first paint improved from 993 to
893 ms for bill-hr815.pdf and from 985 to 879 ms for f1040.pdf. On
localhost it changed from 141 to 152 ms, 180 to 178 ms, and 213 to 214 ms
for bill-hr815.pdf, synthetic-text-1000.pdf, and f1040.pdf respectively.
The first localhost result is 11 ms slower; these measurements do not
establish why. The change affects headless Chromium, not headed Chrome.

## Consequences

- In WebKit browsers the download starts once pdf.js has loaded rather than
  as the provider renders; on a slow network that costs the time pdf.js
  takes to load, which the second download cost more than.
- A page rendered on the server still downloads a PDF twice in Safari when
  it takes longer to download than pdf.js to load. The site's limitations
  say so.
- The check is a user-agent test, the only signal the difference has; a
  browser that hides WebKit's token is preloaded as before.

## Reopen if

Safari gives a fetch a preload still downloading (`preload-timing.ts`
counts one request at every delay), or a server-side way to leave the
preload out for WebKit browsers is wanted, say from the request's
`User-Agent`.
