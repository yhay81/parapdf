# ParaPDF's architecture

How the runtime in `packages/parapdf/src/` is built, and why. Where the code
and this file disagree, one of them is wrong: fix it, or ask.
`docs/decisions/` records the choices that matter for performance or
direction, with their evidence. The site's reference
(https://parapdf.yhay81.com/reference/components/) documents the API.

## Goals

- The fastest React PDF viewer on pdf.js, measured: pages flipped through
  quickly, and pages come back to show at once; scrolling and zooming never
  commit React state per frame; drawing leaves the main thread wherever
  pdf.js allows.
- A small core, with every feature a module that only applications using
  it load.
- Code tested where it decides: the planning of drawings, layout, geometry,
  and gestures' math run in Node; browsers check the integration.

## Non-goals

- Another engine than pdf.js, or an engine boundary (decision 0001).
- Compatibility: APIs change whenever that makes ParaPDF faster or simpler,
  with no deprecations or shims (decision 0002).
- Anything of a domain: scales, measurement, CAD layers.
- An application's own interface: toolbars, sidebars, a find bar, dialogs,
  a presentation mode, shortcuts beyond the viewport's keys, and their
  translations. ParaPDF matches pdf.js's viewer in what a document can do,
  not in its chrome; applications build theirs from the data and actions
  ParaPDF gives (decision 0019).

## Layers

Dependencies point down only. The core (`pdfjs/` to `render/`) imports no
feature, and React is used only in `react/`.

```
react/      PdfDocument, PdfViewer, PdfThumbnails, hooks; overlays through portals
features/   search, history, view state, initial view, permissions, forms,
            annotations, autoLinks, print, download, thumbnails, layers,
            attachments, selection, text
render/     planner (pure), renderer (page DOM, canvases, kept canvases),
            DOM layers (text, links and forms, editor, structure), selection tracker
view/       Viewer: layout, scrolling, zoom, gestures, keys, navigation, state
document/   DocumentSession, one per open document, shared through a registry
pdfjs/      loading pdf.js with its worker and files; drawing and layers with it
```

### pdfjs/

`loader.ts` loads pdf.js on first use and shares it, and its one worker,
with every viewer; `configurePdfjs()` takes one configuration (the same
again changes nothing; another is ignored with a warning), and
`parapdf/legacy` (`src/legacy.ts`, `legacy-files.ts`) gives pdf.js's legacy
build, whose worker only applications importing it emit. The rest is how
ParaPDF drives pdf.js, with pdf.js's own types and no interface between:
drawing a page or a region (`draw.ts`), the text layer and its language fix
(`text.ts`), destinations, the annotation layer and its link service,
optional content (`layers.ts`), the structure tree, form scripting's
sandbox (`scripting.ts`), and the annotation editor with the labels pdf.js
leaves to its viewer's localization (`editor*.ts`).

The package ships pdf.js's worker and the files it loads on demand.
`scripts/pdfjs-files.ts` copies them into `pdfjs/` and writes `files.ts`,
which references each with `new URL(…, import.meta.url)`, so bundlers emit
them with the application's assets. Bundlers give each file a URL of its
own, but the worker asks for CMaps, fonts, decoders, and ICC profiles as a
directory plus a name, so the worker's URL carries the files' URLs in its
fragment and `scripts/worker-prelude.js` routes the worker's requests to
them (pdf.js gets `parapdf:/` as the directory). The files' URLs end in
`?no-inline&url`, which keeps Vite and Rsbuild from inlining small files
into the bundle, and `shippedUrl()` strips it. Vite, webpack, Rsbuild, and
Next.js emit the files (`check:bundlers`); other bundlers take a copy of
`pdfjs/` and `configurePdfjs({ assetBase })`.

### document/

`DocumentSession` (`session.ts`) is one open document: pdf.js's
`PDFDocumentProxy` and pages, the pages' sizes (the first page's for all at
once, then the real ones in the background), and the document's data, each
read once: page labels, outline, metadata, attachments, comments,
permissions, the initial view, optional content, and the text read for
search and `getText()`.

- A source is a URL (with request headers and credentials), bytes, or a
  `PDFDataRangeTransport`. A URL is identified without its fragment, which
  says where to open.
- The registry (`registry.ts`) shares one session among every viewer of a
  source, keyed by the source, and closes it one second after the last
  lease goes, so StrictMode and quick remounts open once. Its entry
  publishes the document state (`store.ts`) from the moment it starts to
  open: status (`"loading"`, `"password"`, `"ready"`, `"error"`), the
  error, why a password is asked for, progress (at most once a frame), and,
  once ready, the page count and permissions.
- A session owns an `AbortController`: everything started for it (drawing,
  text, searches, background passes, the editor, form scripts) takes its
  signal, and closing aborts it all. No generation counters.
- Applications see a `PdfSession` (`pdf-session.ts`), one per
  `PdfDocument`: its source, state, `submitPassword()`, pdf.js's `proxy`
  once ready, a `signal`, and promises of the document's data, each
  settling empty when the read or the document fails. It opens, closes, and
  releases nothing itself: `PdfDocument` holds and returns its lease.

Viewers that edit annotations share the session's one annotation storage,
each with an editor of its own under ids unique to the session. Saving and
printing, from any viewer, include what every viewer created; a viewer
shows the annotations it created, not the others'. Editing also reaches the
file's own annotations of the kinds pdf.js's editor edits (text, ink,
highlights, unlocked images): while a tool is chosen they become editors,
and pages are drawn again without them; pdf.js then leaves what the storage
changed out of every viewer's drawings.

### view/

A `Viewer` (`viewer.ts`) is one viewport onto a session, with its own
position, zoom, rotation, spreads, scroll mode, direction, and tool;
several may show one session.

- `layout.ts`: pure and immutable per zoom (typed arrays, rows, spreads,
  scroll modes, direction). `zoom.ts` and `navigation.ts` hold the pure
  rules of zoom modes ("fit-width", the default, "fit-page", and "auto",
  pdf.js's default) and of destinations and the current page.
- `scrolling.ts`, `gestures.ts`, and `input.ts`: scrolling, a zoom
  previewed with a CSS transform and committed where it showed, touch,
  wheel, Safari's gesture events, swipes in "page" mode, the keys, and the
  hand tool.
- `state.ts`: the viewer's store, view state only. Hot state changes while
  the reader scrolls or zooms (layout, mounted window, current page, scale,
  zoom mode); cold state does not (rotation, spreads, scroll mode, tool,
  direction). They are subscribed to apart.
- `options.ts`: the viewer's options. Those the renderer is built with
  (layers, colors, budgets, concurrency) rebuild it as a detach and
  reattach would, keeping position and edits; the others apply at once.
- `extensions.ts`: `viewer.extend()`, the hooks features attach with.
  `metrics.ts`: what the checks and benchmarks read. `files.ts`: bytes
  handed to the browser as a download. `signals.ts`: linked abort signals.
- Focus follows the page being read (decision 0021): pages are focusable
  but not in the tab order; focus on the viewport or a page moves to the
  current page when it changes, to a link's target page, and off a page
  that unmounts. Focus elsewhere, and during a text selection drag, stays.
- A number the viewer cannot use (NaN pages, scales, rotations) does
  nothing; destinations behave as in pdf.js's viewer.

A viewer has an `AbortController` of its own. Its viewport detaching
aborts its work (drawing, searches, printing, publishing) but keeps the
view and edits for reattachment; it lives as long as the `useViewer()`
that created it, or the `PdfViewer` that made its own.

### render/

- `planner.ts` is a pure function from the layout, viewport,
  devicePixelRatio, whether scrolling settled, the budgets, and what each
  page shows and draws now, to the drawings wanted, in order: a base at half
  a device pixel per CSS pixel within 2 MP; a detail at full resolution, of
  the whole page within 16 MP, else of the visible area within the budget;
  reduced resolution in quarter-octave steps within `maxCanvasPixels`;
  visible pages first; no base drawn again under a whole-page detail
  (decision 0025).
- `renderer.ts` carries out the plans: starts, cancels, and releases
  drawings, and keeps the canvases of pages that unmount within
  `maxKeptPixels` (`kept-canvases.ts`, decision 0004). A whole-page detail
  no larger than a base becomes the base when it gives way (decision 0012);
  a detail stays while the viewport is hidden and until a base replaces it
  (decision 0026).
- The renderer owns each page's DOM inside the host React places
  (`page.ts`, decision 0010): the canvases and the layer containers. A kept
  canvas moves into the page's next host without a copy.
- `dom-layers.ts` builds DOM layers one at a time, after scrolling
  settles, in idle time, never while a visible page waits for its first
  pixels: text, then links and forms, then the annotations being edited.
  Text layers keep the zoom they were laid out at and follow later zooms
  with CSS. Text layers are built per page, not in the document (decision
  0020).
- `selection.ts` keeps text selection drags in text layers across pages
  and gaps, with each browser's fixes; ported from pdf.js's
  `TextLayerBuilder` (`NOTICE.md`).
- With released pdfjs-dist, pdf.js draws on the main thread.

### features/

A feature attaches to a viewer or a session through `viewer.extend()` and
the viewer's methods, keeps any state in a store of its own, and detaching
it undoes what it added. The core imports no feature.

- Forms (with `formScripts`), annotation editing, and `autoLinks` change
  how pages are drawn: they are options of `PdfViewer`, which imports their
  module when set. Search, print, and the others are imported by their
  hooks or functions, and absent from builds that use neither.
- Form scripts are off by default and load only for a document that has
  some: pdf.js's QuickJS sandbox, one per session, started after the first
  paint (decision 0016), sending pdf.js's viewer's document events around
  saving, printing, and closing.
- Links found in the text (`autoLinks`, decision 0024) are found as
  pdf.js's viewer finds them and added to the annotation layer.
- The initial view applies `/OpenAction`, `/PageLayout`, `/PageMode`, a
  URL's open parameters (`page`, `zoom`, `nameddest`; decision 0023), and
  `initialViewState`, once per document.
- Download and save take the whole document or chosen pages, through
  pdf.js's `extractPages()`, with the form values and annotations.
- Search ports pdf.js's find normalization (`text-search.ts`), CJK
  included, and highlights matches with the CSS Custom Highlight API.

## React

`react/` is the only module that uses React, and every module that touches
the DOM declares `"use client"`.

- `PdfDocument` opens or joins a session and renders its children at once;
  nothing suspends before the first page draws. A source with another URL,
  headers, bytes, transport, or password opens another; a new fragment
  moves its viewers as a link would.
- `PdfViewer` is one viewport. View state (`zoom`, `rotation`, `spread`,
  `scrollMode`, `tool`) is controlled or uncontrolled; the current page is
  reported (`onPageChange`) and set with `viewer.goToPage()`. Every other
  prop is a live option: changing it needs no remount, and an option set to
  its default is the option left out. `renderOverlay` renders through a
  portal into the page's host; React renders nothing else there.
- `PdfThumbnails` and `PdfThumbnail` draw the viewer's document at a lower
  priority; `PdfPageRect` places content in PDF points.
- Hooks read stores with `useSyncExternalStore` selectors, so React commits
  only when a selected value changes; the document's data is read with
  `use()` under the application's Suspense boundaries.
- On the server the viewer renders an empty viewport, a URL source's
  preload goes into the head, and the data hooks throw through
  `use(browser())` so the nearest Suspense boundary renders its fallback
  (React 19.3). The browser preloads a source only outside WebKit, which
  would download it twice (decision 0014), and never one sent with headers.

## Testing

- Node unit tests (`packages/parapdf/test/`) for every pure module and the
  features' logic, with `fake-pdfjs.ts` and `fake-dom.ts`; the planner's
  invariants: a visible page never blank, budgets kept, no base drawn again
  under a whole-page detail.
- The Playwright functional checks (`check:*`) are the behavioral contract:
  changing an API on purpose changes them in the same change.
- A change that may affect speed or memory is benchmarked against the build
  before it, in the same run; a regression needs a decision accepting it.

## Open questions

- pdf.js's renderer worker: once a released pdfjs-dist has it, does it
  replace drawing on the main thread? (#20; scanned pages clone image
  bitmaps on the main thread with it,
  `bench/upstream/pdfjs-renderer-image-relay-issue.md`.)
- What 1.0 requires and what 1.x promises: decision 0015, proposed.
