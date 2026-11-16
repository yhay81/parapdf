# ParaPDF

A fast, customizable **React PDF viewer**, built on
[pdf.js](https://github.com/mozilla/pdf.js). Virtualized pages, text selection,
search, forms, and annotations, with your own React UI.

[**Try 1,000 pages →**](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf)
· [Documentation](https://parapdf.yhay81.com/getting-started/)
· [Performance](https://parapdf.yhay81.com/about/performance/)
· [npm](https://www.npmjs.com/package/parapdf)

[![ParaPDF: Long PDFs. Your React UI. The live demo shows page 500 of a 1,000-page PDF.](.github/assets/social-preview.png)](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf)

The demo needs no account. Try the
[1,000-page document](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf),
a [fillable form](https://parapdf.yhay81.com/demo/?file=f1040.pdf), or
[Japanese text](https://parapdf.yhay81.com/demo/?file=mhlw-doc.pdf).
You can also open your own PDF; the demo reads it locally in your browser.

## Start with two components

Requires React and React DOM 19.3 or later.

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

Give the viewer a definite height and serve a PDF at the source URL.
ParaPDF ships pdf.js's worker and assets; Vite, webpack, Rsbuild, and
Next.js emit them with your build. See
[bundler setup](https://parapdf.yhay81.com/setup/bundlers/) for other bundlers.

You build the toolbar and surrounding UI. The
[controls guide](https://parapdf.yhay81.com/guides/controls/) shows how.

> **Status: 0.x.** The API may change in any minor release until 1.0.
> The [documentation site](https://parapdf.yhay81.com) follows the published
> npm package; `main` may contain unreleased API changes. See the
> [changelog](CHANGELOG.md) and [limitations](https://parapdf.yhay81.com/about/limitations/).

## Why ParaPDF?

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame, and pixels never pass through React.
- **Long documents, bounded rendering.** Pages outside a small window
  unmount. Visible pages draw a quick base first and full resolution once
  scrolling settles. Canvas budgets also cover pages kept for a return visit.
- **Viewers of their own.** Several viewers and thumbnails share one open
  document, each with its own position, zoom, rotation, and layout.
- **A document viewer.** Selectable, accessible text, search, links and the
  outline, forms, annotations, printing, saving, layers, attachments, and
  encrypted documents. Each feature is a module only applications using it
  load.
- **Your interface.** Compose controls, form state, and selection with React
  instead of building a bridge to an iframe.

## Performance, with the trade-offs

An existing comparison with **react-pdf + react-window**, with both viewers
virtualizing pages: a 110-page PDF at 900 CSS px/s for four seconds, five
runs, medians, Chromium 156 on an Apple M2 Pro, October 28, 2026.

| Measurement | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| First paint | 142 ms | 187 ms |
| React commits during the scroll | 4 | 10 |
| Canvas memory after settling | 183 MiB | 217 MiB |
| Main-thread blocked time | 17 ms | 5 ms |

ParaPDF painted sooner and held less canvas memory in this case, but
blocked the main thread longer. These are historical results, not a
benchmark of today's `main`. The stacks used different pdf.js versions
(6.4.299 and 6.3.289); canvas memory is not total process memory.
[Full results and reproduction command](examples/prototype/results/compare-react-pdf-110-chromium.md),
[comparison decision](docs/decisions/0017-measured-against-react-pdf.md), and
[results across browsers](https://parapdf.yhay81.com/about/performance/).

## Help shape it

If ParaPDF would be useful in your app, **star this repository to find it
again**. Tried it with a real document? A
[bug report](https://github.com/yhay81/parapdf/issues/new?template=bug_report.yml)
or [feature request](https://github.com/yhay81/parapdf/issues/new?template=feature_request.yml)
helps decide what to work on next. Share only documents you are allowed to
make public; see [security reporting](SECURITY.md) for vulnerabilities.

The name combines the Japanese "parapara", flipping quickly through pages,
with parallel rendering on worker threads.

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

[Apache License 2.0](LICENSE). Parts of ParaPDF are derived from pdf.js:
see [NOTICE.md](NOTICE.md).
