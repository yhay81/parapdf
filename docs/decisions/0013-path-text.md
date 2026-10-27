# 0013. Text drawn as paths (`disableFontFace`)

- Status: rejected
- Date: 2026-10-28

## Context

Issue #18. The knockout investigation found that in Chromium, with GPU
canvases (`enableHWA`), the first read of a canvas after a render could
wait about 17 ms for the GPU work the render queued, against about 1 ms at
lower resolutions. ParaPDF's renderer reads canvases right after drawing
them (copies into kept canvases, base demotion), so the wait lands on the
main thread when zooming in far.

The cost follows text, not canvas area: page 1 of bill-hr815.pdf at 2, 4,
and 6 device pixels per point flushes in about 1 ms, at 7 and 8 in about
18 ms, and a 5000×3360 region at 8 px/pt costs 17 ms over text and 0.2 ms
over the blank bottom of the page. It is Chromium drawing pdf.js's
FontFace glyphs at large sizes: with `disableFontFace`, which makes pdf.js
draw glyphs as paths it builds from the font data, the cost disappears.
In pdf.js master's renderer worker it moves into the render (33 ms
against 16 ms) and off the main thread.

Region sizing and scheduling cannot remove it: the cost is per glyph drawn
at that size, whatever the canvas, and the planner already draws only the
visible part of a page at that zoom. The one lever ParaPDF has is the
document option.

## Idea

Open documents with `disableFontFace: true` by default, in every browser
or in Chromium only.

## Evidence

2026-10-27 and 28, macOS, Apple M2 Pro, AC power; Playwright's Chromium
156, WebKit 27.2, and Firefox 157; pdfjs-dist 6.4.299 and pdf.js master
157d30e83.

- Flush by resolution, `bench/scripts/knockout-repro.ts` with `PROBE=1`
  and `PATH_TEXT` 0 and 1, Chromium, 5 renders each:
  `bench/results/flush-fontface-chromium.md`. FontFace text: read after
  render 0.9, 1.1, 0.9, 18.6, 18.4 ms at 2, 4, 6, 7, 8 px/pt; path text:
  0.5 to 0.6 ms throughout, render time unchanged (11 to 16 ms).
- Zoom commits, `commit-bench.ts` in Chromium with
  `documentOptions={"disableFontFace":true}` as a variant of the same
  build, 3 runs: `examples/prototype/results/fontface-commit-chromium.md`.
  Time to sharp after zooming from fit-width to 5: 43 ms with FontFace
  text, 27 ms with paths. The other scenarios move by a few ms either way;
  no blank or base-only frames in either.
- Rendering at 100% zoom, the engine benchmark with `pdfjs-hwa` and
  `pdfjs-hwa-pathtext`, seven files, 3 runs, each browser:
  `bench/results/pathtext-{chromium,webkit,firefox,browsers}.md`.
  - First page visible, cold: Chromium faster on bill-hr815 (83 → 67 ms)
    and slower on mhlw-doc, synthetic-text-1000, and the CJK document
    (+17 ms each); WebKit slower or level on all seven (bunka-kokugo 150 → 183,
    f1040 116 → 133, synthetic-text-1000 50 → 65 ms); Firefox slower on
    six (bunka-kokugo 155 → 197 ms).
  - Per-page visible p50, median across files: Chromium 50.0 → 50.3,
    WebKit 50.7 → 50.1, Firefox 50.4 → 59.5 ms.
  - Main thread blocked while rendering 10 pages, median across files:
    Chromium 24 → 8, WebKit 3 → 7, Firefox 40 → 49 ms (bill-hr815 48 →
    106, synthetic-text-1000 36 → 118).
- Fidelity, `bench/scripts/fidelity.ts` with
  `PAIRS=pdfjs-hwa:pdfjs-hwa-pathtext,pdfjs:pdfjs-pathtext`, each browser:
  `bench/results/pathtext-fidelity-*.md`. Pages without text are
  identical. With embedded fonts, Latin and Japanese, only glyph edges
  differ (2 to 6% of pixels in the quarter-size samples); side by side at
  full size they read the same. With non-embedded standard fonts the font
  changes: FontFace text uses the system's Helvetica, paths pdf.js's bundled
  Liberation Sans (about 9% of pixels on synthetic-text-1000).

## Consequences

ParaPDF keeps pdf.js's default, FontFace text. Paths win in Chromium where
text is drawn at 7 px/pt or more, and lose first-page and per-page render
time in WebKit and Firefox, and on CJK and text-heavy documents in
Chromium; a Chromium-only default would make the same document draw in
different fonts by browser. An application that zooms far in Chromium can
pass `configurePdfjs({ documentOptions: { disableFontFace: true } })`.

## Reopen if

- Chromium draws large FontFace glyphs without the flush (a Chromium
  release, measured with the same script).
- pdf.js's renderer worker ships in pdfjs-dist and ParaPDF moves to it:
  the cost then leaves the main thread and becomes render time, which
  the commit and zoom benchmarks would measure again.
- A per-document or per-zoom choice becomes possible in pdf.js (paths only
  above a size), which would keep FontFace text at reading zooms.
