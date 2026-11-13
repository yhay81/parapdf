# Decisions

One file per decision that matters for performance or direction: what was
decided, the evidence, and what would reopen it. Rejected ideas are kept so
they are not tried again without new measurements. A decision is final
until new measurements, or a change of direction by the maintainer, reopen
it. A new choice gets a new record, numbered next.

| # | Decision | Status |
|---|---|---|
| [0001](0001-pdfjs-only.md) | pdf.js is the only engine; no engine boundary | adopted |
| [0002](0002-no-compatibility.md) | No compatibility to keep before 1.0 | adopted |
| [0004](0004-kept-canvases.md) | Pages keep their canvases when they unmount | adopted |
| [0005](0005-frame-display.md) | Frame display (OffscreenCanvas, ImageBitmap) | rejected |
| [0006](0006-partial-rendering.md) | pdf.js's partial rendering of regions | rejected |
| [0007](0007-keep-parsed-pages.md) | Keeping unmounted pages' parsed content | rejected |
| [0008](0008-demote-whole-page-detail.md) | Every whole-page detail becomes the base when zooming past its budget | rejected |
| [0009](0009-viewer-lifetimes.md) | Each viewport owns its viewer work | adopted |
| [0010](0010-renderer-owns-page-dom.md) | The renderer owns each page's DOM, and kept canvases move | adopted |
| [0011](0011-react-api.md) | The React API: viewers of their own, live options, the session's state | adopted |
| [0012](0012-demote-small-whole-page-detail.md) | A whole-page detail no larger than a base becomes the base | adopted |
| [0013](0013-path-text.md) | Text drawn as paths (`disableFontFace`) by default | rejected |
| [0014](0014-no-preload-in-webkit.md) | No PDF preload in WebKit browsers | adopted |
| [0015](0015-toward-1.0.md) | What 1.0 requires, and what 1.x promises | proposed |
| [0016](0016-form-scripts-after-first-paint.md) | Form scripts start after the first paint | adopted |
| [0017](0017-measured-against-react-pdf.md) | ParaPDF is measured against react-pdf | adopted |
| [0018](0018-keep-the-size-query-container.md) | The scroller stops being a size query container | rejected |
| [0019](0019-pdfjs-viewer-parity.md) | What ParaPDF takes from pdf.js's viewer, and what it leaves | adopted |
| [0020](0020-text-layers-built-in-the-document.md) | Text layers are built out of the document | rejected |
| [0021](0021-focus-follows-the-page.md) | Focus follows the page being read | adopted |
| [0022](0022-runtime-policy-modules.md) | Keep runtime policies in the modules that own them | adopted |
| [0023](0023-provider-url-fragments.md) | URL open parameters belong to the provider | adopted |
| [0024](0024-links-found-in-the-text.md) | Links found in the text are a feature off by default | adopted |
| [0025](0025-no-base-redrawn-under-whole-page-detail.md) | No base drawn again under a whole-page detail | adopted |
| [0026](0026-detail-kept-until-replaced.md) | A detail kept while hidden, and until a base replaces it | adopted |
| [0027](0027-search-from-the-current-page.md) | Search from the current page | adopted |
| [0028](0028-released-renderer-worker.md) | Ship pdf.js 6.5.438 with opt-in worker drawing | adopted |
| [0029](0029-webgpu-mesh-shadings.md) | WebGPU drawing of mesh shadings is opt-in | adopted |
| [0030](0030-page-user-units.md) | DOM layers and search boxes follow the page's PDF user-space unit | adopted |
| [0031](0031-tagged-page-ownership.md) | Each mounted tagged page owns its accessibility targets | adopted |
| [0032](0032-react-lifetimes.md) | Documents open in render, and viewers keep their view while hidden | adopted |
| [0033](0033-viewer-context-and-state.md) | Viewer context, React 19 refs, and tracked state hooks | adopted |
| [0034](0034-declarative-feature-components.md) | Declarative feature components and synchronous annotation controls | adopted |
| [0035](0035-document-actions-and-react-surface.md) | Document-owned actions and a React-only public surface | adopted |
| [0036](0036-overlays-coordinates-and-preload.md) | Declarative overlays, selection popovers, PDF coordinates, and route preloading | adopted |

## Template

```markdown
# NNNN. Title

- Status: proposed | adopted | rejected | superseded by NNNN
- Date: YYYY-MM-DD

## Decision
What was decided, and in a sentence or two why it came up. For a rejected
idea, what stays instead and why.
## Evidence
The script, the browsers, the runs, the result files, and the numbers that
decide it. Wins and losses both.
## Reopen if
```
