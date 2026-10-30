# 0015. What 1.0 requires, and what 1.x promises

- Status: proposed
- Date: 2026-10-28

## Decision

No date is promised (#33). 1.0 ships once the blockers hold and every check
passes in Chromium, WebKit, Firefox, and Safari.

### Blockers

- **Safari** (#13): the functional checks pass in Safari on macOS
  (`BROWSER=safari`, up to the parts safaridriver cannot drive), and the
  reading, touch, annotation, and save paths are tried on a real iPhone and
  iPad, with the results published. This includes whether iOS Safari counts
  kept canvases toward its canvas memory cap, which sets `maxKeptPixels`'s
  default.
- **Screen readers** (#32): reading, links, forms, search, and page changes
  are tried with VoiceOver in Safari and NVDA in Firefox, with the results
  published. A failure that needs an API change is fixed before 1.0.

Gaps found there are fixed or become documented limitations with an issue
each.

### Not blockers

- **pdf.js's renderer worker** (#20): adopting it adds an option or changes
  where drawing happens, which 1.x allows in a minor release. If it would
  need a break and a pdf.js release has it before 1.0, it is done before.
- **Whole-document find with virtualized pages** (#10) and viewers showing
  each other's edits as they happen: they add behavior, not API.
- **XFA forms** (#8) and **search highlights without the CSS Custom
  Highlight API** (#11): not planned. pdf.js supports XFA only in part, at a
  high cost; every browser ParaPDF supports has the Highlight API.

### What 1.x promises

From 1.0, ParaPDF follows semantic versioning over its public API, and this
record replaces decision 0002.

- Covered: the exports of `parapdf` and `parapdf/legacy` and their types;
  the documented props, options, hooks, methods, and events; the files the
  package ships at their documented paths (`pdfjs/`, for `assetBase`); and
  the behavior the functional checks assert.
- Not covered: pixels, timing, memory use, and the order of requests; the
  DOM beyond the documented class names and attributes; anything not
  exported; and the pdf.js objects the API hands out, whose types are
  pdf.js's.
- A break needs a major release; a deprecation lasts at least one minor
  release before the major that removes it.
- A pdfjs-dist upgrade is a minor release when ParaPDF's API does not
  change, with the pdf.js version and its behavior changes in
  `CHANGELOG.md`; a major when it would break a covered part of the API.
- Security fixes go to the latest minor of the latest major; the last minor
  of the previous major gets pdf.js security updates for six months.
  `SECURITY.md` takes this policy at 1.0.

## Evidence

None measured: a direction the maintainer sets. The blockers are where the
checks cannot speak for the user: CI runs Playwright's WebKit, which is not
Safari, and no check hears what a screen reader announces.

## Reopen if

A blocker turns out to need a device or tool nobody has access to, or a
pdf.js release changes the API ParaPDF hands out.
