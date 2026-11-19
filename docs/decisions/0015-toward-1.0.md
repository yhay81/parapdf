# 0015. What 1.0 requires, and what 1.x promises

- Status: adopted
- Date: 2026-11-19

## Decision

No date is promised (#33). 1.0 ships once the remaining blocker holds and every
check passes in Chromium, WebKit, Firefox, and Safari.

### Blockers

- **Safari and real iOS/iPadOS devices** (#13): the functional checks pass in
  Safari on macOS (`BROWSER=safari`, up to the parts `safaridriver` cannot
  drive; [`safari-macos.md`](../../examples/prototype/results/safari-macos.md)),
  and the reading, touch (including #15), annotation (including #1), VoiceOver,
  and save paths are tried on a real iPhone and iPad, with the results
  published. This includes whether iOS Safari counts kept canvases toward its
  canvas memory cap, which sets `maxKeptPixels`'s default and decides whether
  phone-sized viewports reopen decision 0008.

Gaps found there are fixed or become documented limitations with an issue each.

### Settled before 1.0

- **Screen readers** (#32): reading, links, forms, search, and page changes
  were tried with VoiceOver in Safari on macOS and NVDA in Firefox on Windows,
  with the results published
  ([`voiceover-safari-macos.md`](../../examples/prototype/results/voiceover-safari-macos.md),
  [`nvda-firefox-windows.md`](../../examples/prototype/results/nvda-firefox-windows.md))
  and the focus and naming gaps fixed (decisions 0021 and 0031).
- **CI browsers and bundler checks** (#30, #31): CI runs every functional check
  in Chromium, WebKit, and Firefox with `ENGINE=pdfjs`, and `check:bundle` and
  `check:bundlers` verify packaged assets across Vite, webpack, Rsbuild, and
  Next.js (Turbopack and webpack).

### Feature backlog and non-blockers

Against `docs/architecture.md` and the domain-neutral rule:

- **Required for 1.0 (shipped in 0.x)**: editing annotations stored in a PDF of
  the kinds pdf.js's editor supports (#4), comments on annotations created by
  the reader (#5), application-controlled alternative text of image annotations
  (#6), and right-to-left page order from viewer preferences (#9).
- **Optional (shipped in 0.x)**: scripted AcroForm calculations, validation,
  and button actions (#7, `<PdfForms scripts />`, off by default, decision
  0016), and pdf.js's renderer worker (#20, `configurePdfjs({ rendererSrc:
  true })`, off by default, decision 0028; changing the default in 1.x is a
  minor release when the option contract holds).
- **Deferred past 1.0**: viewers of one session showing each other's
  in-progress annotation edits as they happen (adds behavior without changing
  the API; `useSave()` and `usePrint()` include every shown viewer's edits).
- **Not planned**: XFA forms (#8 — pdf.js supports XFA only in part and at high
  cost), search highlights without the CSS Custom Highlight API (#11 — every
  supported browser implements it), and DOM text layers for pages outside the
  mounted window (#10 — rejected by decision 0049; `useSearch()`, `findText()`,
  and `getText()` cover whole-document and multi-page text).

### What 1.x promises

From 1.0, ParaPDF follows semantic versioning over its public API, and this
record replaces decision 0002.

- Covered: the exports of `parapdf` and `parapdf/legacy` and their types;
  the documented components, props, options, hooks, methods, and callbacks;
  the files the package ships at their documented paths (`pdfjs/`, for
  `assetBase`); and the behavior the functional checks assert.
- Not covered: pixels, timing, memory use, and the order of requests; the
  DOM beyond the documented class names and attributes; anything not
  exported; and the pdf.js objects the API hands out (`PDFDocumentProxy`,
  `PDFPageProxy`), whose types are pdf.js's.
- A break needs a major release; a deprecation lasts at least one minor
  release before the major that removes it.
- A `pdfjs-dist` upgrade is a minor release when ParaPDF's covered API does not
  change, with the pdf.js version and its behavior changes in `CHANGELOG.md`;
  a major when it would break a covered part of the API.
- Security fixes go to the latest minor of the latest major; the last minor
  of the previous major gets pdf.js security updates for six months.
  `SECURITY.md` takes this policy at 1.0.

## Evidence

Direction set by the maintainer (#33). The remaining blocker is where automated
checks cannot speak for the user: CI runs Playwright's WebKit, which is not
Safari, and real iPhone and iPad behavior and canvas memory limits need physical
devices (#13).

## Reopen if

A blocker turns out to need a device or tool nobody has access to, or a
pdf.js release changes the API ParaPDF hands out.
