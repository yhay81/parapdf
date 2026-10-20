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
  by screen readers, in the structure a tagged PDF gives them; whole-document
  search matches the way pdf.js's own viewer does, Japanese and other CJK
  text included; links, the outline, and a back stack navigate within the
  document.
- **What a document viewer does.** Fillable forms that save into the PDF,
  comments, layers, attachments, page labels, thumbnails, printing,
  two-page spreads, scrolling sideways, in rows, or a page at a time,
  encrypted documents, and selections in PDF coordinates for your own
  highlights.
- **Gestures.** Ctrl or ⌘ with the wheel, trackpad pinches, touch pinches,
  and Safari's gesture events zoom the document instead of the page; Ctrl or
  ⌘ with +, -, and 0 too, and a hand tool drags it.

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
  // pdf.js's cmaps/, standard_fonts/, wasm/, iccs/, and web/images/
  // directories of the same version, for CJK text, non-embedded fonts, some
  // image formats, and the icons of comments.
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
- `assetBase` can point at your own copy of those directories from
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
      <button type="button" onClick={() => viewer.previousPage()}>Previous</button>
      <span>{page + 1} / {pageCount}</span>
      <button type="button" onClick={() => viewer.nextPage()}>Next</button>
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
| `status`, `error` | `"idle"`, `"loading"`, `"password"` (see [Encrypted documents](#encrypted-documents)), `"ready"`, or `"error"`, and the error's message. |
| `progress` | `{ loaded, total }` bytes of the document received, `total` null when the server did not say; null before any arrive. |
| `pageCount`, `currentPage` | Pages in the document, and the zero-based page being read: the one nearest the viewport's center, except that the current page stays current while all of it is in view, and that navigation makes the page it shows current. |
| `pageLabels` | Each page's label, such as `"iv"` or `"A-3"`, when the PDF defines them; otherwise null. |
| `scale`, `zoomMode` | CSS pixels per PDF point; `"fit-width"` or `"fit-page"` while the page is fitted as the viewport resizes, otherwise `"custom"`. |
| `rotation`, `spread`, `scrollMode` | The view's clockwise rotation (0, 90, 180, or 270); `"none"`, `"odd"`, or `"even"`; and `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"` (see [Scroll modes](#scroll-modes-spreads-and-fitting)). |
| `tool` | What a mouse drag does: `"select"` text, or scroll the document with the `"hand"`. |
| `search` | The search in progress or done (see below). |
| `outline`, `canGoBack` | The document outline (`null` while it loads), and whether `back()` has a position to return to. |
| `metadata` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language; null while it loads. |
| `attachments`, `layers` | The document's embedded files and its layers (see [Layers and attachments](#layers-and-attachments)); null while they load. |
| `document` | The open document (see [pdf.js's own API](#pdfjss-own-api)). |

`usePdfViewer()` returns the viewer runtime, whose methods change the view:
`goToPage(index)`, `nextPage()` and `previousPage()` (by a whole spread or
row), `zoomBy(factor)`, `setScale(scale | "fit-width" | "fit-page")`,
`resetScale()`, `rotate(degrees)`, `setRotation(rotation)`,
`setSpread(spread)`, `setScrollMode(mode)`, `setTool("select" | "hand")`,
`goToDestination(dest)`, `back()`, and the methods of the sections below.
The viewport is focusable: the arrow, Page Up, Page Down, Home, End, and
space keys scroll it, or flip pages in `"page"` mode, and Ctrl or ⌘ with +,
-, and 0 zoom in, out, and back to `initialScale`.

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

`search(query, options)` takes the options of pdf.js's find bar, all off by
default: `caseSensitive`, `entireWord` (a match must not be part of a longer
word), and `matchDiacritics` (é no longer matches e).

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

## Thumbnails

`PdfThumbnail` draws a page `width` CSS pixels wide, at a lower priority than
the pages in view and from their drawing when the viewer already has one.
Only thumbnails near the visible part of their scroll container hold pixels,
so a list of every page stays cheap. It is a picture: wrap it in a button.

```tsx
import { PdfThumbnail, usePdfState, usePdfViewer } from "parapdf";

function Thumbnails() {
  const viewer = usePdfViewer();
  const pageCount = usePdfState((state) => state.pageCount);
  const labels = usePdfState((state) => state.pageLabels);
  return (
    <nav aria-label="Pages" style={{ overflow: "auto" }}>
      {Array.from({ length: pageCount }, (_, index) => (
        <button key={index} type="button" onClick={() => viewer.goToPage(index)}>
          <PdfThumbnail pageIndex={index} width={120} />
          {labels?.[index] ?? index + 1}
        </button>
      ))}
    </nav>
  );
}
```

## Forms, printing, and saving

With `options={{ forms: true }}`, form fields become inputs, check boxes,
radio buttons, and lists the reader can fill in; without it, they show as
the PDF draws them. What the reader types belongs to the document:

- `viewer.save()` resolves to the PDF's bytes with the values written in,
  and `viewer.download(filename?)` hands them to the browser as a download,
  named after the document's URL by default.
- `viewer.print({ resolution, onProgress, signal })` draws every page for
  printing, the typed values included, at 150 dpi by default, and opens the
  browser's print dialog with only those pages.

Form scripts (JavaScript actions) do not run.

## Encrypted documents

An encrypted document waits for its password with `status` `"password"`;
`passwordReason` says whether one is `"required"` or the last one was
`"incorrect"`. Answer with `viewer.submitPassword(password)`, or
`submitPassword(null)` to give up, which fails the document:

```tsx
function PasswordPrompt() {
  const viewer = usePdfViewer();
  const reason = usePdfState((state) => state.passwordReason);
  const [password, setPassword] = useState("");
  if (!reason) return null;
  return (
    <form onSubmit={(event) => { event.preventDefault(); viewer.submitPassword(password); }}>
      <label>
        {reason === "incorrect" ? "Wrong password, try again" : "Password"}
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit">Open</button>
    </form>
  );
}
```

A source can carry the password too (see [Sources](#sources)); the viewer
asks only when it is wrong.

## Layers and attachments

`layers` lists the document's layers (optional content) in its own order:
`{ id, name, visible, children }`, where a heading that only groups others
has a null `id`. `viewer.setLayerVisible(id, visible)` shows or hides one in
this viewer, its thumbnails, and its printouts; showing one of a set of
exclusive layers hides the others, and links in the document that switch
layers work too.

`attachments` lists the embedded files as `{ id, filename, description }`.
`viewer.getAttachmentContent(id)` resolves to a file's bytes, and
`viewer.openAttachment(attachment)` does what activating a file attachment
annotation does: by default, the browser downloads the file. The
`openAttachment` option replaces that, for both.

## Scroll modes, spreads, and fitting

`setScrollMode()` arranges pages as pdf.js's viewer does: `"vertical"`, the
default, stacks them top to bottom; `"horizontal"` puts them in one row that
scrolls sideways, centered in the viewport's height; `"wrapped"` fills each
row with as many pages as fit the viewport's width, again when it resizes;
`"page"` shows one page, or one spread, at a time. In `"page"` mode,
`goToPage()`, `nextPage()`, `previousPage()`, links, and search flip pages,
and so do the keys that would scroll past the edge of the page shown: Page
Down, space, and ↓ at its bottom and → at its right edge go forward, and
Page Up, Shift+space, ↑, and ← go back; Home and End go to the first and
last page. A zoomed page scrolls within itself, and the pages beside it are
drawn before they show. The current page stays in view when the mode
changes.

`setSpread("odd")` shows pages side by side in pairs, 1–2, 3–4; `"even"`
shows page 1 alone and pairs 2–3, 4–5, like a book with its cover; `"none"`
goes back to one page per row. Pairs stay together in every scroll mode: in
a wrapped row and when `"page"` mode flips. `setScale("fit-page")` fits all
of the current page, or of its spread, and keeps fitting it as the viewport
resizes; in a spread mode, fitting counts two pages, so the zoom stays the
same from row to row, as in pdf.js. In `"horizontal"` mode, where all pages
share one row, fitting counts one.

## Selections and highlights

`viewer.getSelection()` returns the text selected in the viewer and the
rectangles it covers, page by page, in the PDF points `PdfPageRect` takes,
so you can keep a selection as a highlight. `usePdfSelection()` follows it:

```tsx
const selection = usePdfSelection();
// { text: "…", pages: [{ pageIndex: 0, rects: [{ x, y, width, height }] }] } or null
```

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
| `initialScale` | `"fit-width"` | A scale in CSS pixels per point, `"fit-width"`, which keeps fitting the page width as the viewport resizes, or `"fit-page"`, which keeps fitting all of it. |
| `initialPage` | `0` | The zero-based page shown first. |
| `spread` | `"none"` | `"odd"` or `"even"` shows pages in pairs (see [Spreads](#scroll-modes-spreads-and-fitting)). |
| `scrollMode` | `"vertical"` | `"horizontal"`, `"wrapped"`, or `"page"` arranges pages otherwise (see [Scroll modes](#scroll-modes-spreads-and-fitting)). |
| `initialTool` | `"select"` | `"hand"` makes a mouse drag scroll the document from the start. |
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links, comment popups, and, with `forms`, form fields. |
| `forms` | `false` | Form fields the reader can fill in (see [Forms](#forms-printing-and-saving)). |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert. |
| `openAttachment` | download | What opening an embedded file does: `({ filename, content }) => void`. |
| `pageColors` | none | `{ background, foreground }` to draw pages in two colors, for example `Canvas` and `CanvasText` in forced-colors mode. |
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas; larger pages are drawn sharp only around the visible area. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together. Pages outside the viewport give theirs back first; past the budget, visible pages lose their sharp margin and then resolution, but keep their low-resolution canvases. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |

`PdfViewport` takes `className`, `style`, `label` (the accessible name of
the document, "PDF document" by default), `pageLabel` (the accessible name
of each page, `(pageNumber, pageCount) => string`, "Page 3 of 12" by
default), and `renderOverlay`.

`createPdfjsEngine` takes `pdfjs`, `workerSrc`, `assetBase`,
`imageResourcesPath` (where the icons of comments come from,
`${assetBase}web/images/` by default; without either, comments get a
transparent icon that still opens them), `enableHWA`
(GPU-backed canvases, `true` by default; `false` asks pdf.js for CPU-backed
ones, which block the main thread for longer in Chromium and drop more frames
in WebKit, though WebKit holds less memory with them), `documentOptions` (more
pdf.js `getDocument` parameters for every document, such as `withCredentials`
or `httpHeaders`), and `rendererSrc` (see [Limitations](#limitations)). For
older browsers, pass pdf.js's legacy build, `pdfjs-dist/legacy/build/pdf.mjs`,
and its worker.

## Sources

A source is `{ url }` or `{ data }`, where `data` is a `Uint8Array` or an
`ArrayBuffer`. A URL source may add `httpHeaders` and `withCredentials` for
its request, and either kind the `password` of an encrypted document.
Viewers of the same URL (with the same headers and credentials), or of the
same bytes, share one loaded document, and React's StrictMode or a quick
remount reuses it instead of loading it again. A document is closed a
second after its last viewer unmounts; one still loading or waiting for a
password stops loading. A new source object with the same URL keeps the open
document, so `source={{ url }}` inline is fine. ParaPDF copies `data` before
pdf.js transfers it to its worker, so your bytes stay usable.

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
which reads the text layer instead. A tagged PDF's structure gives that
text its headings, paragraphs, lists, tables, and figures' alternative text,
as in pdf.js's viewer. Text layers carry the PDF's language (`/Lang`), or the
page's when the PDF declares none. Label the document and its pages in your
application's language with `label` and `pageLabel`.

## Limitations

- Released pdfjs-dist draws pages on the main thread. Drawing in a worker
  needs pdf.js's renderer worker (`rendererSrc`), which is only in unreleased
  pdf.js builds so far.
- Not yet supported: editing annotations, form scripts, and XFA forms.
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
