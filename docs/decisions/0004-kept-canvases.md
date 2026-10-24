# 0004. Pages keep their canvases when they unmount

- Status: adopted
- Date: 2026-10-24
- Implemented on branch `claude/frame-bench` (not yet in `rebuild`; M1
  brings it in)

## Context

A page that left the mounted window (the visible pages and two overscan
pages each way) zeroed its canvases and released pdf.js's page data, so
going back to it, by a link's `back()`, by scrolling back, or by flipping
back, drew it again from nothing.

## Decision

A page that unmounts keeps its canvases as they are, up to `maxKeptPixels`
(by default six viewports' worth of device pixels; 0 keeps none). When the
page mounts again, they are drawn into its new canvases, one GPU copy each,
and it shows at once; canvases mounted again as they are, as React's
StrictMode does, stay untouched. Over the budget, the least recently kept
go, but only after the pages mounting in the same React commit took theirs
back: React unmounts pages before it mounts others, and trimming at once
let a jump away and back drop the very pages it came back to. Within
`maxCanvasPixels`, kept canvases count as canvases and go before any page's.

## Evidence

The scripts and result files are on branch `claude/frame-bench`. The
return benchmark (`examples/prototype/scripts/return-bench.ts`) ran at
820×1000, devicePixelRatio 2, and fit-width, with pdf.js drawing on the
main thread into GPU-backed canvases, three runs of each variant in turn
with the build before (e10dcc4); medians.

| Way back, sharp after (ms) | File | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| page 13 → page 1 | bill-hr815.pdf | 23 → 8 | 35 → 8 | 184 → 28 |
| page 13 → page 1 | synthetic-vector-pages.pdf | 167 → 6 | 173 → 2 | 166 → 23 |

- On the way back from page 13, nothing was drawn and no frame showed a
  blank page.
- Scrolling ten pages back at 3600 CSS px per second drew 3 bases instead
  of 7, and flipping eight pages back 50 ms apart drew 1 or 2 details
  instead of 6, with the same blank area and sharpness on screen, except a
  mean sharpness of 0.59 instead of 0.51 while scrolling back over the
  vector pages: the default budget keeps the pages scrolled past rather
  than the sharp ones the scroll started from.
- Kept canvases held 58 to 65 MiB.
- Keeping the elements adds no work when pages unmount. Copies instead
  (`createImageBitmap()`) cost Firefox 2 to 4 ms per 3.6 MP 2D canvas
  (`bench/scripts/frame-ops.ts`); in the frame experiment (0005), keeping
  copies blocked Firefox's main thread 81 to 176 ms over a scroll back,
  against 28 to 105 without them and 28 to 74 drawing in place. With kept
  elements, the same scroll back blocked it 47 ms against 70 before on
  bill-hr815.pdf, and 75 against 63 on the vector pages.

## Consequences

- M5: the renderer owns the page DOM, so a kept canvas moves into the
  page's new host without a copy.
- Open, with no decision yet: the default budget (more keeps more of a long
  scroll back, at more memory), and whether iOS Safari counts kept canvases
  toward its canvas memory cap (not verified; needs a device).

## Reopen if

Memory on phones shows a problem, or a budget measured on a long scroll
back pays for its memory.
