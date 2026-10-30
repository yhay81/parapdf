# 0005. Frame display (OffscreenCanvas, ImageBitmap, bitmaprenderer)

- Status: rejected
- Date: 2026-10-24

## Decision

Pages draw into their canvases in place. Drawing each page into an
OffscreenCanvas and showing the result as an ImageBitmap through a
`bitmaprenderer` canvas, so that a canvas never hides while it draws, is not
done: it is never faster, it is slower in Chromium after zooming, and the
spare canvas already swaps details in one step.

## Evidence

- Engine benchmark, `-frame` variants against drawing in place, 14 files,
  3 runs, median across files
  ([`frames-browsers.md`](../../bench/results/frames-browsers.md)): first
  page committed within 1 to 3 ms either way; main thread blocked over ten
  pages on CPU canvases 29 against 19 ms in Chromium.
- Zoom commits in Chromium got sharp 6 to 29 ms later in every scenario but
  the pinches in
  ([`commit-frames-chromium.md`](../../examples/prototype/results/commit-frames-chromium.md));
  WebKit matched drawing in place.
- Coming back to pages, frames blocked Firefox's main thread longer: 135
  against 70 ms over a scroll back on the vector pages
  ([`return-frames-firefox.md`](../../examples/prototype/results/return-frames-firefox.md)).

## Reopen if

Chromium's cost after zoom commits is explained and removed, or pdf.js's
renderer worker ships and its frames could be shown without the copy it
makes now.
