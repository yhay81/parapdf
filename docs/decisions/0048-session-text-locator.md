# 0048. Session-level `findText()` and directional text-item boxes

- Status: adopted
- Date: 2026-11-17

## Decision

Applications highlighting and scrolling to quoted PDF citations (`{ pageIndex, quote }`)
had to either overwrite the viewer's single `useSearch()` state or call
`session.proxy.getPage().getTextContent()` directly and reimplement ParaPDF's
NFKC / half-width-katakana / CJK and hyphenated line-join normalization alongside
`/UserUnit` and intrinsic `/Rotate` box conversion. In addition, `readPageText()`
transformed `(e, f)` and `(e + width, f + height)` along raw page axes without
consulting `item.transform`'s orientation or vertical font writing mode, and
retained no per-item advance direction for slicing substring matches on turned
or vertical runs.

`docs/architecture.md`, "Document" and "Features", adds a standalone session
locator alongside `getText()` and refines `PageText` box geometry:

- `findText(session, query, options?)` (`FindTextOptions`: `from`, `to`, `limit`,
  `signal`, plus `SearchOptions`; returning `TextMatch[]` with `pageIndex`,
  `start`, `end`, `rects: readonly PdfRect[]`, and union `bounds: PdfRect`)
  locates matches across an inclusive page range with or without a mounted
  `<PdfViewer>`, leaving `useSearch()` and `CSS.highlights` untouched.
- `SEARCH_INDEX_SLOT` and `pageIndex()` live in DOM-free `features/search/page-index.ts`,
  shared between `useSearch()` and `findText()` so both reuse each session's
  cached `PageText` and `PageIndex` while minimal applications still emit zero
  search chunks.
- `readPageText()` transforms each item's origin, advance, and cross-axis vectors
  directly through `viewport.transform` (accounting for rotated text matrices,
  `/Rotate`, `/UserUnit`, `dir === "rtl"`, and vertical `WMode` fonts) into
  pre-allocated `Float32Array` `boxes` and 1-byte `Uint8Array` `directions`.
- `matchRects()` trims line-wrap whitespace, slices partial first and last items
  proportionally with zero-width combining-mark and East Asian width weights
  along the item's advance axis, and coalesces adjacent runs on the same line
  while keeping multi-line wraps and wide column gaps separate. `useSearch()`
  also reveals `matchRects(text, match).bounds` when scrolling to a match.

## Evidence

[`text.test.ts`](../../packages/parapdf/test/text.test.ts) covers page-range
filtering, `limit` early stopping without extra page reads, shared `PageText`
and `PageIndex` reuse alongside `useSearch()`, substring slicing across
surrogate pairs, combining marks, mixed CJK/ASCII, half-width katakana,
hyphenated and CJK line wraps, table gaps, `/Rotate` (`90`, `180`, `270`),
`/UserUnit`, rotated CTMs, RTL, vertical CJK, closed sessions, and `AbortSignal`.
[`check-text.ts`](../../examples/prototype/scripts/check-text.ts),
[`check-rotation.ts`](../../examples/prototype/scripts/check-rotation.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), and
[`check-package.ts`](../../packages/parapdf/scripts/check-package.ts) verify
`<PdfPageOverlay>` + `<PdfPageRect>` and `viewer.revealRect()` alignment against
live `.parapdf-text-layer` DOM ranges across unrotated pages, multi-line and
vertical CJK, `/Rotate` `0`/`90`/`180`/`270`, `/UserUnit 2`, and view rotation
in Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0, with zero search
chunks in standalone minimal builds.

On an M2 Pro on AC power, a same-run comparison against `b97d985` (three rounds
per browser with alternating build order) timed sequential `session.text(i)`
across all 110 pages (`22,341` items) of `bill-hr815.pdf`, plus `findText()` on
the new build:

| Browser | Read all 110 pages, before → after (ms) | Cold index + `findText` 110 pages (ms) | Warm `findText` 110 pages / 1 page (ms) |
|---|---:|---:|---:|
| Chromium 158.0.8127.18 | 116.8 → 117.4 | 54.8 | 0.38 / 0.03 |
| WebKit 27.2 | 136.7 → 134.0 | 37.1 | 0.38 / 0.06 |
| Firefox 159.0 | 183.2 → 178.0 | 48.1 | 0.62 / 0.06 |

`scroll-bench.ts` also compared `dist` against `b97d985` in the same run on
`bill-hr815.pdf` at 3600 CSS px/s (2 s, median of 3 runs on AC power:
[`Chromium`](../../examples/prototype/results/scroll-find-text-chromium.md),
[`WebKit`](../../examples/prototype/results/scroll-find-text-webkit.md),
[`Firefox`](../../examples/prototype/results/scroll-find-text-firefox.md)). Both
builds recorded 0.0% blank area, 0 dropped frames, 118 MiB canvas memory, and
identical render and store-update counts; main-thread blocked time (after,
before) was 31, 23 ms in Chromium; 16, 24 ms in WebKit; and 52, 61 ms in
Firefox. No scroll speed change beyond run-to-run variation is claimed.

## Reopen if

- Sub-item proportional slicing needs exact per-glyph advance widths from
  pdf.js's worker for heavily kerned proportional Latin scripts, and the extra
  typed-array memory per page is justified by measurements.
- Citations spanning a page break need a multi-page search index across page
  boundaries rather than per-page `TextMatch` entries.
