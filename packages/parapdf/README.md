# ParaPDF

A fast PDF viewer for React, built on [pdf.js](https://github.com/mozilla/pdf.js).

> **Status: 0.x, experimental.** The API may change in any minor release
> until 1.0. See the [changelog](https://github.com/yhay81/parapdf/blob/main/CHANGELOG.md)
> and the [measurements](https://github.com/yhay81/parapdf#phase-0) behind the
> design.

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame: React renders only when the set of mounted pages or the
  current page changes, and pixels reach canvases through refs.
- **Only what is near the viewport exists.** Pages outside a small window are
  unmounted and give their canvas memory back. Each page draws a quick
  low-resolution base first and full device resolution once scrolling
  settles; at high zoom only the visible part is drawn sharp, within pixel
  budgets you can set for memory-capped browsers such as iOS Safari.
- **A real document.** pdf.js text layers make pages selectable and readable
  by screen readers; whole-document search matches the way pdf.js's own
  viewer does, Japanese and other CJK text included; links, the outline, and
  a back stack navigate within the document.
- **Gestures.** Ctrl or ⌘ with the wheel, trackpad pinches, touch pinches,
  and Safari's gesture events zoom the document instead of the page.

## Install

```bash
npm install parapdf pdfjs-dist
```

ParaPDF needs React 19.2 or later and pdfjs-dist 6. pdf.js is a peer
dependency: your application owns its version and passes the module in.

## Quick start

With [Vite](https://vite.dev):

```tsx
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createPdfjsEngine, PdfDocument, PdfViewport } from "parapdf";

// One engine for the whole application: it starts pdf.js's worker once.
const engine = createPdfjsEngine({
  pdfjs,
  workerSrc,
  // pdf.js's cmaps/, standard_fonts/, wasm/, and iccs/ directories of the
  // same version, for CJK text, non-embedded fonts, and some image formats.
  assetBase: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/`,
});

export function App() {
  return (
    <PdfDocument engine={engine} source={{ url: "/manual.pdf" }}>
      <PdfViewport style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

- `PdfViewport` is the scroll container. Give it a definite height, as above
  or through a flex or grid layout: it contains its own layout and does not
  grow with the document.
- `workerSrc` is the URL of pdf.js's worker script of the same version. Other
  bundlers have their own ways to emit it as a file, or you can serve a copy
  of `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` yourself.
- `assetBase` can point at your own copy of those four directories from
  `node_modules/pdfjs-dist/` instead of a CDN. It ends with a slash.

## Controls and state

Components inside `<PdfDocument>` reach the viewer with hooks:

```tsx
import { usePdfState, usePdfViewer } from "parapdf";

function Toolbar() {
  const viewer = usePdfViewer();
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  // CSS pixels per PDF point; 96 / 72 shows a page at its printed size.
  const scale = usePdfState((state) => state.scale);
  return (
    <div role="toolbar" aria-label="PDF controls">
      <button type="button" onClick={() => viewer.goToPage(page - 1)}>Previous</button>
      <span>{page + 1} / {pageCount}</span>
      <button type="button" onClick={() => viewer.goToPage(page + 1)}>Next</button>
      <button type="button" onClick={() => viewer.zoomBy(1 / 1.25)}>Zoom out</button>
      <span>{Math.round((scale * 72 * 100) / 96)}%</span>
      <button type="button" onClick={() => viewer.zoomBy(1.25)}>Zoom in</button>
      <button type="button" onClick={() => viewer.setScale("fit-width")}>Fit width</button>
      <button type="button" onClick={() => viewer.rotate(90)}>Rotate</button>
    </div>
  );
}
```

`usePdfState(selector)` re-renders its component only when the selected
value changes; return a primitive or an object the state already holds. The
state (`ViewerState`) has:

| Field | Meaning |
|---|---|
| `status`, `error` | `"idle"`, `"loading"`, `"ready"`, or `"error"`, and the error's message. |
| `pageCount`, `currentPage` | Pages in the document, and the zero-based page nearest the viewport's center. |
| `scale`, `zoomMode` | CSS pixels per PDF point; `"fit-width"` while the page width is fitted as the viewport resizes, otherwise `"custom"`. |
| `rotation` | The view's clockwise rotation: 0, 90, 180, or 270. |
| `search` | The search in progress or done (see below). |
| `outline`, `canGoBack` | The document outline (`null` while it loads), and whether `back()` has a position to return to. |
| `document` | The open document (see [pdf.js's own API](#pdfjss-own-api)). |

`usePdfViewer()` returns the viewer runtime, whose methods change the view:
`goToPage(index)`, `zoomBy(factor)`, `setScale(scale | "fit-width")`,
`rotate(degrees)`, `setRotation(rotation)`, `goToDestination(dest)`,
`back()`, and the search methods. The viewport is focusable, so the arrow,
Page Up, Page Down, and space keys scroll it.

## Search

```tsx
import { usePdfSearch } from "parapdf";

function Find() {
  const search = usePdfSearch();
  return (
    <search>
      <input
        type="search"
        aria-label="Find in document"
        onChange={(event) => search.search(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.shiftKey ? search.previous() : search.next();
        }}
      />
      <output aria-live="polite">
        {search.matches.length > 0 ? `${search.current + 1} of ${search.matches.length}` : ""}
      </output>
    </search>
  );
}
```

Search covers the whole document, not only the mounted pages, and streams
results page by page (`status` is `"searching"`, then `"done"`); the first
match at or after the current page is selected and scrolled into view. Like
pdf.js's viewer, it ignores case, diacritics, and full-width forms, and joins
words that a line end splits, such as a hyphenated word or Japanese text.
Matches are painted with the CSS Custom Highlight API; style them with
`::highlight(parapdf-search)` and `::highlight(parapdf-search-current)`.
Debounce `search()` while the user types.

## Links, outline, and navigation

Links inside the document and its outline jump through the viewer, which
remembers where each jump started:

```tsx
import { type OutlineNode, usePdfNavigation, usePdfOutline } from "parapdf";

function Outline() {
  const outline = usePdfOutline();
  const navigation = usePdfNavigation();
  const list = (items: readonly OutlineNode[]) => (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          <button type="button" onClick={() => navigation.goToDestination(item.dest)}>
            {item.title}
          </button>
          {item.items.length > 0 ? list(item.items) : null}
        </li>
      ))}
    </ul>
  );
  return outline && outline.length > 0 ? <nav aria-label="Outline">{list(outline)}</nav> : null;
}
```

`navigation.back()` returns to the position before the last link or outline
jump, and `navigation.canGoBack` says whether there is one. Links to other
documents open in a new tab; `externalLinks: "disabled"` leaves them inert.

## Overlays

`renderOverlay` draws your own elements over pages, placed with
`PdfPageRect` in PDF points from the page's top-left corner. Overlays follow
zoom and rotation through layout alone, without re-rendering:

```tsx
<PdfViewport
  style={{ height: "100vh" }}
  renderOverlay={(pageIndex) =>
    pageIndex === 0 ? (
      <PdfPageRect pageIndex={0} x={72} y={72} width={200} height={24}>
        <mark style={{ display: "block", height: "100%", opacity: 0.4 }} />
      </PdfPageRect>
    ) : null
  }
/>
```

## Options

`<PdfDocument options={…}>` takes `ViewerOptions`. They, like `engine`, are
read when the component mounts; give it a new `key` to change them.

| Option | Default | |
|---|---|---|
| `initialScale` | `"fit-width"` | A scale in CSS pixels per point, or `"fit-width"`, which keeps fitting the page width as the viewport resizes. |
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links. |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert. |
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas; larger pages are drawn sharp only around the visible area. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together. Pages outside the viewport give theirs back first; past the budget, visible pages lose their sharp margin and then resolution, but keep their low-resolution canvases. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |

`PdfViewport` takes `className`, `style`, `label` (the accessible name of
the document, "PDF document" by default), `pageLabel` (the accessible name
of each page, `(pageNumber, pageCount) => string`, "Page 3 of 12" by
default), and `renderOverlay`.

`createPdfjsEngine` takes `pdfjs`, `workerSrc`, `assetBase`, `enableHWA`
(GPU-backed canvases, `true` by default; `false` asks pdf.js for CPU-backed
ones, which block the main thread for longer in Chromium and drop more frames
in WebKit, though WebKit holds less memory with them), `documentOptions` (more
pdf.js `getDocument` parameters for every document, such as `withCredentials`
or `httpHeaders`), and `rendererSrc` (see [Limitations](#limitations)). For
older browsers, pass pdf.js's legacy build, `pdfjs-dist/legacy/build/pdf.mjs`,
and its worker.

## Sources

A source is `{ url }` or `{ data }`, where `data` is a `Uint8Array` or an
`ArrayBuffer`. Viewers of the same URL, or of the same bytes, share one
loaded document, and React's StrictMode or a quick remount reuses it instead
of loading it again. A document is closed a second after its last viewer
unmounts. A new source object with the same URL keeps the open document, so
`source={{ url }}` inline is fine. ParaPDF copies `data` before pdf.js
transfers it to its worker, so your bytes stay usable.

## pdf.js's own API

`usePdfDocument()` returns the open document, and `pdfjsDocumentOf()` turns
it into pdf.js's `PDFDocumentProxy` for what ParaPDF does not wrap, such as
metadata or attachments:

```tsx
import { pdfjsDocumentOf, usePdfDocument } from "parapdf";
import { useEffect, useState } from "react";

function Title() {
  const proxy = pdfjsDocumentOf(usePdfDocument());
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    void proxy?.getMetadata().then(({ info }) => setTitle((info as { Title?: string }).Title ?? null));
  }, [proxy]);
  return title ? <h1>{title}</h1> : null;
}
```

## Server rendering

ParaPDF's React modules declare `"use client"`, and its components render on
the server as an empty viewport. The engine runs only in the browser: create
it in browser-only code. With Next.js, load the component that creates it
with `next/dynamic` and `{ ssr: false }`.

## Accessibility

The viewport is a focusable, labelled `role="document"`, each page a
labelled region, and the canvases are hidden from assistive technology,
which reads the text layer instead. Text layers carry the PDF's language
(`/Lang`), or the page's when the PDF declares none. Label the document and
its pages in your application's language with `label` and `pageLabel`.

## Limitations

- Released pdfjs-dist draws pages on the main thread. Drawing in a worker
  needs pdf.js's renderer worker (`rendererSrc`), which is only in unreleased
  pdf.js builds so far.
- Not yet supported: filling forms (fields show but cannot be edited),
  tagged-PDF structure, optional content toggles, attachments, and
  per-document passwords (`documentOptions.password` applies to every
  document of an engine).
- Text exists only for mounted pages, so the browser's own find sees only
  those; use `usePdfSearch`.
- Search highlights need the CSS Custom Highlight API; browsers without it
  find and scroll to matches without painting them.
- One `PdfViewport` per `PdfDocument`.
- In Safari on iPadOS, a pinch that starts while a fling still scrolls does
  not reach the page; the next pinch zooms.
- Tested in Playwright's builds of Chromium, WebKit, and Firefox, and by hand
  in Safari in the iPadOS simulator; Safari on macOS and real iOS and iPadOS
  devices are not verified yet.

## License

[MIT](LICENSE). Parts of ParaPDF are derived from pdf.js, licensed under the
Apache License 2.0: see [NOTICE.md](NOTICE.md).
