# 0013. Text drawn as paths (`disableFontFace`) by default

- Status: rejected
- Date: 2026-10-28

## Decision

ParaPDF keeps pdf.js's default, FontFace text. In Chromium with GPU-backed
canvases, the first read of a canvas after drawing FontFace text at 7 device
pixels per point or more waits about 17 ms for the GPU, on the main thread
when zooming in far; drawing glyphs as paths (`disableFontFace`) removes
that wait but loses first-page and per-page render time in WebKit and
Firefox, and on CJK and text-heavy documents in Chromium. A Chromium-only
default would make the same document draw in different fonts by browser.

An application that zooms far in Chromium can pass
`configurePdfjs({ documentOptions: { disableFontFace: true } })`.

## Evidence

- Read after render in Chromium: 0.9 to 1.1 ms at 2 to 6 px/pt, 18.4 to
  18.6 ms at 7 and 8; with paths 0.5 to 0.6 ms throughout
  ([`flush-fontface-chromium.md`](../../bench/results/flush-fontface-chromium.md)).
- Zoom commit from fit-width to 5 in Chromium: sharp after 43 ms with
  FontFace text, 27 with paths
  ([`fontface-commit-chromium.md`](../../examples/prototype/results/fontface-commit-chromium.md)).
- At 100% zoom, seven files, 3 runs
  ([`pathtext-browsers.md`](../../bench/results/pathtext-browsers.md)):
  per-page visible p50 in Firefox 50.4 → 59.5 ms; main thread blocked over
  10 pages in Firefox 40 → 49 ms and in WebKit 3 → 7, in Chromium 24 → 8;
  first page in WebKit slower or level on all seven files.
- Fidelity: with embedded fonts only glyph edges differ; with non-embedded
  standard fonts the font changes (system Helvetica against pdf.js's
  Liberation Sans)
  ([`pathtext-fidelity-chromium.md`](../../bench/results/pathtext-fidelity-chromium.md)).

## Reopen if

- Chromium draws large FontFace glyphs without the wait.
- ParaPDF moves to pdf.js's renderer worker, where the cost becomes render
  time off the main thread.
- pdf.js allows paths only above a size, which would keep FontFace text at
  reading zooms.
