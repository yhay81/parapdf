# 0049. Unmounted pages keep no DOM text layers

- Status: rejected
- Date: 2026-11-19

## Decision

Only pages in `<PdfViewer>`'s mounted window (`visibleRange` plus `overscan`,
2 by default) have `.parapdf-text-layer` DOM. Mounting text layers for every
page, retaining a larger bounded set of unmounted text layers, inserting
`<div hidden="until-found">` text placeholders for unmounted pages, and
pinning pages in the DOM while a browser `Selection` touches them are all
rejected (#10). No separate text-retention option is added; `<PdfViewer
overscan>` remains the single control over how many neighboring pages mount
around the viewport.

The intended contract for whole-document and cross-page text operations is:

- **Find**: `useSearch()` for an interactive viewer find bar (painted with the
  CSS Custom Highlight API; applications bind Ctrl+F / ⌘F to their search input)
  and `findText(session, query, options?)` for programmatic match rectangles.
  Native browser find sees only mounted pages and does not join PDF hyphenated
  or CJK line wraps or normalize full-width / NFKC forms.
- **Select-all and copy**: browser select-all (`Ctrl+A` / `⌘A`) and `Ctrl+C` /
  `⌘C` cover only mounted pages (and surrounding page UI unless scoped by the
  application). Whole-document copy uses `await getText(session)`.
- **Selections across unmounted pages**: browser drag and Shift+click
  selections work across the mounted window; once a page holding a selection
  endpoint unmounts, the browser collapses or truncates its live DOM `Range`
  and `useSelection()` updates accordingly. Multi-page extraction across
  arbitrary page spans records `start` and `end` `TextPoint`s from
  `useSelection()` (or page indices) and reads `await getText(session, { from,
  to })`.
- **Assistive technology**: screen readers traverse mounted page regions and
  continue into adjacent pages as focus and scrolling advance the mounted
  window (decision 0021).

Why each alternative fails:

1. **Mounting all pages' text layers (`all-text`)** destroys DOM, accessibility,
   zoom-commit, and scroll bounds on long documents even when canvas memory is
   capped to the visible viewport.
2. **Bounded text retention (`bounded-20` or detached LRU)** either keeps extra
   pages in the DOM — multiplying DOM, accessibility, zoom, and scroll cost
   while still omitting most of a long document and making native find match
   counts silently incomplete — or detaches `.parapdf-text-layer` nodes, which
   makes them invisible to native find, `Selection`, and assistive technology
   without speeding up first-pixel return paints (text layers build in idle
   time after scrolling settles).
3. **`hidden="until-found"` placeholders (`until-found`)** are excluded from
   `Selection` (`selectAllChildren`) and from assistive technology (`content-visibility:
   hidden`), eagerly parse every page on open, double JS heap on 1,000 pages,
   still miss hyphenated and CJK line wraps in native find, and reveal an
   unpositioned placeholder `<div>` on `beforematch` before `DomLayers` builds
   the positioned `.parapdf-text-layer` in idle time.
4. **Selection-aware mounting**: keeping only the selection's endpoint pages
   mounted while middle pages unmount causes `selection.toString()` and native
   copy to concatenate the endpoints and silently drop every unmounted page in
   between; keeping every page from the anchor through the viewport mounted lets
   one un-cleared word selection on page 1 followed by scrolling or jumping to
   page 1,000 mount all 1,000 pages, while intermediate pages scrolled past
   before settling still have no built text layers.

## Evidence

[`text-virtualization-bench.ts`](../../examples/prototype/scripts/text-virtualization-bench.ts)
measured all four strategies on `bill-hr815.pdf` (110 pages) and
`synthetic-text-1000.pdf` (1,000 pages) at 1280×900, `devicePixelRatio` 2,
`fit-width` zoom, `annotationLayer={false}`, and `maxCanvasPixels` capped to
25,165,824 (24 MP), median of 3 runs on an Apple M2 Pro on AC power
([`text-virtualization-chromium.md`](../../examples/prototype/results/text-virtualization-chromium.md),
[`-webkit`](../../examples/prototype/results/text-virtualization-webkit.md),
[`-firefox`](../../examples/prototype/results/text-virtualization-firefox.md);
Playwright WebKit 27.2 is not Safari):

| Browser & document | Strategy | Text ready (ms) | `.parapdf-pages` nodes (spans) | Zoom 2× commit (ms) | 2 s scroll blocked / max lag (ms) | Dropped frames |
|---|---|---:|---:|---:|---:|---:|
| Chromium 159, 110p | `virtualized` | 227.0 | 1,314 (572) | 24.3 | 30.7 / 10.7 | 0 / 123 |
| Chromium 159, 110p | `bounded-20` | 333.2 | 10,256 (4,542) | 27.7 | 36.3 / 11.9 | 0 / 123 |
| Chromium 159, 110p | `until-found` | 333.2 | 1,528 (572) | 23.2 | 27.3 / 12.2 | 0 / 122 |
| Chromium 159, 110p | `all-text` | 849.3 | 50,818 (22,102) | 57.1 | 67.1 / 12.3 | 0 / 122 |
| Chromium 159, 1,000p | `virtualized` | 240.4 | 500 (159) | 15.4 | 28.5 / 12.3 | 0 / 122 |
| Chromium 159, 1,000p | `bounded-20` | 301.1 | 3,488 (1,113) | 16.2 | 48.4 / 15.5 | 0 / 122 |
| Chromium 159, 1,000p | `until-found` | 1,193.5 | 2,494 (159) | 15.9 | 37.6 / 14.4 | 0 / 122 |
| Chromium 159, 1,000p | `all-text` | 3,403.9 | 166,002 (53,000) | 150.9 | 174.2 / 30.0 | 0 / 123 |
| WebKit 27.2, 110p | `virtualized` | 251.9 | 1,314 (572) | 13.1 | 39.8 / 11.1 | 0 / 147 |
| WebKit 27.2, 110p | `bounded-20` | 700.8 | 10,256 (4,542) | 100.2 | 248.7 / 25.1 | 1 / 146 |
| WebKit 27.2, 110p | `until-found` | 349.6 | 1,528 (572) | 13.5 | 8.6 / 9.8 | 0 / 147 |
| WebKit 27.2, 110p | `all-text` | 4,313.1 | 50,818 (22,102) | 310.9 | 1,447.4 / 135.0 | 20 / 67 |
| WebKit 27.2, 1,000p | `virtualized` | 273.3 | 500 (159) | 14.0 | 15.5 / 11.8 | 0 / 147 |
| WebKit 27.2, 1,000p | `bounded-20` | 659.6 | 3,488 (1,113) | 30.6 | 82.8 / 15.1 | 0 / 147 |
| WebKit 27.2, 1,000p | `until-found` | 1,341.7 | 2,494 (159) | 18.0 | 43.0 / 11.3 | 0 / 147 |
| WebKit 27.2, 1,000p | `all-text` | 80,366.4 | 166,002 (53,000) | 740.8 | 2,064.0 / 522.3 | 10 / 12 |
| Firefox 159, 110p | `virtualized` | 344.2 | 1,314 (572) | 57.6 | 60.4 / 14.3 | 0 / 123 |
| Firefox 159, 110p | `bounded-20` | 653.9 | 10,256 (4,542) | 64.9 | 81.3 / 18.0 | 0 / 123 |
| Firefox 159, 110p | `until-found` | 527.8 | 1,528 (572) | 61.4 | 48.1 / 15.2 | 0 / 123 |
| Firefox 159, 110p | `all-text` | 2,123.8 | 50,818 (22,102) | 86.1 | 61.6 / 16.6 | 0 / 123 |
| Firefox 159, 1,000p | `virtualized` | 353.8 | 500 (159) | 65.4 | 50.5 / 17.7 | 0 / 123 |
| Firefox 159, 1,000p | `bounded-20` | 601.2 | 3,488 (1,113) | 72.5 | 87.7 / 18.9 | 0 / 123 |
| Firefox 159, 1,000p | `until-found` | 2,348.3 | 2,494 (159) | 66.0 | 72.0 / 22.7 | 0 / 123 |
| Firefox 159, 1,000p | `all-text` | 12,669.2 | 166,002 (53,000) | 202.4 | 147.8 / 21.7 | 0 / 123 |

- **Memory and accessibility tree (Chromium CDP, 1,000 pages)**: JS heap after
  GC grew from `4.8` MiB (`virtualized`) to `10.1` MiB (`until-found`) and
  `15.1` MiB (`all-text`); `Accessibility.getFullAXTree` grew from `624` nodes
  in `11.4` ms (`virtualized`) to `110,076` nodes in `2,083.6` ms (`all-text`),
  and on 110 pages from `1,629` nodes in `23.8` ms to `44,720` nodes in `672.0`
  ms.
- **Browser find, select-all, and cross-window selection (all three browsers)**:
  `window.find()` returned `false` across hyphenated (`<span>parapdf-</span><br><span>hyphenprobe</span>`)
  and full-width/CJK (`<span>パラＰＤＦ</span><br><span>検索検証九八四</span>`) line
  breaks; `selectAllChildren()` omitted `hidden="until-found"` text; pinning
  only selection endpoints (pages 1 and 10 of `bill-hr815.pdf`) copied
  `8,694–8,697` characters and silently omitted pages 2–7, whereas
  `getText(session, { from, to })` returned all `24,808` characters across all
  10 pages in `0.44–1.21` ms (and all 110 pages, `300,678` characters, in
  `85.8–159.9` ms cold; `findText(session, "appropriations")` found all `74`
  matches in `38.8–60.8` ms cold).

## Reopen if

The web platform adds a virtualized-document find and selection API that works
without materializing offscreen DOM nodes, and measurements on 1,000-page
documents in Chromium, WebKit, Safari, and Firefox show no regression in DOM
size, accessibility queries, zoom commits, or scroll blocked time.
