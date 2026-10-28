# 0015. What 1.0 requires, and what 1.x promises

- Status: proposed
- Date: 2026-10-28

## Context

The rebuild was released as 0.5.0, and 0.x says its API may change in any
minor release (decision 0002). Issue #33 asks what has to hold before
ParaPDF promises a stable API, what that promise covers, and where each
open feature issue stands against it. No date is promised.

## Decision

### Blockers

1.0 waits for these, each tracked by its issue:

- **Safari** (#13): the functional checks pass in Safari on macOS
  (`BROWSER=safari`, up to the parts safaridriver cannot drive), and the
  reading, touch, annotation, and save paths are tried on a real iPhone and
  iPad, with the results published. Gaps found there either get fixed or
  become documented limitations with an issue each.
- **Screen readers** (#32): reading, links, forms, search, and page changes
  are tried with VoiceOver in Safari and NVDA in Firefox, with the results
  published. A failure that needs an API change is fixed before 1.0; the
  others become issues.
- **The kept canvases on iOS** (`maxKeptPixels`): a real device shows
  whether iOS Safari counts them toward its canvas memory cap, and the
  default follows. This is part of #13.

### Not blockers

- **pdf.js's renderer worker** (#20). Adopting it adds an option or
  changes where drawing happens, which 1.x allows in a minor release as
  long as no option, prop, or hook is removed or changes meaning. If the
  adoption would need a break and a pdf.js release has it before 1.0, it is
  done before 1.0; otherwise it waits for a major.
- **Text layers for unmounted pages** (#10) and **viewers showing each
  other's edits as they happen**: both add behavior, not API; they stay
  open questions in `target.md`, deferred past 1.0.
- **Decision 0008** (phone-sized viewports) stays rejected unless the
  device results of #13 reopen it.

### What 1.x promises

From 1.0, ParaPDF follows semantic versioning over its public API:

- Covered: the exports of `parapdf` and `parapdf/legacy` and their types;
  the documented props, options, hooks, methods, and events; the files the
  package ships at their documented paths (`pdfjs/`, for `assetBase`); and
  the behavior the functional checks assert.
- Not covered: pixels, timing, memory use, and the order of requests; the
  DOM ParaPDF builds beyond the documented class names and attributes;
  anything not exported; and the pdf.js objects the API hands out
  (`PDFDocumentProxy`, `PDFPageProxy`), whose types are pdf.js's.
- A break needs a major release; a deprecation lasts at least one minor
  release before the major that removes it. This succeeds decision 0002 at
  1.0.
- **pdfjs-dist upgrades.** A minor release when ParaPDF's API does not
  change, even when pdf.js draws or parses differently; the entry in
  `CHANGELOG.md` names the pdf.js version and what changed in behavior. A
  major release when pdf.js's change would break a covered part of the API,
  unless ParaPDF can keep it.
- **Security fixes** go to the latest minor release of the latest major.
  When a new major ships, the last minor of the previous one keeps getting
  pdf.js security updates for six months.

### The feature backlog

Against `target.md` and the domain-neutral rule:

| Issue | Classification |
| --- | --- |
| #4 editing annotations stored in a PDF | required; done (0.6) |
| #5 comments on created annotations | required; done |
| #6 application-controlled alternative text | required; done |
| #7 form scripts | optional (`formScripts`, off by default); done |
| #8 XFA forms | intentionally unsupported: pdf.js supports it only in part, at a high cost for the documents ParaPDF opens |
| #9 right-to-left page order | required; done (0.6) |
| #10 whole-document find with virtualized pages | deferred past 1.0 |
| #11 search highlights without the CSS Custom Highlight API | intentionally unsupported: every browser ParaPDF supports has the API |

## Evidence

No measurement decides this; it is a direction the maintainer sets. The
blockers are the places where the checks cannot speak for the user: CI
runs Playwright's WebKit, which is not Safari, and no check hears what a
screen reader announces.

## Consequences

- `target.md`, "Toward 1.0", lists the blockers; 1.0 ships once they hold
  and every check passes in the three browsers and in Safari.
- Decision 0002 stays in force until the 1.0 release, then this record
  supersedes it. Until then, breaks before 1.0 are still free and are the
  time to make them.
- `SECURITY.md` takes the support policy above at 1.0.
- The Limitations page and the package README list XFA and the highlight
  fallback as not planned, and #10 as later.

## Reopen if

A blocker turns out to need a device or tool nobody has access to, or a
pdf.js release changes the API ParaPDF hands out.
