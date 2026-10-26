# Decisions

One file per decision: its status, why it came up, what was decided, the
evidence, and what would reopen it. A decision is final until new
measurements, or a change of direction by the maintainer, reopen it; nobody
re-derives or re-litigates it from the code or from
`docs/history/AGENTS-v0.md`. A new choice that matters for performance or
for the direction of the rebuild gets a new record, numbered next.

| # | Decision | Status |
|---|---|---|
| [0001](0001-pdfjs-only.md) | pdf.js is the only engine; no engine boundary | adopted |
| [0002](0002-no-compatibility.md) | No compatibility to keep: break APIs freely | adopted |
| [0003](0003-rebuild-process.md) | How the rebuild is run | adopted |
| [0004](0004-kept-canvases.md) | Pages keep their canvases when they unmount | adopted |
| [0005](0005-frame-display.md) | Frame display (OffscreenCanvas, ImageBitmap) | rejected |
| [0006](0006-partial-rendering.md) | pdf.js's partial rendering of regions | rejected |
| [0007](0007-keep-parsed-pages.md) | Keeping unmounted pages' parsed content | rejected |
| [0008](0008-demote-whole-page-detail.md) | A whole-page detail becomes the base when zooming past its budget | rejected |
| [0009](0009-viewer-lifetimes.md) | Each viewport owns its viewer work; separate hot and cold snapshots | adopted |
| [0010](0010-renderer-owns-page-dom.md) | The renderer owns each page's DOM, and kept canvases move | adopted |

## Template

```markdown
# NNNN. Title

- Status: proposed | adopted | rejected | pending | superseded by NNNN
- Date: YYYY-MM-DD

## Context
## Decision (or Idea, for one not adopted)
## Evidence
Measurements with the script, the build or branch, the browsers, the runs,
and the result files. Wins and losses both.
## Consequences
## Reopen if
```
