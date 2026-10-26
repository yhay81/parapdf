# ParaPDF

A fast PDF viewer for React, built on [pdf.js](https://github.com/mozilla/pdf.js):
React out of the hot path, and drawing off the main thread wherever pdf.js
allows it.

The name combines the Japanese "parapara", flipping quickly through pages,
with parallel rendering on worker threads.

> **Status: 0.x, experimental.** [`parapdf`](packages/parapdf) is on npm,
> and its API may change in any minor release until 1.0.

## Use it

```bash
npm install parapdf
```

```tsx
import { PdfDocument, PdfViewer } from "parapdf";

export function App() {
  return (
    <PdfDocument source="/manual.pdf">
      <PdfViewer style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

[parapdf.yhay81.com](https://parapdf.yhay81.com) has guides with examples
that run, and a [live demo](https://parapdf.yhay81.com/demo/) to open your
own PDFs in. [`packages/parapdf/README.md`](packages/parapdf/README.md) is
the whole usage and API guide on one page. [`CHANGELOG.md`](CHANGELOG.md)
lists the releases, and every change for upgrading from 0.4 or earlier.

## What it is

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame: React renders when the set of mounted pages or the
  current page changes, and pixels never pass through React.
- **Only what is near the viewport exists.** Pages outside a small window
  unmount. A page draws a quick low-resolution base first and full device
  resolution once scrolling settles, and at high zoom only its visible part
  sharp, within pixel budgets you can set. A page that unmounts keeps its
  canvases, within a budget, so a page the reader comes back to shows at
  once.
- **Viewers of their own.** Each viewport is a viewer with its own position,
  zoom, rotation, and layout; several of them, and thumbnails, share one
  open document. Their props are live: changing any of them needs no
  remount.
- **A document viewer.** Selectable, accessible text; whole-document search
  that matches as pdf.js's viewer does, CJK text included; links, the
  outline, and back and forward; fillable forms, annotations the reader
  creates, printing, saving, layers, attachments, encrypted documents,
  spreads, and pdf.js's scroll modes. Each feature is a module that only
  applications using it load.
- **pdf.js included.** The package ships pdf.js's worker and the files it
  loads on demand, so applications configure nothing.
- **Documents, not drawings.** ParaPDF shows PDFs as documents: reading,
  search, selection, links, annotations, and forms. It has no scales or
  measuring tools.

## Measurements

Every choice that may affect speed or memory is measured against the build
before it, in the same run, in Playwright's headless Chromium, WebKit, and
Firefox; Playwright's WebKit is not Safari, and Safari itself is not
measured yet. The records, with wins and losses, are in
[`docs/decisions/`](docs/decisions/); the results in
[`examples/prototype/results/`](examples/prototype/results/) (the viewer)
and [`bench/results/`](bench/results/) (the engines).

- **pdf.js as the only engine** ([decision 0001](docs/decisions/0001-pdfjs-only.md)).
  On 14 PDFs, released pdf.js is 404 KiB brotli against 1,645 KiB for
  PDFium and 1,364 KiB for hayro, compiled to WebAssembly; it alone draws
  Japanese text in fonts the PDF does not embed, and it is fastest on
  200,000 vector segments
  ([`bench/results/chromium.md`](bench/results/chromium.md),
  [`browsers.md`](bench/results/browsers.md)).
- **Pages that come back** ([decision 0004](docs/decisions/0004-kept-canvases.md)).
  Going back from page 13 to page 1 of bill-hr815.pdf got sharp after 3 ms
  instead of 23 in Chromium, 11 instead of 27 in WebKit, and 38 instead of
  176 in Firefox, once pages kept their canvases.
- **React's commits** ([decision 0011](docs/decisions/0011-react-api.md)).
  Over four seconds of scrolling, React committed exactly when the mounted
  window or the current page changed (4 to 24 times), in all three
  browsers, with no blank area.
- **What was tried and rejected**: frame display through `OffscreenCanvas`
  and `ImageBitmap` (0005), pdf.js's partial rendering of regions (0006),
  keeping unmounted pages' parsed content (0007), and copying a whole-page
  detail into the base past its budget (0008).

The notes of Phase 0, the engine benchmark and the first measurements of
the runtime, are in this README as of the tag
[`v0.4.0`](https://github.com/yhay81/parapdf/blob/v0.4.0/README.md).

## Develop it

The repository is a pnpm workspace for Node 24 or later: the package in
[`packages/parapdf`](packages/parapdf), a demo with benchmarks and functional
checks in [`examples/prototype`](examples/prototype), the engine benchmark
in [`bench`](bench), and the documentation site in [`site`](site).
[`docs/rebuild/target.md`](docs/rebuild/target.md) describes the design,
[`AGENTS.md`](AGENTS.md) the layout and every command,
[`CONTRIBUTING.md`](CONTRIBUTING.md) what a pull request needs, and
[`SECURITY.md`](SECURITY.md) how to report a vulnerability.

```bash
pnpm install
pnpm check
pnpm test
pnpm --filter parapdf typecheck
pnpm --filter @parapdf/bench exec playwright install chromium webkit firefox
pnpm --filter @parapdf/bench corpus
pnpm --filter @parapdf/prototype build
ENGINE=pdfjs pnpm --filter @parapdf/prototype check:text
```

`pnpm typecheck` covers the benchmark too, which needs its Rust build
(`pnpm bench:build`) first. The functional checks run on pdf.js master's
renderer worker by default, which `bench/scripts/build-pdfjs-next.sh` builds;
`ENGINE=pdfjs` runs them on released pdfjs-dist.

## License

[MIT](LICENSE). Parts of ParaPDF are derived from pdf.js, licensed under the
Apache License 2.0: see [NOTICE.md](NOTICE.md).
