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
on iOS and iPadOS. A page rendered on the server keeps the preload, since
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
