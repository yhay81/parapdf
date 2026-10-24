# ParaPDF: the target of the rebuild

The destination of the rebuild. Where the code, `AGENTS.md`'s
older wording, or `docs/history/` disagree with this file, this file wins.
A question this file does not answer is asked, not inferred from the 0.x
code or the history, and the answer is written here before the code that
follows it. `docs/decisions/` records why things are as they are.

## Goals

- The fastest React PDF viewer on pdf.js, measured: pages flipped through
  quickly and pages come back to show at once; scrolling and zooming never
  commit React state per frame; drawing leaves the main thread wherever
  pdf.js allows.
- A small core, with every feature a module that only applications using
  it pay for.
- Code that can be tested where it decides: the planning of renders, layout,
  geometry, and gestures' math run in Node; browsers check integration.

## Non-goals

- Another engine than pdf.js, or an engine boundary (decision 0001).
- Compatibility with 0.x APIs, deprecations, or shims (decision 0002).
- Anything of a domain: scales, measurement, CAD layers. ParaPDF shows PDFs
  as documents: reading, search, selection, links, annotations, forms.

## Layers

Dependencies point down only. The core (`pdfjs/` to `render/`) imports no
feature, and React is used only in `react/`.

```
react/      PdfDocument, PdfViewer, PdfThumbnails, hooks; overlays through portals
features/   search, history, viewState, initialView, permissions, forms,
            annotations (editing), print, download, thumbnails, layers,
            attachments, selection, text (getText)
render/     planner (pure), renderer (page DOM, canvases, kept canvases),
            DOM layer pipeline (text, links, editor, structure)
view/       Viewer: layout, scrolling, zoom, rotation, spreads, scroll modes,
            gestures, keyboard, mounted window, current page, navigation
document/   DocumentSession: one per open document, shared by viewers
pdfjs/      loading pdf.js, its worker and files; pdf.js-specific helpers
```

### pdfjs/

Loads pdf.js on first use with the package's worker and files, as 0.x does
(`engine/bundled.ts`, `scripts/pdfjs-files.ts`, the worker prelude, the
`?no-inline&url` queries, the legacy build), and holds what is specific to
how ParaPDF drives pdf.js: drawing a page or a region into a canvas, the
text layer's language fix, the link service, annotation icons, the
structure tree, form storage, and the annotation editor. No interface
stands between this and the rest: callers use pdf.js's types.

### document/

`DocumentSession` is one open document: pdf.js's `PDFDocumentProxy`, its
pages' `PDFPageProxy` objects, the pages' sizes (the first page's size for
all at once, then the real ones in the background), page labels, outline,
metadata, attachments, permissions, the document's initial view, layer
state (`OptionalContentConfig` and its print copy), and the text of pages
read for search and `getText()`.

- Sessions are shared by every viewer of the same source through a
  registry keyed by the source, released one second after the last viewer
  leaves, so StrictMode and quick remounts open once (0.x
  `runtime/documents.ts`).
- A session owns an `AbortController`. Everything started for it (drawing,
  text, searches, background passes, the editor) takes its signal, and
  closing aborts it all: no generation counters, no "is this still the
  document" checks.
- Encrypted documents ask any of their viewers for a password, as 0.x does.

During the migration, M2 retains a separate session for each viewer that
edits annotations: the current editor managers would otherwise collide in
pdf.js's annotation storage. This is temporary, not an exception to the
shared-session target. M4 moves editing to the feature modules and removes
this isolation, verifying edits and saving across viewers of one session.
M6 moves document state out of the viewer stores into the session's store
and settles the public session surface; M2's exposed lifecycle methods are
not the final React API.

### view/

A `Viewer` is one viewport onto a session. Several viewers may show one
session at once, each with its own scroll position, zoom, rotation, spreads,
scroll mode, and tool: a split view, or thumbnails beside the pages.

- Layout stays pure and immutable per zoom (typed arrays, rows, spreads,
  scroll modes, `pageLeft`/`pageTop`, `zoomTarget`), as in 0.x
  `runtime/layout.ts`.
- Gestures stay as in 0.x `runtime/gestures.ts`: a CSS transform previews a
  zoom, which commits where the preview showed it; touch, wheel, and
  Safari's gesture events; swipes in "page" mode.
- Navigation core: `goToPage`, destinations with their zoom, and the
  current page's rules. The back and forward stacks are the history
  feature's.
- A viewer has an `AbortController` of its own, aborted when its viewport
  goes.

### render/

The renderer draws a viewer's mounted pages. It splits what 0.x
`runtime/scheduler.ts` does in one class:

- The planner is a pure function from the layout, the viewport, the
  devicePixelRatio, whether scrolling has settled, the budgets, and what
  each page shows and draws now, to the layers wanted, in order. The budgets and
  heuristics carry over unchanged and become unit-tested functions: a base
  at half a device pixel per CSS pixel up to 2 MP; a detail at full
  resolution, of the whole page within 16 MP, else of the visible area
  grown within the budget and redrawn when lopsided; reduced resolution in
  quarter-octave steps within `maxCanvasPixels`; visible pages first; no
  base under a whole-page detail; a quick detail without a base for pages
  within four bases' worth.
- The executor compares the plan with what pages show and draw, and starts,
  cancels, and releases drawings, and keeps the canvases of pages that
  unmount (decision 0004). Zoomed past a page's whole-page detail budget,
  it draws the page's base again: copying the whole-page detail into it
  instead was rejected in the form measured (decision 0008).
- The renderer owns each page's DOM inside the host React places: the
  canvases (base, detail, and the spare a new detail is drawn into while
  the old one shows), and the containers of the text, annotation, editor,
  and structure layers. A kept canvas moves into the page's next host
  without a copy.
- DOM layers are built one at a time, after scrolling settles, in idle time,
  never while a visible page waits for its first pixels: text, then the
  annotations being edited, then links and forms, as in 0.x. Text layers
  keep the zoom they were laid out at and follow later zooms with CSS.
- pdf.js draws on the main thread today. Its renderer worker, once a
  released pdfjs-dist has it, replaces that if it measures better.

### features/

A feature attaches to a session, a viewer, or both, and returns its state
and its API; detaching it undoes everything it added. The core never
imports a feature. A feature that changes how pages are drawn (forms shown
as fields, annotation editing) is enabled by an option of the viewer, which
loads it when set; any other feature is included by importing its hook.

Features: search (index, matches, highlights), history (back, forward),
view state (get and set), initial view (`/OpenAction`, `/PageLayout`,
`/PageMode`), permissions, forms (fields, values, changes, saving),
annotations (editing, import, export), print, download, thumbnails, layers
(optional content), attachments, selection (in PDF points), and text
(`getText()`).

### State

- Each viewer publishes its hot state, which changes while the reader
  scrolls or zooms (layout, mounted window, current page, scale, zoom mode),
  apart from its cold state (rotation, spreads, scroll mode, tool).
- Each session publishes its document state (status, progress, password
  request, page count, permissions) and loads its secondary data (outline,
  labels, metadata, attachments, layers) as promises that React reads with
  `use()`.
- Each feature publishes its own state.
- React reads all of it through `useSyncExternalStore` selectors, and
  commits only when a selected value changes: in the hot path, when the
  mounted window or the current page does.

## React API

The shape is decided here; M6 settles the names in this file before it
implements them.

```tsx
const viewer = useViewer(); // one viewport's controller and state

<PdfDocument source="/manual.pdf">
  <Toolbar viewer={viewer} /> {/* useViewState(viewer, (v) => v.currentPage); viewer.goToPage(4) */}
  <PdfViewer
    viewer={viewer}
    defaultZoom="fit-width" // uncontrolled; or zoom={…} onZoomChange={…}
    scrollMode={scrollMode} // controlled: rotation, spread, scrollMode, tool alike
    onPageChange={setPage} // the current page is reported, set with goToPage()
    textLayer
    forms // options are live: changing one needs no remount
    renderOverlay={(page) => <Notes page={page} />} // a portal into the page's host
  />
  <PdfThumbnails onSelect={(page) => viewer.goToPage(page)} /> {/* another view of the same document */}
</PdfDocument>
```

- `PdfDocument` opens or joins a session and renders its children at once;
  nothing suspends before the first page draws (0.x measured 270 ms lost
  when the demo waited for pdf.js in a Suspense boundary).
- Options are props and stay live. The budgets, layers, and links are
  props of `PdfViewer`.
- Coarse view state (zoom or zoom mode, rotation, spreads, scroll mode,
  tool) can be controlled or not. The current page is never controlled: it
  changes as the reader scrolls, so it is reported and set by `goToPage()`.
- Secondary data reads with `use()` through hooks (outline, labels,
  metadata, attachments, layers, form fields), under the application's own
  Suspense boundaries.
- Server rendering stays as in 0.x: modules declare `"use client"`, the
  viewer renders an empty viewport on the server, and a URL source's
  preload goes into the page's head.

## Ported unchanged

These encode measured behavior. Port them, keep their tests, and read
`docs/history/AGENTS-v0.md` for why they are as they are; do not redesign
them in passing:

- `runtime/layout.ts`, `runtime/scrolling.ts`, `runtime/gestures.ts`.
- `runtime/text-search.ts` (pdf.js's find normalization),
  `runtime/highlights.ts`, `runtime/document-text.ts`.
- `runtime/selection.ts` (the selection tracker and its browser fixes).
- `engine/struct-tree.ts`, `engine/pdfjs-forms.ts`, `engine/pdfjs-editor.ts`
  and its workarounds, `runtime/print.ts`.
- The bundling of pdf.js's files: `engine/bundled.ts`,
  `scripts/pdfjs-files.ts`, `scripts/worker-prelude.js`.
- The viewer CSS and its accessibility semantics: a focusable labelled
  `role="document"` viewport, pages as labelled regions, canvases hidden
  from assistive technology, text layers in the document's language.

## Where 0.x code goes

| 0.x | Target |
|---|---|
| `engine/types.ts` | pdf.js's own types; the data types the API publishes (`PdfSource`, `FormField`, `OutlineNode`, …) move to the module that publishes them |
| `engine/pdfjs.ts`, `engine/bundled.ts`, `engine/pdfjs-*.ts`, `engine/struct-tree.ts` | `pdfjs/` |
| `runtime/documents.ts` | `document/` |
| `runtime/viewer.ts` | split into `document/` (lifecycle, background loading), `view/` (layout, zoom, scrolling, navigation), and `features/` (everything else) |
| `runtime/scheduler.ts` | `render/` (planner and executor) |
| `runtime/layout.ts`, `runtime/scrolling.ts`, `runtime/gestures.ts` | `view/` |
| `runtime/text-search.ts`, `runtime/highlights.ts` | `features/search/` |
| `runtime/thumbnails.ts`, `runtime/print.ts`, `runtime/document-text.ts`, `runtime/selection.ts` | `features/` (the selection tracker goes with the text layer in `render/`) |
| `react/*` | `react/`, reshaped in M6 |

## Testing

- Node unit tests for every pure module: layout, the planner and its
  invariants (a visible page never blank, budgets kept except by visible
  bases, no base under a whole-page detail), geometry, gestures' math,
  search, the session registry, and the features' logic.
- The Playwright functional checks (`check:*`) are the behavioral
  contract; changing an API on purpose changes them in the same change.
- Performance: the benchmarks compare each milestone with the build before
  it in the same run; a regression stops the milestone unless a decision
  accepts it.

## Open questions

- The default of `maxKeptPixels` (decision 0004).
- A form of decision 0008's copied base that keeps its gains on
  phone-sized viewports without its losses on desktop-sized ones.
- When pdf.js's renderer worker reaches a release: measure it, then decide.
- Text layers for unmounted pages, so that the browser's own find and
  assistive technology reach the whole document.
- The final names of the React API (M6).
