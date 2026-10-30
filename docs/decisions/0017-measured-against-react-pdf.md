# 0017. ParaPDF is measured against react-pdf

- Status: adopted
- Date: 2026-10-28

## Decision

Speed claims against other viewers point at a measured comparison with
react-pdf, the most used React PDF component, also built on pdf.js. The
demo's `compare.html` shows a document with react-pdf, and `scroll-bench.ts`
measures it with the same job as ParaPDF:

- `VARIANTS=react-pdf`: a `<Page>` for every page, as react-pdf's
  documentation shows.
- `VARIANTS=react-pdf-window`: only the rows react-window mounts, the usual
  way to show a long document with react-pdf.

Both fit pages to ParaPDF's fit-width with its 12 px gap, and size every
page as the first. Blank area uses ParaPDF's definition; the report adds
canvas memory at 4 bytes a pixel, kept canvases included. react-pdf 11.0.0
(with its own pdfjs-dist 6.3.289) and react-window 2.5.1 are exact-pinned
devDependencies of the demo only. The pdf.js versions differ, so the results
compare viewer stacks, not viewers alone.

## Evidence

`scroll-bench.ts`, 5 runs, 900 and 3600 CSS px/s for 4 s, variants job by
job ([`compare-react-pdf-110-chromium.md`](../../examples/prototype/results/compare-react-pdf-110-chromium.md),
[`compare-react-pdf-1000-chromium.md`](../../examples/prototype/results/compare-react-pdf-1000-chromium.md),
and the `-webkit` and `-firefox` files beside them). bill-hr815.pdf (110
pages) at 900 CSS px/s in Chromium:

| Variant | First paint | Blocked | Commits | Canvas memory |
| --- | ---: | ---: | ---: | ---: |
| ParaPDF | 142 ms | 17 ms | 4 | 183 MiB |
| react-pdf, every page | 278 ms | 488 ms | 3 | 3972 MiB |
| react-pdf, windowed | 187 ms | 5 ms | 10 | 217 MiB |

- No variant left visible pages blank. Against the windowed variant,
  ParaPDF painted first sooner in every job but one (WebKit, 1000 pages,
  3600 px/s: 212 against 203 ms), committed React less than half as often,
  and held less canvas memory everywhere.
- At 900 CSS px/s ParaPDF blocked the main thread longer in Chromium (17
  against 5 ms on 110 pages) and in Firefox (63 against 44), where both build
  text and link layers; Firefox's cost follows pdf.js's `measureText` in
  text layers (decisions 0018 and 0020). At 3600 px/s it blocked less or the
  same, postponing layers that react-pdf builds.
- react-pdf with every page mounted did not finish a Firefox job on
  bill-hr815.pdf within 120 s.

The results do not support "faster in every browser".

## Reopen if

react-pdf or react-window change how they render or virtualize pages, or a
viewer with another approach becomes a common choice.
