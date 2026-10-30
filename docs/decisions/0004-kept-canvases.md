# 0004. Pages keep their canvases when they unmount

- Status: adopted
- Date: 2026-10-24 (budget raised to twelve viewports on 2026-10-27)

## Decision

A page that leaves the mounted window keeps its canvases, up to
`maxKeptPixels`: by default twelve viewports' worth of device pixels
(`KEPT_VIEWPORTS` in `render/kept-canvases.ts`); 0 keeps none. When the page
mounts again, the same canvas elements move into its new host (decision
0010), so it shows at once without drawing.

- Over the budget the least recently kept go, but only after the pages
  mounting in the same React commit took theirs back: React unmounts pages
  before it mounts others.
- Within `maxCanvasPixels`, kept canvases count as canvases and go before
  any page's, so they never keep a page from drawing.
- Nothing is kept of a page whose form fields are shown as HTML (pdf.js
  draws some fields into canvases of their own), nor while the viewer has no
  viewport.

## Evidence

`return-bench.ts` at 820×1000, devicePixelRatio 2, fit-width, three runs,
medians.

Coming back from page 13 to page 1, sharp after (ms), no kept canvases →
kept ([`return-chromium.md`](../../examples/prototype/results/return-chromium.md),
[`return-webkit.md`](../../examples/prototype/results/return-webkit.md),
[`return-firefox.md`](../../examples/prototype/results/return-firefox.md)):

| File | Chromium | WebKit | Firefox |
|---|---:|---:|---:|
| bill-hr815.pdf | 23 → 3 | 27 → 11 | 176 → 38 |
| synthetic-vector-pages.pdf | 167 → 5 | 172 → 3 | 168 → 19 |

Budget, six → twelve viewports
([`return-kept-budget-chromium.md`](../../examples/prototype/results/return-kept-budget-chromium.md),
[`-webkit`](../../examples/prototype/results/return-kept-budget-webkit.md),
[`-firefox`](../../examples/prototype/results/return-kept-budget-firefox.md)):

- Scrolling 10 or 20 pages back at 3600 CSS px/s got sharp about a second
  sooner in every browser and drew no base again (3 and 12 to 13 bases with
  six). Twenty-four viewports measured the same as twelve.
- Kept canvases peaked at 116 to 139 MiB instead of 62 to 72.
- Scrolling forward in Firefox with GPU-backed canvases on
  synthetic-text-1000.pdf at 3600 CSS px/s blocked the main thread about
  62 ms over four seconds instead of 44
  ([`scroll-kept12-fast2-firefox.md`](../../examples/prototype/results/scroll-kept12-fast2-firefox.md));
  every other browser and case stayed within the runs' spread. Accepted for
  what twelve viewports bring on the way back.

## Reopen if

Memory on phones shows a problem (whether iOS Safari counts kept canvases
toward its canvas memory cap is not verified), a way back the benchmark does
not cover needs more than twelve viewports, or the Firefox loss scrolling
forward grows.
