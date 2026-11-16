# Building a React PDF viewer for huge documents with ParaPDF

I'm building [ParaPDF](https://github.com/yhay81/parapdf), an Apache-2.0 React
PDF viewer based on pdf.js. It handles page virtualization, navigation,
zooming, and canvas reuse while leaving the toolbar and surrounding UI to
the application.

This article was written with AI assistance, using the project's source
code and recorded benchmark results.

You can open the [1,000-page demo](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf)
without signing up. The demo can also open a local PDF in your browser
without uploading it. Its toolbar is an example application; ParaPDF itself
provides the components and controls for building your own interface.

## A page component is the beginning of a viewer

[react-pdf](https://github.com/wojtekmaj/react-pdf) makes displaying a PDF
page straightforward with `Document` and `Page`. Its
[FAQ recommends virtualization](https://github.com/wojtekmaj/react-pdf/wiki/Frequently-Asked-Questions#rendering-pdf-is-too-slow-what-can-i-do)
for large documents. Adding react-window keeps the number of mounted pages
under control.

A continuous PDF reader needs more coordination around those components:

- Map PDF page dimensions and the current zoom to list row heights.
- Preserve the reading position when zooming changes those heights.
- Connect page-number inputs, outlines, and internal links to the virtual list.
- Decide which pages draw first and how much canvas memory to retain.
- Coordinate pdf.js's worker, fonts, and other files with the application's build.

For example, zooming halfway through page 400 needs more than a new
`scale` prop. The layout changes, and the viewer must keep the same document
point under the reader's eyes. An internal link may target a page that has
not been mounted yet.

There is also a difference between caching the PDF's data and keeping its
rendered pixels. In the version used for this comparison, react-pdf 11.0.0
[releases a page's canvas when it unmounts](https://github.com/wojtekmaj/react-pdf/blob/v11.0.0/packages/react-pdf/src/Page/Canvas.tsx).
Mounting that page again means drawing it again, even if its PDF data is
already cached.

ParaPDF puts these viewer responsibilities together on top of pdf.js.

## A small React integration

ParaPDF 0.9.0 requires React and React DOM 19.3 or later:

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

Serve a PDF at `/manual.pdf` and give the viewport a definite height.
The package ships pdf.js's worker and its supporting assets. Vite,
webpack, Rsbuild, and Next.js emit them with the application build; other
bundlers have a [separate setup path](https://parapdf.yhay81.com/setup/bundlers/).

The [controls guide](https://parapdf.yhay81.com/guides/controls/) shows how
to connect an application's buttons and inputs. Features include text
selection, search, links, forms, and annotations.

## What the viewer controls

ParaPDF mounts a window of pages around the viewport. It prioritizes visible
pages, draws a base image first, and refines the image when scrolling
settles. At high zoom, it concentrates detailed drawing on the visible
region within the canvas budget.

When a page leaves the mounted window, its canvases can remain in a bounded
cache. Returning to that page reuses those pixels if they are still cached.
This avoids making the mounted React tree and the retained pixel cache the
same thing.

Scrolling and zooming do not commit React state every frame. React updates
when the mounted page window or current page changes; the pixels stay out
of React state.

## Comparing with a virtualized react-pdf viewer

On November 16, 2026, I compared the code released as ParaPDF 0.9.0 with
react-pdf 11.0.0 plus react-window 2.5.3. Both viewers virtualize pages and
enable text and link layers.

Here is one condition: a generated 1,000-page text document, scrolling from
the beginning at 3,600 CSS pixels per second for four seconds. These are
five-run medians in headless Chromium 158.0.8127.18 on an Apple M2 Pro with
32 GiB of RAM, a 1280×900 viewport, and devicePixelRatio 2. Values are
rounded to integers.

| Measurement | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| First paint | 162 ms | 180 ms |
| React commits during scrolling | 25 | 43 |
| Estimated canvas memory at the sample | 111 MiB | 249 MiB |
| Main-thread blocked time during scrolling | 51 ms | 17 ms |

That is about 42% fewer React commits and 55% less estimated canvas memory
at that sample. **Main-thread blocked time was worse for ParaPDF in this
condition.** Fewer React updates do not automatically mean less main-thread
work.

The complete comparison covers Chromium, Playwright WebKit, and Firefox;
two text-focused documents; and two scroll speeds. Each condition has five
runs for each viewer, for 120 primary jobs. All 12 conditions had fewer
React commits and fewer retained canvas pixels with ParaPDF. Blocking
results varied by browser and workload. Playwright WebKit is not Safari.

These measurements have limits:

- First paint may be ParaPDF's low-resolution base, not an equally sharp page.
- Canvas memory estimates four bytes per canvas pixel, including retained
  canvases. It is sampled after scrolling and after visible blanks fill,
  without waiting for all refinement and DOM layers. It is not total
  browser memory.
- Blocked time sums timer delays during scrolling. It excludes work
  deferred until scrolling stops and is not the length of one freeze.
- ParaPDF uses pdf.js 6.5.438; the react-pdf setup uses 6.3.289. This is a
  comparison of the complete stacks and their drawing policies.
- Four seconds near the beginning of a 1,000-page document does not test
  traversing every page. Mixed page sizes, zooming, and return visits need
  separate measurements. These two text-focused PDFs do not represent
  every image-heavy or complex vector document.

The [complete results, source commit, individual runs, and reproduction steps](https://github.com/yhay81/parapdf/blob/6ccee90f27095494bd9c441c2c3e846d45ddc86f/examples/prototype/results/compare-react-pdf-20261116.md)
are public, including the repeat runs and the conditions where ParaPDF lost.

## A viewer with room for your application's UI

ParaPDF combines PDF-specific virtualization, navigation, and drawing
control so applications can concentrate on their own interface. The
measurements show a reduction in React updates and retained canvas pixels
under the tested conditions, with trade-offs in when rendering work happens.

The package is still 0.x, so minor releases may change the API. The
[documentation](https://parapdf.yhay81.com/getting-started/) follows the npm
release. If the project fits a future application, a
[GitHub star](https://github.com/yhay81/parapdf) is a useful way to find it again.

The [Japanese article](https://zenn.dev/yhay81/articles/202611-parapdf)
covers the same implementation problem and comparison.
