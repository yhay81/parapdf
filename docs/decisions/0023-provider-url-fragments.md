# 0023. URL open parameters belong to the provider

- Status: adopted
- Date: 2026-10-29

## Context

Decision 0019 takes the URL open parameters that pdf.js's viewer reads.
A fragment identifies a view of a document, while the request URL,
headers, and credentials identify the document itself. Sharing the latter
must not make providers share the former.

## Decision

- Leave the fragment out of the registry key, `PdfSession.source`, and
  React's preload URL, including an empty trailing `#`. Each provider's
  `PdfSession` keeps its fragment in a store of its own.
- Read `page`, `zoom`, and `nameddest` in the initial-view feature, as
  pdf.js's `PDFLinkService.setHash()` reads them; its port is attributed
  in `NOTICE.md`. A missing named destination falls back to page and zoom.
  Unknown zoom names keep the zoom, including names inherited by ordinary
  JavaScript objects. `search`, `pagemode`, and parameterless fragments
  remain the application's.
- Apply `initialViewState` over the fragment, and the fragment over the
  document's opening and the page and zoom defaults. A later fragment
  navigates as a link does, without opening the document again.
- A viewer remembers the fragment it applied while its viewport is hidden.
  Its ready hook applies a newer one after reattachment or a renderer
  rebuild; an unchanged fragment keeps the restored position. These are
  feature-owned records, outside React state and the frame path.
- Each pending fragment move owns an abort controller, linked to the
  viewport's ready signal. A newer fragment or detachment aborts it.
  `Viewer.goToDestination(dest, signal?)` accepts an optional abort signal
  and commits neither view nor history after cancellation. The underlying
  pdf.js destination lookup may finish; its obsolete result is ignored.

## Evidence

Review reproduced malformed zoom names throwing, an empty `#` remaining
in the public source, a delayed named destination overwriting a newer
fragment, and a fragment changed while hidden being lost on reattachment.
Unit tests cover parsing, source normalization, provider ownership, and
the follower's cancellation and readiness. `check:document` covers rapid
updates and renderer rebuilds; `check:viewers` covers hidden viewports
and one document open. Both pass in Chromium, WebKit, and Firefox, with
561 Node unit tests passing.

Runtime 1532c65 was compared with `main` at 086accf in the same run, job
by job: `bill-hr815.pdf` at 900 CSS px/s, three runs, `FOCUS=1`, AC power,
`MAX_LOAD=8`, Apple M2 Pro, macOS 27.0.0. These runs use no fragment to
check the common path's added opening work; they do not measure the latency
of named-destination lookup or JavaScript heap. Reports and every job's
data are retained in `examples/prototype/results/url-fragment-*`.

| Browser | First paint, before → after | Blocked time over 4 s, before → after |
| --- | --- | --- |
| Chromium 156 | 202 → 183 ms | 50 → 50 ms |
| WebKit 27.2 | 221 → 224 ms | 88 → 98 ms |
| Firefox 157 | 223 → 219 ms | 88 → 96 ms |

- First-paint ranges overlap in each browser: Chromium 190–204 → 172–194
  ms, WebKit 217–224 → 183–292 ms, Firefox 221–227 → 218–240 ms. No speed
  improvement is claimed. The measured reading-time medians include up to
  10 ms more blocked time over four seconds; this cost is accepted for the
  URL navigation behavior.
- Every job had zero blank area. React-commit medians stayed at four,
  canvas-memory medians at 183 MiB, and dropped-frame medians at zero in
  Chromium and Firefox and nine in WebKit, in both builds.
- Start/end one-minute load averages ranged from 4.4 to 6.9. Chromium
  waited once, about 26 seconds, for another browser; no job overlapped
  another Playwright browser.
- In the same prototype build, the `PdfViewer` chunk grows from 119.44 to
  121.77 kB, gzip 36.69 → 37.58 kB. This is a chunk comparison, not the
  complete application payload.

To repeat, build each runtime into a separate directory and run
`BEFORE=<before> BEFORE_LABEL=086accf DIST=<after> VARIANTS=pdfjs
FILES=bill-hr815.pdf SPEEDS=900 FOCUS=1 RUNS=3 MAX_LOAD=8 BROWSER=<browser>
OUTPUT=url-fragment-<browser>`.

## Reopen if

The opening precedence needs another rule, URL changes fail to preserve
provider/viewer independence, or measurements establish a repeatable cost
beyond the recorded variation.
