# 0036. Declarative overlays, selection popovers, PDF coordinates, and route preloading

- Status: adopted
- Date: 2026-11-13

## Decision

`<PdfViewer>` previously rendered custom page overlays through a
`renderOverlay?: (pageIndex: number) => ReactNode` prop evaluated inside the
parent `ViewerViewport` on every mounted-window shift (`first` / `last`), which
passed a new `overlay` React element prop into every mounted `memo(PdfPage)` and
prevented Server Components from passing plain JSX children to a single page.
Applications building floating toolbars over text selections also had no virtual
anchor outside a page's `contain: "strict"` box, no inverse mapping from pointer
coordinates back to unturned PDF points, and no imperative route/hover helper to
warm a `DocumentSession` ahead of `<PdfDocument>` mounting.

`docs/architecture.md`, "View", "Features", "Document", and "React", replaces
`renderOverlay` and adds declarative overlay, selection, coordinate, and preload
primitives:

- `<PdfPageOverlay page={pageIndex} viewer?>{children}</PdfPageOverlay>` takes a
  plain `ReactNode` (compatible with React Server Components) and portals into
  that page's `.parapdf-overlay-layer` only while the page is mounted,
  allocating the overlay container lazily when an overlay claims the page.
- `<PdfPageOverlays viewer?>{(pageIndex) => ReactNode}</PdfPageOverlays>`
  registers its render function on a per-viewer `OverlayStore`; each mounted
  `memo(PdfPage)` evaluates registered functions inside `usePageOverlays`, so
  shifting `first` / `last` leaves already-mounted pages' props unchanged and
  preserves `memo(PdfPage)` bailouts. `renderOverlay` on `<PdfViewer>` is
  removed.
- `<PdfPageRect>` forwards `ref` and `className` to its underlying `<div>` so
  anchored popovers and tooltips can attach directly to PDF-point rectangles.
- `useSelection(viewer?)` includes `anchor: SelectionAnchor`
  (`getBoundingClientRect()`), compatible with Floating UI, Radix, and Base UI,
  and compares selections structurally instead of with `JSON.stringify`.
- `<PdfSelectionPopover viewer? placement? offset? zIndex?>{(selection) => ReactNode}</PdfSelectionPopover>`
  portals to `document.body` outside page `contain: "strict"`, updates its CSS
  transform directly on scroll, resize, layout, and `selectionchange` without
  committing React state per frame, and preserves the browser's text selection on
  `mousedown` over non-editable controls inside the popover.
- `viewer.pointAt(point)` maps viewport client coordinates (`{ clientX, clientY }`)
  to `{ pageIndex, x, y }` (`PdfPagePoint`) in unturned PDF points (`userUnit`
  and view + intrinsic page rotation accounted for), returning `null` in gaps,
  outside the viewport, or on hidden `"page"`-mode rows. `<PdfViewer onPageClick?>`
  fires with `(point, event)` on unmodified primary clicks that do not land on
  interactive controls, collapsed selections, or hand-tool drags.
- `preloadDocument(source)` lives in a standalone `"use client"` module so route
  and hover callers tree-shake `<PdfViewer>`, starts `preloadPdfjs()`, starts
  React's `preload()` when safe (honoring decision 0014 in WebKit), and opens a
  shared `DocumentSession` under decision 0032's unreferenced-session TTL so a
  subsequent `<PdfDocument source={source}>` joins the already-opening or ready
  session.

## Evidence

[`react-overlays.test.ts`](../../packages/parapdf/test/react-overlays.test.ts)
covers `unturnPoint` across `0`/`90`/`180`/`270` rotations, `viewer.pointAt`
with live boxes, headless layout fallbacks, scrollbar gutters, gaps, and hidden
`"page"` rows, `OverlayStore` lazy `.parapdf-overlay-layer` allocation and
multi-portal sharing, `selection.anchor` and structural `sameSelection`,
`computePopoverPosition`, SSR rendering, and `preloadDocument` session reuse.
[`check-rotation.ts`](../../examples/prototype/scripts/check-rotation.ts),
[`check-text.ts`](../../examples/prototype/scripts/check-text.ts),
[`check-options.ts`](../../examples/prototype/scripts/check-options.ts), and
[`check-document.ts`](../../examples/prototype/scripts/check-document.ts) verify
rotated `pointAt()` / `onPageClick` (including `/UserUnit`), `<PdfSelectionPopover>`
zero-commit scroll tracking and selection preservation, `<PdfPageOverlays>`
`memo(PdfPage)` bailouts on window shifts, and `preloadDocument()` single-download
session warming in Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0, along
with all other functional checks, `check:package`, `check:modules`,
`check:bundlers`, and the site's `check:demo`.

`scroll-bench.ts` measured the demo built from this branch against
`document-actions-and-react-surface` (`df30037`) on AC power in turn, job by job:
1280×900 at `devicePixelRatio` 2, fit-width, four seconds of scrolling at 900
and 3600 CSS pixels per second through `synthetic-text-1000.pdf` and
`bill-hr815.pdf`, median of five runs
([`scroll-overlays-chromium.md`](../../examples/prototype/results/scroll-overlays-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-overlays-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-overlays-firefox.md)).
In every browser and job, both builds have 0.0% blank area, hold the same canvas
memory (156, 111, 183, and 127 MiB), and publish the same store updates. At
900 px/s both builds commit React 4 times; at 3600 px/s the demo's
`<PdfPageOverlay page={0}>` adds one commit (25 vs 24, and 21 vs 20) when page 1
leaves the overscan window and unmounts its portal, with zero extra commits on
subsequent window shifts. Main thread blocked while scrolling, in ms, after and
before:

| Job | Chromium | WebKit | Firefox |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 1, 3 | 4, 4 | 8, 10 |
| synthetic-text-1000.pdf, 3600 px/s | 5, 4 | 5, 5 | 22, 19 |
| bill-hr815.pdf, 900 px/s | 7, 7 | 11, 13 | 14, 13 |
| bill-hr815.pdf, 3600 px/s | 2, 1 | 10, 4 | 13, 27 |

No timing difference beyond run-to-run variation is claimed.

## Review: overlay identity and effect replay

React keeps portal children when StrictMode replays layout effects. Removing
their container and allocating a replacement in effect setup left the children
inside a detached element. Page hosts now reconnect the container chosen during
render. Renderer IDs are also unique across viewers: an overlay retains its ID
when its `viewer` prop changes, so per-viewer counters could overwrite an
existing overlay in the target viewer. The store regression and real React
fixture in `check:lifecycle` failed before these changes and pass in Chromium,
WebKit, and Firefox; the fixture also checks Activity hide/show.

A same-run scroll comparison isolated these overlay changes from the reviewed
parent changes: `bill-hr815.pdf`, 3600 px/s, two seconds, median of three runs
on AC power. Reports:
[`Chromium`](../../examples/prototype/results/overlays-review-chromium.md),
[`WebKit`](../../examples/prototype/results/overlays-review-webkit.md),
[`Firefox`](../../examples/prototype/results/overlays-review-firefox.md).
Main-thread blocked time (after, before) was 1, 0 ms; 25, 29 ms; and 38, 46 ms.
First paint was 136, 137 ms; 155, 157 ms; and 236, 235 ms. All jobs had zero
blank area and dropped frames and 118 MiB canvas memory. Commits remained one
more than window/current-page updates, as before, when page 1's static portal
unmounts. Chromium waited for another browser before measuring; no jobs
overlapped it. No speed improvement is claimed.

## Reopen if

- An overlay pattern needs page-coordinate clamping or collision detection inside
  individual pages rather than viewport-level positioning via `selection.anchor`
  or `<PdfPageRect ref>`.
- `preloadDocument(source)` is called in bulk for dozens of links simultaneously
  and needs concurrency throttling or explicit eviction ahead of the session
  registry's unreferenced TTL.
