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

Viewers that edit annotations share their session too (M4): each edits
with an editor of its own on the document's one annotation storage, under
ids unique to the session. Saving and printing, from any viewer, include
what every viewer created; a viewer shows the annotations it created, not
those of the others (see "Open questions"). A viewer whose viewport is
hidden leaves its annotations in the storage, and shows them again when it
returns; closing a viewer removes them, as closing the document did before.

The session's state and its public surface (M6):

- The registry's entry for a source publishes the session's document state
  in a store of its own from the moment it starts to open, before pdf.js's
  document exists: status (`"loading"`, `"password"`, `"ready"`,
  `"error"`), the error, why a password is asked for, load progress (once
  an animation frame), and, once ready, the page count and permissions,
  which it reads before it says so. Every viewer of the session reads that
  one store; viewers keep only view state.
- Applications see a `PdfSession`, one per `PdfDocument`: its `state`, a
  `submitPassword()` that answers the request any viewer of the document
  may answer, pdf.js's `proxy` once ready, and the promises of its
  secondary data (outline, page labels, metadata, attachments, layers,
  form fields, the initial view), each read once and settled with an empty
  value when the read or the document fails. A `PdfSession` has no method
  that opens, closes, or releases anything: `PdfDocument` holds its lease
  and gives it back, and a viewer that shows it stops when it closes.
- `passwordPrompt={false}` on a `PdfDocument` shows a password request as
  the error pdf.js gives without one, to that provider only: other
  providers of the same document may still answer.
- `DocumentSession`, the loaded document described above, stays what
  viewers, the renderer, and features work with; applications reach it
  only through features' hooks.

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

M3 moves the viewer and its layout, scrolling, and gestures into `view/`;
M4 moves its feature methods out. Hot and cold subscriptions are separate,
and since M6 a viewer's store holds view state only (the session's holds the
document's); its combined snapshot is the two together.

A viewer is created by `useViewer()` and lives as long as the component
that called it. It shows the session of the `PdfViewer` it is given to,
until that session closes (its `PdfDocument` unmounts or opens another
source), it is given to a viewer of another session, or the component that
created it unmounts. Its options are set by that `PdfViewer`'s props and
change while it shows a document: options the renderer is built with (the
layers, the colors, the budgets, concurrency) take the same path as a
viewport that detaches and reattaches, keeping the position and the edits;
the others apply at once.

A viewport detaching aborts its viewer work (drawing, searches, printing,
and background publishing). While its document provider and its viewer
remain, the viewer keeps the view and edits for reattachment. Unmounting the
provider releases its lease; only the last release closes the shared
session after the registry's grace period.

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

How features reach the core (M4):

- The viewer knows no feature by name. A feature registers hooks with
  `viewer.extend()`, which returns the function that removes them: the
  document is about to be laid out (`prepare`) or is ready (`ready`, with a
  signal that aborts when the document closes or the viewport detaches), a
  page's text layer was built or removed, a link or outline is about to
  jump, a named action the core does not handle, the pages' content changed,
  and what the reader is typing should be committed before saving or
  printing. Through the viewer's own methods a feature shows a destination,
  a view, or a rectangle of a page, reads and restores positions, turns
  form layers on, and gives the renderer an annotation editor.
- A feature with state keeps it in a store of its own, which its hook reads
  with `useSyncExternalStore`: search, history, and annotation editing. The
  viewer's store keeps its view state, the session's the document's state.
- The document's own data is read by the session (outline, labels,
  metadata, attachments, layers, permissions, the initial view) and read
  by React with `use()`; the features are what is done with it: following
  permissions, opening attachments, showing and hiding layers, arranging
  the pages as the document asks.
- Forms and annotation editing, which change how pages are drawn, are
  options of `PdfViewer`, which imports their module when one is set and,
  when it is set as the viewer opens a document, makes the viewer wait for
  it before its first layout; set later, it attaches to the open document,
  and unset, it detaches. A build that never
  sets them still emits their chunks; it loads none of them. Search, print,
  and the other features are imported by their hooks, or by the application
  calling them, and absent from builds that import neither.
- The opening view is an option of the viewer, a function of the session
  that the initial view feature makes from `initialView` and
  `initialViewState`, applied once per document; a viewport that reattaches
  returns to its position instead.

### State

- Each viewer publishes its hot state, which changes while the reader
  scrolls or zooms (layout, mounted window, current page, scale, zoom mode),
  apart from its cold state (rotation, spreads, scroll mode, tool).
- Each session publishes its document state (status, progress, password
  request, page count, permissions) and loads its secondary data (outline,
  labels, metadata, attachments, layers, form fields, the initial view) as
  promises that React reads with `use()`.
- Each feature publishes its own state.
- React reads all of it through `useSyncExternalStore` selectors, and
  commits only when a selected value changes: in the hot path, when the
  mounted window or the current page does.

## React API

Settled in M6.

```tsx
function Reader() {
  const viewer = useViewer(); // one viewport's controller and state
  const [scrollMode, setScrollMode] = useState<ScrollMode>("vertical");
  return (
    <PdfDocument source="/manual.pdf">
      <Toolbar viewer={viewer} /> {/* useViewState(viewer, (v) => v.currentPage); viewer.goToPage(4) */}
      <PdfViewer
        viewer={viewer}
        defaultZoom="fit-width" // uncontrolled; or zoom={…} onZoomChange={…}
        scrollMode={scrollMode} // controlled: rotation, spread, scrollMode, tool alike
        onScrollModeChange={setScrollMode}
        onPageChange={setPage} // the current page is reported, set with goToPage()
        textLayer
        forms // options are live: changing one needs no remount
        renderOverlay={(page) => <Notes page={page} />} // a portal into the page's host
      />
      <PdfThumbnails viewer={viewer} /> {/* the same document, beside the pages */}
    </PdfDocument>
  );
}
```

Components:

- `PdfDocument` (`source`, `passwordPrompt`, `children`) opens or joins the
  session of `source` and renders its children at once, giving them its
  `PdfSession`; nothing suspends before the first page draws (0.x measured
  270 ms lost when the demo waited for pdf.js in a Suspense boundary). A
  source with another URL, request headers, bytes, or password opens
  another; an equal new object keeps the open one.
- `PdfViewer` is one viewport. `viewer` is the `useViewer()` it shows the
  document with; without it, it uses one of its own. Its other props:
  - View state, each either controlled, by its value and its change
    callback, or uncontrolled, by its default: `zoom`, `defaultZoom`,
    `onZoomChange` (a scale in CSS pixels per point, `"fit-width"`, or
    `"fit-page"`), and `rotation`, `spread`, `scrollMode`, and `tool`
    likewise (`defaultRotation`, `onRotationChange`, …). A controlled value
    is what the viewer shows: it applies the value as it changes, reports
    every change of its own (the reader's gestures and keys, the viewer's
    methods) through the callback, and returns to the value once React has
    rendered without taking the change up. Defaults apply as the viewer
    opens a document. The current page is never controlled: `defaultPage`
    opens the document there, `onPageChange` hears it change, and
    `viewer.goToPage()` sets it. Callbacks are called from the viewer's own
    store subscriptions: they cost React nothing unless the application
    sets state in them.
  - The opening: `initialView` and `initialViewState`, as the initial view
    feature reads them; the props above that the application sets win.
  - Live options: `textLayer`, `annotationLayer`, `forms`,
    `annotationEditing`, `annotationLabels`, `enforcePermissions`,
    `destinationZoom`, `externalLinks`, `openAttachment`, `pageColors`,
    `gap`, `overscan`, `minScale`, `maxScale`, `maxConcurrentRenders`, and
    the budgets (`maxDetailPixels`, `maxDetailViewports`, `maxBasePixels`,
    `maxCanvasPixels`, `maxKeptPixels`).
  - Presentation: `className`, `style`, `label`, `pageLabel`, and
    `renderOverlay`, whose content React renders through a portal into a
    container the page's host holds after the renderer's layers; React
    renders nothing else into the host.
- `PdfThumbnails` (`viewer`, `width`, `onSelect`, `label`, `pageLabel`,
  `className`, `style`) lists the pages of the viewer's document as buttons
  with thumbnails, marks its current page, and goes to a page in it when
  chosen unless `onSelect` is given. Thumbnails follow the viewer's
  rotation and draw at a lower priority than its pages, so they need it.
  `PdfThumbnail` (`viewer`, `pageIndex`, `width`) is one of them, for lists
  of the application's own.
- `PdfPageRect` (`x`, `y`, `width`, `height` in PDF points) places content
  over the page of the overlay it is rendered in.

Hooks, named without a `Pdf` prefix:

- `useViewer()`: a `Viewer`, for the life of the calling component.
- `useViewState(viewer, selector)`: its view state (layout, mounted window,
  current page, scale, zoom mode, rotation, spread, scroll mode, tool).
- `useSession()`: the nearest `PdfDocument`'s `PdfSession`.
- `useDocumentState(selector)`: the session's document state.
- `useOutline()`, `usePageLabels()`, `useMetadata()`, `useAttachments()`,
  `useLayers()`, `useFormFields()`, `useInitialView()`: secondary data,
  read with `use()` under the application's own Suspense boundaries.
  Layers follow their visibility as it changes; form fields are their
  values as first read, which `getFormFields()` reads again.
- A viewer's features: `useSearch(viewer)`, `useHistory(viewer)` (back and
  forward), `useAnnotations(viewer)` and `useAnnotationEditing(viewer)`
  (its state with its methods, or the feature with its store),
  `useFormChange(viewer, listener)`, and `useSelection(viewer)`.

Functions keep taking the viewer they act through (`print(viewer)`,
`download(viewer)`, `getText(viewer)`, `getViewState(viewer)`, …).
Opening a viewer's document, attaching its viewport, and releasing a session
are not part of the public API.

Server rendering stays as in 0.x: modules declare `"use client"`, the
viewer renders an empty viewport on the server, and a URL source's preload
goes into the page's head.

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
| `react/*` | `react/`, reshaped in M6 (see "React API") |

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
- Whether viewers of one session show the annotations other viewers create
  as they edit, beyond saving and printing them together (M4 shows each
  viewer's own).
