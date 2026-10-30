# ParaPDF

A fast PDF viewer for React, built on [pdf.js](https://github.com/mozilla/pdf.js):
React out of the hot path, and drawing off the main thread wherever pdf.js
allows it.

The name combines the Japanese "parapara", flipping quickly through pages,
with parallel rendering on worker threads.

> **Status: 0.x.** [`parapdf`](packages/parapdf) is on npm, and its API may
> change in any minor release until 1.0.

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

[parapdf.yhay81.com](https://parapdf.yhay81.com) has the guides, the API
reference, and a [live demo](https://parapdf.yhay81.com/demo/).
[`CHANGELOG.md`](CHANGELOG.md) lists the releases.

## What it is

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame, and pixels never pass through React.
- **Only what is near the viewport exists.** Pages outside a small window
  unmount, draw a quick base first and full resolution once scrolling
  settles, and keep their canvases within a budget so a page the reader
  comes back to shows at once.
- **Viewers of their own.** Several viewers and thumbnails share one open
  document, each with its own position, zoom, rotation, and layout.
- **A document viewer.** Selectable, accessible text, search, links and the
  outline, forms, annotations, printing, saving, layers, attachments, and
  encrypted documents. Each feature is a module only applications using it
  load.
- **pdf.js included.** The package ships pdf.js's worker and the files it
  loads on demand, so applications configure nothing.

Every choice that may affect speed or memory is measured; the
[performance page](https://parapdf.yhay81.com/about/performance/) has the
numbers, and [`docs/decisions/`](docs/decisions/) the records behind them.

## Develop it

A pnpm workspace for Node 24 or later: the package in
[`packages/parapdf`](packages/parapdf), the demo with its functional checks
and benchmarks in [`examples/prototype`](examples/prototype), the engine
benchmark in [`bench`](bench), and the documentation site in [`site`](site).
[`docs/architecture.md`](docs/architecture.md) describes the design,
[`AGENTS.md`](AGENTS.md) the layout and commands,
[`CONTRIBUTING.md`](CONTRIBUTING.md) what a pull request needs, and
[`SECURITY.md`](SECURITY.md) how to report a vulnerability.

```bash
pnpm install
pnpm check
pnpm test
pnpm --filter @parapdf/bench exec playwright install chromium webkit firefox
pnpm --filter @parapdf/bench corpus
pnpm --filter @parapdf/prototype build
ENGINE=pdfjs pnpm --filter @parapdf/prototype check:text
```

## License

[MIT](LICENSE). Parts of ParaPDF are derived from pdf.js, licensed under the
Apache License 2.0: see [NOTICE.md](NOTICE.md).
