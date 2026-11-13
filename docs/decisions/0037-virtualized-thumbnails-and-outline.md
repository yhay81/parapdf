# 0037. Window-virtualized thumbnails and headless document outline

- Status: adopted
- Date: 2026-11-13

## Decision

`<PdfThumbnails>` previously mounted `Array.from({ length: pageCount })` `<li>`,
`<button>`, and `<canvas>` elements all at once — relying on `IntersectionObserver`
only to defer pixel rasterization — and forced callers to wrap it in `<Suspense>`
and plumb `usePageLabels()` manually if they wanted Roman numerals or section
prefixes (`"iv"`, `"A-3"`) instead of raw 1-based page indices. Every application
with a document outline also had to write the same recursive `OutlineNode` tree,
`bold` / `italic` typography mapping, `viewer.goToDestination()` wiring, and
`externalLinks` security policy (`rel="noopener noreferrer nofollow"` vs inert
`aria-disabled="true"`) from scratch, even though `<PdfViewer>` held
`externalLinks` privately.

`docs/architecture.md`, "View" and "React", replaces full-DOM thumbnail lists and
adds `<PdfOutline>`:

- `<PdfThumbnails>` window-virtualizes its `<ol>` over a `Float64Array` prefix sum
  of turned page heights (`computeThumbnailOffsets`, `computeThumbnailRange`),
  mounting only the visible range plus overscan (`DEFAULT_THUMBNAIL_OVERSCAN = 6`)
  and sizing unmounted regions with transparent `borderTop` / `borderBottom`
  spacers on `<ol>` so stylesheet `padding`, flex `rowGap`, and
  `ol.getBoundingClientRect().top` stay invariant without inserting non-`<li>`
  spacer elements. Each mounted `<li>` carries `aria-setsize={pageCount}` and
  `aria-posinset={pageIndex + 1}`.
- `<PdfThumbnails>` resolves the PDF's `pageLabels` automatically without
  suspending (`createPageLabelsStore`, `useOptionalPageLabels`), displaying `1..N`
  immediately and upgrading to the PDF's labels once read. `pageLabel` receives
  `(pageNumber, pageCount, label)` and defaults to `` `Page ${label}` `` when the
  PDF defines custom page labels or `` `Page ${pageNumber} of ${pageCount}` ``
  otherwise.
- `<PdfThumbnails>` scrolls `currentPage` into view (`block: "nearest"`) via
  `scrollOffsetForThumbnail` even when the target item is outside the mounted
  window, and accepts `id?: string` and `children?: (item: ThumbnailItem) => ReactNode`
  (measuring custom `<li>` heights in `useLayoutEffect` when `children` is
  supplied).
- `Viewer` publishes its live `externalLinks` option (`"new-tab" | "disabled"`)
  through an internal store and a public `viewer.externalLinks` getter.
- `<PdfOutline>` (`PdfOutlineProps`, `OutlineItemHelpers`) reads `useOutline()`
  under the caller's `<Suspense>` boundary, renders `<nav><ol>…</ol></nav>` (or
  `null` when empty), styles `bold` and `italic` entries, jumps internal
  destinations via `viewer.goToDestination(item.dest)` (or `onNavigate`), honors
  live `viewer.externalLinks` (`<a target="_blank" rel="noopener noreferrer nofollow">`
  vs inert `<a aria-disabled="true">` without `href`), and supports
  `defaultExpanded` and `renderItem(item, helpers)`.

## Evidence

[`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts)
covers `thumbnailCanvasHeight`, 1,000-page mixed-size `computeThumbnailOffsets`
and `computeThumbnailRange` spacer invariants with `rowGap`,
`scrollOffsetForThumbnail`, `findThumbnailScroller`, non-suspending
`createPageLabelsStore`, live `viewer.externalLinks`, `<PdfOutline>` SSR client
bailout (`use(browser())`), and `OutlineTree` HTML output.
[`check-features.ts`](../../examples/prototype/scripts/check-features.ts) and
[`check-links.ts`](../../examples/prototype/scripts/check-links.ts) verify 1,000-page
window virtualization, deep-page auto-scrolling (`viewer.goToPage(500)`), automatic
custom `pageLabels`, and `<PdfOutline>` bold styling, internal jumps, and live
`externalLinks="disabled"` updates in Chromium 158.0.8127.18, WebKit 27.2, and
Firefox 159.0, alongside all other functional checks, `check:package`,
`check:modules`, `check:bundlers`, and the site's `check:demo`.

Opening the thumbnails sidebar on `synthetic-text-1000.pdf` (1280×900 at
`devicePixelRatio` 2, AC power, measured in turn against
`overlays-coordinates-and-preload` `7546e77` over 5 runs per browser after
`pageLabels()` resolved) mounts 11 `<li>` and `<canvas>` elements instead of
1,000, cutting click-to-two-animation-frame presentation latency across all three
browsers (note: Playwright's headless WebKit is not Safari):

| Browser | Mounted `<li>` / `<canvas>` (after, before) | Open latency median, ms (after, before) | Runs, ms (after vs before) |
|---|---:|---:|---|
| Chromium 158.0.8127.18 | 11, 1000 | 16.5, 31.7 | `13.4–32.9` vs `31.1–35.9` |
| WebKit 27.2 (Playwright) | 11, 1000 | 35.9, 78.6 | `33.0–53.4` vs `73.9–137.8` |
| Firefox 159.0 | 11, 1000 | 22.7, 84.6 | `20.4–30.7` vs `79.1–85.7` |

`scroll-bench.ts` also measured main-viewport scrolling on this branch against
`overlays-coordinates-and-preload` (`7546e77`) on AC power in turn, job by job:
1280×900 at `devicePixelRatio` 2, fit-width, four seconds of scrolling at 900 and
3600 CSS pixels per second through `synthetic-text-1000.pdf` and `bill-hr815.pdf`,
median of five runs
([`scroll-thumbnails-outline-chromium.md`](../../examples/prototype/results/scroll-thumbnails-outline-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-thumbnails-outline-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-thumbnails-outline-firefox.md)).
In every browser and job, both builds have 0.0% blank area, identical React
commits (4 at 900 px/s; 25 and 21 at 3600 px/s), identical store updates, and
identical canvas memory (156, 111, 183, and 127 MiB). Main thread blocked while
scrolling, in ms, after and before:

| Job | Chromium | WebKit | Firefox |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 2, 4 | 5, 3 | 37, 18 |
| synthetic-text-1000.pdf, 3600 px/s | 5, 6 | 7, 4 | 22, 21 |
| bill-hr815.pdf, 900 px/s | 5, 11 | 17, 17 | 29, 23 |
| bill-hr815.pdf, 3600 px/s | 3, 0 | 10, 11 | 16, 20 |

No main-viewport scroll timing difference beyond run-to-run variation is claimed.

## Review: measured geometry, failed labels, and collapsed outlines

The initial thumbnail estimate can differ from measured item chrome. Opening a
sidebar at page 501 then scrolled to the estimate but never corrected it, leaving
the active thumbnail outside the mounted window. Active-page alignment now runs
again when global geometry changes (measured chrome, gap, page sizes, width, or
rotation), without following individual custom-item measurements during manual
browsing. Failed page-label reads now retain numeric labels instead of producing
an unhandled rejection. The default outline renderer provides expand/collapse
buttons; previously `defaultExpanded={false}` made nested entries unreachable
without a custom renderer.

The label failure unit regression failed before the catch. A real React/browser
fixture (`navigation-controls.tsx`) also reproduced the incorrect initial,
rotated, and resized thumbnail position and the unreachable collapsed outline.
All five behaviors, including manual thumbnail browsing, pass after the fix in
Chromium, WebKit, and Firefox. `check:features` covers reopening thumbnails at a
deep page and rotating them; `check:links` covers the default outline controls.

`navigation-bench.ts` compares production builds with and without these three
review fixes in the same run, five fresh contexts per variant, 1280×900 at DPR 2,
on AC power. It measures React mount to two animation frames for the 1,000-item
list at page 501 with deterministic CSS, without drawing PDF pixels. Raw reports:
[`Chromium`](../../examples/prototype/results/navigation-review-chromium.json),
[`WebKit`](../../examples/prototype/results/navigation-review-webkit.json),
[`Firefox`](../../examples/prototype/results/navigation-review-firefox.json).

| Browser | Open latency median, ms (after, before) | Mounted items (after, before) |
|---|---:|---:|
| Chromium 158.0.8127.18 | 23.5, 23.5 | 16, 15 |
| WebKit 27.2 (Playwright) | 36.3, 22.3 | 15, 15 |
| Firefox 159.0 | 24.3, 22.6 | 16, 15 |

WebKit pays about one frame for the correction in this run. The baseline failed
to show the active thumbnail in every sample, whereas the corrected build showed
it in every sample; no speed win is claimed against that incorrect result. Both
builds keep the list virtualized, and no measurement overlapped another browser.

## Reopen if

- Horizontal or multi-column grid thumbnail layouts become common enough that
  vertical single-column prefix-sum virtualization in `<PdfThumbnails>` needs a
  row-wrapping or horizontal layout mode.
- Documents with tens of thousands of flattened outline nodes need window
  virtualization inside `<PdfOutline>` in addition to `defaultExpanded={false}`.
