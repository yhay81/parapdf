# ParaPDF hybrid engine: functional checks

Run on 2026-10-19 between 00:56 and 01:10 JST on the build from commit
`26bbfab` (Apple M2 Pro, Playwright's headless Chromium 156.0.8078.4, WebKit
27.2, and Firefox 157.0), with the hybrid engine (`ENGINE=hybrid` for the
existing checks). Every check passed in every browser. The same checks had
also passed on 2026-10-18 on the build before the cancellation fix, without
the zoom case.

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
  fallback: from 2,512 to 3,379 device pixels wide (the 16 MP cap) in
  Chromium and WebKit, from 1,256 to 1,884 in Firefox (see below).

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

Firefox ran these checks at devicePixelRatio 1: Playwright's Firefox 157
ignores `deviceScaleFactor: 2` on cross-origin-isolated pages (a minimal page
reports 2 without COOP and COEP and 1 with them), and the demo is
cross-origin isolated. Firefox's canvases therefore hold a quarter of the
pixels that Chromium's and WebKit's hold. The checks do not depend on the
resolution, but cross-browser timings from the demo do.
