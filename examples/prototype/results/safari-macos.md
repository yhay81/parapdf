# The functional checks and the preload in Safari on macOS

Safari 27.0.1 on macOS 27.0.1 (26A434), Apple silicon, on AC power, driven
through safaridriver by `bench/scripts/safari.ts` (`BROWSER=safari`), with
`ENGINE=pdfjs` (pdfjs-dist 6.4.299) and the demo built from `main` after
0.7.0. Playwright's WebKit 27.2, Firefox 157.0, and Chromium 156.0.8078.4
ran the preload scripts for comparison.

## Functional checks

| Check | Passed | Failed | Then |
| --- | --- | --- | --- |
| lifecycle | 11 | 0 | |
| document | 46 | 0 | |
| options | 29 | 0 | |
| viewers | 15 | 0 | |
| rotation | 10 | 0 | |
| scroll | 66 | 0 | throws at the touch part (`hasTouch`) |
| text | 41 | 2 | |
| links | 9 | 1 | throws at the routed part |
| features | 12 | 0 | throws at the downloads (`waitForEvent`) |
| annotations | 30 | 1 | throws at the routed part |
| pinch, bundle, bundlers | | | need touch, CDP, or request events |

The four failures come from safaridriver, not from ParaPDF:

- text, "dragging across the gap…" and "1 px steps…": they read the
  selection while the button is down. Safari ends a drag at the end of each
  action sequence, so the harness sends the press, the moves, and the
  release as one, and the page cannot be read in between.
- links, "Alt+Left goes back": WebDriver's Alt with ArrowLeft reaches the
  page as `key "\x1C"` with `altKey`, not as `ArrowLeft`.
- annotations, "choosing another tool while typing keeps the text and the
  new tool": after key actions, safaridriver delivers the next clicks with
  `buttons` 0 and their events out of order (`pointerup` before
  `pointerdown`), or the press as a `pointermove` with `buttons` 1, so
  pdf.js's editor layer sees no press and adds no second text. A plain page
  shows the same after typing into an input; neither releasing the input
  state (`DELETE /actions`) nor sending a pointer source with the keys
  restores it.

The rotation check failed once before a fix in the check: its link part
clicked the toolbar before the outline's button arrived and moved it, a
race Playwright wins by being faster. It now waits for that button.

## The preload (issue #14)

`scripts/preload-reuse.ts`, bill-hr815.pdf (360,076 bytes) from the demo's
preview server on 127.0.0.1, the first page's pixels counted from the
navigation:

| Browser | Cache-Control | Cold | Warm |
| --- | --- | --- | --- |
| Safari 27.0.1 | no-cache | 2 × 200, 617 ms | 2 × 200, 314 ms |
| Safari 27.0.1 | max-age=3600 | 2 × 200, 617 ms | 2 × 200, 368 ms |
| WebKit 27.2 | no-cache | 2 × 200, 670 ms | 2 × 200, 216 ms |
| WebKit 27.2 | max-age=3600 | 2 × 200, 500 ms | 2 × 200, 205 ms |
| Firefox 157.0 | no-cache | 1 × 200, 716 ms | 1 × 304, 214 ms |
| Firefox 157.0 | max-age=3600 | 1 × 200, 355 ms | none, 215 ms |
| Chromium 156 | no-cache | 1 × 200, 318 ms | 1 × 304, 147 ms |
| Chromium 156 | max-age=3600 | 1 × 200, 580 ms | none, 139 ms |

Safari downloads the PDF twice, even when it may cache it. The reason, from
`scripts/preload-timing.ts`, which needs neither ParaPDF nor pdf.js: a page
preloads a 300,000-byte file its server sends over a second and fetches it
with pdf.js's fetch options after a delay.

| Fetch after | Safari 27.0.1 | WebKit 27.2 | Firefox 157.0 | Chromium 156 |
| --- | --- | --- | --- | --- |
| 0 ms | 2 | 2 | 1 | 1 |
| 50 ms | 2 | 2 | 1 | 1 |
| 300 ms | 2 | 2 | 1 | 1 |
| 700 ms | 2 | 2 | 1 | 1 |
| 1500 ms | 1 | 2 | 1 | 1 |

Safari gives a fetch the preloaded response only once the preload has
finished; a fetch while it still downloads, the headers already in,
downloads the file again. Chromium and Firefox join the download.
Playwright's WebKit never reuses it. pdf.js asks for the PDF as soon as it
has loaded, so in Safari the preload of a PDF that takes longer to download
than pdf.js to load is a second download. The preload's mode matches pdf.js's
request (`cors`, `same-origin` credentials) and the page's cross-origin
isolation changes nothing: a page without it gives the same counts.
