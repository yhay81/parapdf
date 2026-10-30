# ParaPDF

A fast PDF viewer for React, built on [pdf.js](https://github.com/mozilla/pdf.js).

> **Status: 0.x.** The API may change in any minor release until 1.0.
> [parapdf.yhay81.com](https://parapdf.yhay81.com) has the guides, the API
> reference, and a [live demo](https://parapdf.yhay81.com/demo/).

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame, and pixels never pass through React.
- **Only what is near the viewport exists.** Pages outside a small window
  unmount. Each page draws a quick base first and full resolution once
  scrolling settles, and at high zoom only its visible part sharp, within
  pixel budgets you can set.
- **Pages you come back to show at once.** A page that leaves the window
  keeps its canvases, within a budget.
- **Several viewers, one document.** Each viewer has its own position, zoom,
  rotation, and layout; the document is opened, parsed, and searched once.
- **A document viewer.** Selectable, accessible text; search that matches as
  pdf.js's viewer does, CJK text included; links, the outline, and history;
  forms, annotations, printing, saving, layers, attachments, thumbnails,
  spreads, scroll modes, and encrypted documents.
- **You load what you use.** Forms and annotation editing load their code
  when their prop is set; search, printing, and the other features are in
  your bundle only when you import them.
- **pdf.js included.** ParaPDF ships pdf.js's worker and the files it loads
  on demand, and your bundler serves them: there is nothing to set up.

## Install

```bash
npm install parapdf
```

ParaPDF needs React 19.3 or later. It depends on pdfjs-dist 6.4.299
exactly, because it ships that version's worker and files.

## Quick start

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

`PdfDocument` opens the document for everything inside it; `PdfViewer` is a
scroll container that shows it. Give the viewer a definite height: it does
not grow with the document. Nothing suspends, and the viewer shows no
loading state or error of its own; read them with `useDocumentState()`.

To control a viewer, create it with `useViewer()` and give it to the
`PdfViewer` and to your controls:

```tsx
import { PdfDocument, PdfViewer, useViewer, useViewState } from "parapdf";

export function Reader() {
  const viewer = useViewer();
  const page = useViewState(viewer, (state) => state.currentPage);
  return (
    <PdfDocument source="/manual.pdf">
      <button type="button" onClick={() => viewer.previousPage()}>Previous</button>
      <span>{page + 1}</span>
      <button type="button" onClick={() => viewer.nextPage()}>Next</button>
      <button type="button" onClick={() => viewer.zoomBy(1.25)}>Zoom in</button>
      <PdfViewer viewer={viewer} style={{ height: "80vh" }} />
    </PdfDocument>
  );
}
```

## Bundlers

ParaPDF refers to pdf.js's worker and files with `new URL(…, import.meta.url)`,
which Vite, webpack, Rsbuild, and Next.js (Turbopack and webpack) copy to the
build output as they are. With bundlers that do not, such as Parcel, esbuild,
and Bun, copy `node_modules/parapdf/pdfjs/` to where your application serves
static files and tell ParaPDF where it is:

```tsx
configurePdfjs({ assetBase: "/pdfjs/" });
```

[Bundlers](https://parapdf.yhay81.com/setup/bundlers/) covers Content
Security Policy and files served from another origin.

## Documentation

- [Getting started](https://parapdf.yhay81.com/getting-started/) and
  [controls](https://parapdf.yhay81.com/guides/controls/)
- Guides: [layout](https://parapdf.yhay81.com/guides/layout/),
  [search](https://parapdf.yhay81.com/guides/search/),
  [navigation](https://parapdf.yhay81.com/guides/navigation/),
  [forms](https://parapdf.yhay81.com/guides/forms/),
  [annotations](https://parapdf.yhay81.com/guides/annotations/), and
  [more](https://parapdf.yhay81.com/)
- Reference: [components](https://parapdf.yhay81.com/reference/components/),
  [options](https://parapdf.yhay81.com/reference/options/),
  [state](https://parapdf.yhay81.com/reference/state/),
  [viewer](https://parapdf.yhay81.com/reference/viewer/), and
  [sources](https://parapdf.yhay81.com/reference/sources/)
- [Server rendering](https://parapdf.yhay81.com/setup/server-rendering/),
  [accessibility](https://parapdf.yhay81.com/about/accessibility/), and
  [limitations](https://parapdf.yhay81.com/about/limitations/)
- [Changelog](https://github.com/yhay81/parapdf/blob/main/CHANGELOG.md)

## License

[MIT](https://github.com/yhay81/parapdf/blob/main/LICENSE). Parts of
ParaPDF are derived from pdf.js, licensed under the Apache License 2.0: see
[NOTICE.md](https://github.com/yhay81/parapdf/blob/main/NOTICE.md).
