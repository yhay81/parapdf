# 0005. Frame display (OffscreenCanvas, ImageBitmap, bitmaprenderer)

- Status: rejected
- Date: 2026-10-24

## Idea

Draw each page into an OffscreenCanvas and show the finished drawing as an
ImageBitmap through a `bitmaprenderer` canvas, which replaces what it shows
in one step: no canvas would hide while it draws, a new detail would need
no spare canvas, and kept drawings could move without copies.

## Evidence

The result files are on branch `claude/frame-bench`.

- pdf.js draws into an OffscreenCanvas as it is, and pdf.js master's
  renderer worker copies its frames into one; neither needs a patch.
- Engine benchmark, `-frame` variants (`bench/results/frames-*.md`; 14
  files, 3 runs, median across files), frames against drawing in place:

  | | Chromium | WebKit | Firefox |
  |---|---:|---:|---:|
  | First page committed, GPU canvases (ms) | 51.2 / 51.9 | 58.5 / 57.7 | 57.7 / 60.8 |
  | Main thread blocked over ten pages, GPU (ms) | 5 / 5 | 0 / 0 | 30 / 24 |
  | Main thread blocked over ten pages, CPU (ms) | 29 / 19 | 1 / 1 | 30 / 28 |
  | Handover per page, GPU / CPU (ms) | 1.2 / 6.5 | 0.1 / 0.1 | 1.5 / 1.45 |

- In Chromium on f1040.pdf and synthetic-cjk-nonembedded.pdf, drawings
  differed only in hairlines, in at most 0.04% of a 256-pixel-wide sample,
  by up to 40 levels, about as much as two runs of the same GPU drawing
  differ (0.01%, 30 levels) (`bench/scripts/fidelity.ts`).
- Runtime, zoom commits (`commit-bench.ts`, three runs, medians): no blank
  page and no page down to its base without the spare canvas, but in
  Chromium the pages got sharp later in every scenario except the two
  pinches in, by 6 to 29 ms (`examples/prototype/results/commit-frames-chromium.md`),
  and by 9 to 27 ms with OffscreenCanvases kept for later frames
  (`commit-frames-pool-chromium.md`). WebKit matched drawing in place.
- Coming back to pages (`return-bench.ts`, `return-frames-*.md`), frames
  alone matched drawing in place; in Firefox they blocked the main thread
  over a scroll back 28 to 105 ms against 28 to 74.

## Why rejected

It is never faster, it is slower in Chromium after zooming, and the spare
canvas already swaps details in one step. The code was not kept.

## Reopen if

Chromium's cost after zoom commits is explained and removed, or pdf.js's
renderer worker ships and its frames could be shown without the copy it
makes now.
