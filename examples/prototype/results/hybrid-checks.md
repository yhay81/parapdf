# ParaPDF hybrid engine: functional checks

Run on 2026-10-19 between 00:56 and 01:10 JST on the build from commit
`26bbfab` (Apple M2 Pro, Playwright's headless Chromium 156.0.8078.4, WebKit
27.2, and Firefox 157.0), with the hybrid engine (`ENGINE=hybrid` for the
existing checks). Every check passed in every browser. The same checks had
also passed on 2026-10-18 on the build before the cancellation fix, without
the zoom case. Firefox ran them again on 2026-10-19 around 15:00 JST at
devicePixelRatio 2 (see below), on a build identical to `26bbfab`'s, and
passed every check; its column shows that run.

| Check | What it covers | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| [`check-hybrid.ts`](../scripts/check-hybrid.ts) | Routing per page, lazy hayro load, pixels against pdf.js, OCR text on hayro pages, zoom | 30 / 30 | 30 / 30 | 30 / 30 |
| [`check-text.ts`](../scripts/check-text.ts) | Selection, search highlights, normalization, accessibility semantics | 15 / 15 | 15 / 15 | 15 / 15 |
| [`check-links.ts`](../scripts/check-links.ts) | Internal and external links, keyboard activation, back stack, outline | 11 / 11 | 11 / 11 | 11 / 11 |

What `check-hybrid.ts` found, the same in all three browsers:

- `bill-hr815.pdf` and `synthetic-vector-200k.pdf` render every page with
  pdf.js, and the hayro module is never requested; only the classifier module
  loads. The vector page is not decoded at all: its content stream is above
  the classifier's 256 KiB limit.
- `bunka-kokugo-series-019-p4.pdf`, `patent-us223898.pdf`, and
  `wdl6812-manuscript.pdf` render every mounted page with hayro, with no
  fallbacks. Page 1 differs from pdf.js's rendering by 0.5–1.2 of 255 per
  color channel on average (240 px wide thumbnails of the sharpest painted
  layer), so hayro draws the same content.
- On the patent, whose OCR text sits in rendering mode 3 (invisible), the
  text layer still comes from pdf.js: page 1 exposes "Electric-Lamp", a mouse
  drag selects it, and searching "Menlo Park" finds 2 matches. Zooming to
  150% re-renders page 1's detail layer with hayro at the new scale without a
  fallback: from 2,512 to 3,379 device pixels wide (the 16 MP cap) in all
  three browsers.

The text and link checks open only documents with text (`bill-hr815.pdf`,
`synthetic-cjk-nonembedded.pdf`, `synthetic-text-1000.pdf`, `usrguide.pdf`),
which the classifier sends to pdf.js, so they confirm that the hybrid engine
leaves text pages, search, and links unchanged.

Another session's server listened on 127.0.0.1:4186, the port
`check-links.ts` uses. Vite's preview then took 4186 on IPv6, and Firefox
connected to the other server and timed out on its first navigation (with
`ENGINE=pdfjs-next` as well). `check-links.ts` therefore ran with its preview
moved to port 4180 through a Node `--import` hook that rewrites the listen
port, without changing the script.

Firefox first ran these checks at devicePixelRatio 1, with detail canvases
of 1,256 and 1,884 device pixels in the zoom case: Playwright's Firefox 157
drops `deviceScaleFactor: 2` on cross-origin-isolated pages such as the demo.
The launcher now gives Firefox the contexts' ratio through its
`layout.css.devPixelsPerPx` pref, and the rerun above used it. Port 4186 was
free during the rerun, so `check-links.ts` ran unchanged.
