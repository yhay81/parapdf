# 0023. URL open parameters belong to the provider

- Status: adopted
- Date: 2026-10-29

## Decision

A URL's fragment identifies a view of a document; the request URL, headers,
and credentials identify the document. Providers that share a document must
not share a view.

- The fragment, an empty trailing `#` included, is left out of the registry
  key, `PdfSession.source`, and React's preload URL. Each provider's
  `PdfSession` keeps its fragment in a store of its own.
- The initial-view feature reads `page`, `zoom`, and `nameddest` as pdf.js's
  `PDFLinkService.setHash()` does (attributed in `NOTICE.md`). A missing
  named destination falls back to page and zoom; unknown zoom names keep the
  zoom. `search`, `pagemode`, and parameterless fragments are the
  application's.
- Precedence: `initialViewState` over the fragment, the fragment over the
  document's opening and the page and zoom defaults. A later fragment
  navigates as a link does, without opening the document again.
- A viewer remembers the fragment it applied while its viewport is hidden,
  and applies a newer one when it is ready again. Each pending move owns an
  abort controller; `Viewer.goToDestination(dest, signal?)` commits neither
  view nor history once aborted.

## Evidence

Unit tests cover parsing, source normalization, provider ownership, and
cancellation; `check:document` and `check:viewers` cover rapid updates,
renderer rebuilds, and hidden viewports. Against the build before,
bill-hr815.pdf at 900 CSS px/s, three runs, no fragment
([`url-fragment-chromium.md`](../../examples/prototype/results/url-fragment-chromium.md),
[`-webkit`](../../examples/prototype/results/url-fragment-webkit.md),
[`-firefox`](../../examples/prototype/results/url-fragment-firefox.md)):
first-paint ranges overlapped in every browser, and median blocked time rose
by up to 10 ms over four seconds, accepted for the behavior.

## Reopen if

The opening precedence needs another rule, URL changes fail to keep
providers and viewers independent, or measurements establish a repeatable
cost.
