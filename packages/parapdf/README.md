# ParaPDF

A fast PDF viewer for React, built on [pdf.js](https://github.com/mozilla/pdf.js).

> **Status: 0.x, experimental.** The API may change in any minor release
> until 1.0. [parapdf.yhay81.com](https://parapdf.yhay81.com) has guides with
> examples that run, and a [live demo](https://parapdf.yhay81.com/demo/).
> Upgrading from 0.4 or earlier: the
> [changelog](https://github.com/yhay81/parapdf/blob/main/CHANGELOG.md) lists
> every change.

- **React stays out of the hot path.** Scrolling and zooming commit no React
  state per frame: React renders only when the set of mounted pages or the
  current page changes, and pixels never pass through React.
- **Only what is near the viewport exists.** Pages outside a small window are
  unmounted. Each page draws a quick low-resolution base first and full
  device resolution once scrolling settles, and after a zoom keeps showing
  its old drawing, scaled, until the new one is complete; at high zoom only
  the visible part is drawn sharp, within pixel budgets you can set for
  memory-capped browsers such as iOS Safari.
- **Pages you come back to show at once.** A page that leaves the window
  keeps its canvases, within a budget, so going back by a link, by
  scrolling, or by flipping shows it without drawing it again.
- **Several viewers, one document.** A split view, or thumbnails beside the
  pages: each viewer of a document has its own position, zoom, rotation,
  and layout, and the document is opened, parsed, and searched once for all
  of them.
- **A real document.** pdf.js text layers make pages selectable and expose
  their text to assistive technology, in the structure a tagged PDF gives
  them; whole-document search matches the way pdf.js's own viewer does,
  Japanese and other CJK text included; links, the outline, and back and
  forward stacks navigate within the document.
- **What a document viewer does.** Fillable forms that save into the PDF,
  annotations the reader creates, layers, attachments, page labels,
  thumbnails, printing, two-page spreads, scrolling sideways, in rows, or a
  page at a time, encrypted documents, and selections in PDF coordinates for
  your own highlights.
- **You load what you use.** Forms and annotation editing load their code
  when their prop is set; search, printing, and the other features are in
  your bundle only when you import them.
- **Gestures.** Ctrl or ⌘ with the wheel, trackpad pinches, touch pinches,
  and Safari's gesture events zoom the document instead of the page; Ctrl or
  ⌘ with +, -, and 0 too, and a hand tool drags it.
- **pdf.js included.** ParaPDF ships pdf.js with its worker and the files it
  loads on demand, and your bundler serves them from your application's
  origin: there is nothing to set up.

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

- `PdfDocument` opens the document and gives it to everything inside it;
  `PdfViewer` is a scroll container that shows it. Give the viewer a
  definite height, as above or through a flex or grid layout: it contains
  its own layout and does not grow with the document.
- The first `PdfDocument` to render loads pdf.js and starts its worker, and
  each one starts downloading its PDF while it renders, from the page's
  head when the page is rendered on the server. pdf.js takes the preloaded
  response, so the PDF downloads once (see [Limitations](#limitations) for
  Safari). Nothing suspends: the viewer shows the first page as soon as it
  is drawn.
- The viewer shows no loading state or error of its own: read them with
  [`useDocumentState()`](#the-document).
- This works as it is with bundlers that emit files referenced with
  `new URL(…, import.meta.url)`: see [Bundlers](#bundlers).

## Viewers and controls

A viewer is one viewport's controller and state. `useViewer()` creates one
for the life of the component that calls it; give it to the `PdfViewer`
that shows it, and to the hooks and functions that act through it:

```tsx
import { PdfDocument, PdfViewer, useDocumentState, useViewer, useViewState, type Viewer } from "parapdf";

export function Reader() {
  const viewer = useViewer();
  return (
    <PdfDocument source="/manual.pdf">
      <Toolbar viewer={viewer} />
      <PdfViewer viewer={viewer} style={{ height: "80vh" }} />
    </PdfDocument>
  );
}

function Toolbar({ viewer }: { viewer: Viewer }) {
  const page = useViewState(viewer, (state) => state.currentPage);
  const pageCount = useDocumentState((state) => state.pageCount);
  // CSS pixels per PDF point; 96 / 72 shows a page at its printed size.
  const scale = useViewState(viewer, (state) => state.scale);
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

A `PdfViewer` given no `viewer` uses one of its own, which nothing else can
reach: create one with `useViewer()` as soon as anything outside the viewer
needs it.

`useViewState(viewer, selector)` re-renders its component only when the
selected value changes; return a primitive or an object the state already
holds. The view state (`ViewerState`) has:

| Field | Meaning |
|---|---|
| `currentPage` | The zero-based page being read: the one nearest the viewport's center, except that the current page stays current while all of it is in view, and that navigation makes the page it shows current. |
| `scale`, `zoomMode` | CSS pixels per PDF point; `"fit-width"` or `"fit-page"` while the page is fitted as the viewport resizes, otherwise `"custom"`. |
| `rotation`, `spread`, `scrollMode` | The view's clockwise rotation (0, 90, 180, or 270); `"none"`, `"odd"`, or `"even"`; and `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"` (see [Scroll modes](#scroll-modes-spreads-and-fitting)). |
| `tool` | What a mouse drag does: `"select"` text, or scroll the document with the `"hand"`. |
| `first`, `last` | The mounted pages: those in view and `overscan` more on each side. |
| `layout` | The pages laid out at the current zoom (their sizes and places); null until a document shows. |

A viewer's methods change the view: `goToPage(index)`, `nextPage()` and
`previousPage()` (by a whole spread or row), `zoomBy(factor)`,
`setScale(scale | "fit-width" | "fit-page")`, `resetScale()`,
`rotate(degrees)`, `setRotation(rotation)`, `setSpread(spread)`,
`setScrollMode(mode)`, `setTool("select" | "hand")`, and
`goToDestination(dest)` (see [Links](#links-outline-and-history)).
The viewport is focusable: the arrow, Page Up, Page Down, Home, End, and
space keys scroll it, or flip pages in `"page"` mode, and Ctrl or ⌘ with +,
-, and 0 zoom in, out, and back to the zoom it opened with.

### Controlled view state

The zoom, rotation, spread, scroll mode, and tool are each either left to
the viewer, with a default it opens with, or controlled by a prop and its
change callback, as React's inputs are:

```tsx
import { PdfViewer, type ScrollMode, type Zoom } from "parapdf";
import { useState } from "react";

function ControlledViewer() {
  const [zoom, setZoom] = useState<Zoom>("fit-width");
  const [scrollMode, setScrollMode] = useState<ScrollMode>("vertical");
  return (
    <PdfViewer
      zoom={zoom}
      onZoomChange={setZoom}
      scrollMode={scrollMode}
      onScrollModeChange={setScrollMode}
      defaultSpread="odd"
      onPageChange={(pageIndex) => console.log("page", pageIndex + 1)}
      style={{ height: "100vh" }}
    />
  );
}
```

| Controlled | Change callback | Uncontrolled default |
|---|---|---|
| `zoom` (a scale in CSS pixels per point, `"fit-width"`, or `"fit-page"`) | `onZoomChange` | `defaultZoom` (`"fit-width"`) |
| `rotation` | `onRotationChange` | `defaultRotation` (`0`) |
| `spread` | `onSpreadChange` | `defaultSpread` (`"none"`) |
| `scrollMode` | `onScrollModeChange` | `defaultScrollMode` (`"vertical"`) |
| `tool` | `onToolChange` | `defaultTool` (`"select"`) |

A controlled value is what the viewer shows. The viewer applies it as it
changes, reports every change of its own (the reader's gestures and keys,
its methods) through the callback, and returns to the value once React has
rendered without taking the change up. Defaults apply as the viewer opens a
document.

The current page is never controlled: `defaultPage` opens the document
there, `onPageChange` hears it change, and `viewer.goToPage()` sets it. The
callbacks are called from the viewer's own subscriptions, so they cost
React nothing unless the application sets state in them.

## The document

Components inside `<PdfDocument>` read the document's state with
`useDocumentState(selector)`, which re-renders as `useViewState()` does:

| Field | Meaning |
|---|---|
| `status`, `error` | `"loading"`, `"password"` (see [Encrypted documents](#encrypted-documents)), `"ready"`, or `"error"`, and the error's message. |
| `passwordReason` | Why a password is asked for: `"required"` or `"incorrect"`; null while none is. |
| `progress` | `{ loaded, total }` bytes of the document received, `total` null when the server did not say; null before any arrive. |
| `pageCount` | Pages in the document; 0 until it is ready. |
| `permissions` | What the document permits (see [Permissions](#permissions)); null until it is ready. |

```tsx
import { useDocumentState } from "parapdf";

function DocumentStatus() {
  const status = useDocumentState((state) => state.status);
  const error = useDocumentState((state) => state.error);
  if (status === "error") return <p role="alert">{error}</p>;
  return status === "loading" ? <p role="status">Loading…</p> : null;
}
```

The rest of what the document holds is read once, when a component first
asks for it, with React's `use()`. These hooks suspend until it is read:
render them under Suspense boundaries of your own, apart from the viewer,
which never waits for them.

| Hook | Returns |
|---|---|
| `useOutline()` | The outline (bookmarks) as `OutlineNode`s: `title`, `dest`, `url`, `bold`, `italic`, and `items`; empty when there is none. |
| `usePageLabels()` | Each page's label, such as `"iv"` or `"A-3"`; null when the document defines none. |
| `useMetadata()` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language; null when they cannot be read. |
| `useAttachments()` | The embedded files (see [Layers and attachments](#layers-and-attachments)). |
| `useLayers()` | The layers (see [Layers and attachments](#layers-and-attachments)), following their visibility as it changes. |
| `useFormFields()` | The form fields with their values as first read (see [Forms](#forms-printing-and-saving)). |
| `useInitialView()` | How the document asks to be shown (see [The document's initial view](#the-documents-initial-view)); null when it cannot be read. |

A read that fails, or a document that fails, gives the empty value instead
of an error.

`useSession()` returns the nearest `PdfDocument`'s `PdfSession`: its
`source`, its `state` (the store `useDocumentState()` reads),
`submitPassword()`, pdf.js's `proxy` once ready (see
[pdf.js's own API](#pdfjss-own-api)), a `signal` that aborts when the
`PdfDocument` lets the document go, and the promises the hooks above read
(`outline()`, `pageLabels()`, `metadata()`, `attachments()`, `layers()`,
`initialView()`).

## Search

```tsx
import { useSearch, type Viewer } from "parapdf";

function Find({ viewer }: { viewer: Viewer }) {
  const search = useSearch(viewer);
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

`useSearch(viewer)` gives the viewer's search state, `query`, `options`,
`status`, `matches`, `current` (-1 when none is selected), and
`pagesSearched`, with `search(query, options)`, `next()`, `previous()`, and
`clear()`. Every component that calls it shares the viewer's one search.

Search covers the whole document, not only the mounted pages, and streams
results page by page (`status` is `"searching"`, then `"done"`); the first
match at or after the current page is selected and scrolled into view. Like
pdf.js's viewer, it ignores case, diacritics, and full-width forms, and joins
words that a line end splits, such as a hyphenated word or Japanese text.
Matches are painted with the CSS Custom Highlight API; style them with
`::highlight(parapdf-search)` and `::highlight(parapdf-search-current)`.
Debounce `search()` while the user types. The pages' text is read once for
every viewer of the document.

`search(query, options)` takes the options of pdf.js's find bar, all off by
default: `caseSensitive`, `entireWord` (a match must not be part of a longer
word), and `matchDiacritics` (é no longer matches e).

Without React, `searchOf(viewer)` returns the same search, with a `store` to
subscribe to, and `attachSearch(viewer)` a separate one; `detach()` removes
either.

## Document text

`getText(viewer, options)` reads the document's text from every page,
mounted or not, as search reads it: the text runs in content order, "\n"
where a line ends, and an empty line between pages.

```ts
const { text, pages } = await getText(viewer);
// pages: [{ pageIndex: 0, text: "…", offset: 0 }, …], where offset is the page's start in text
```

- `from` and `to` narrow it to pages (`{ from: 2, to: 4 }` reads pages 3
  to 5) or to points in the text: a search match's ends,
  `{ pageIndex: match.pageIndex, ...match.start }` and `...match.end`, or a
  selection's, `getSelection(viewer).start` and `.end`. A point is included
  as a start and excluded as an end.
- `lineBreaks: "join"` joins lines as search does: without a space inside a
  word hyphenated across lines and in Japanese and Chinese text, with one
  elsewhere.
- `signal` stops a read, which then rejects with the signal's reason.

Pages are parsed in pdf.js's worker a few at a time, and the text is kept:
a second read, or a search, parses nothing again. The browser's selection
covers only mounted pages; to copy a range longer than those, read it with
`getText()` between the points where it starts and ends.

## Links, outline, and history

Links inside the document and its outline jump through the viewer:

```tsx
import { type OutlineNode, useHistory, useOutline, type Viewer } from "parapdf";
import { Suspense } from "react";

function Outline({ viewer }: { viewer: Viewer }) {
  const outline = useOutline();
  const list = (items: readonly OutlineNode[]) => (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          <button type="button" onClick={() => void viewer.goToDestination(item.dest)}>
            {item.title}
          </button>
          {item.items.length > 0 ? list(item.items) : null}
        </li>
      ))}
    </ul>
  );
  return outline.length > 0 ? <nav aria-label="Outline">{list(outline)}</nav> : null;
}

function BackForward({ viewer }: { viewer: Viewer }) {
  const history = useHistory(viewer);
  return (
    <>
      <button type="button" disabled={!history.canGoBack} onClick={history.back}>Back</button>
      <button type="button" disabled={!history.canGoForward} onClick={history.forward}>Forward</button>
    </>
  );
}

function Sidebar({ viewer }: { viewer: Viewer }) {
  return (
    <Suspense fallback={null}>
      <BackForward viewer={viewer} />
      <Outline viewer={viewer} />
    </Suspense>
  );
}
```

A destination shows its point at the viewport's top-left corner, with the
zoom it asks for, as in pdf.js: `XYZ` with a zoom factor (1 is the printed
size), `Fit` the whole page, `FitH` the page's width, `FitV` its height, and
`FitR` its rectangle filling the viewport; `fit-width` and `fit-page` keep
fitting as the viewport resizes. `destinationZoom={false}` keeps the zoom
and only scrolls. `goToDestination()` resolves to false for a destination
that does not exist, or the null of an outline entry without one.

`useHistory(viewer)` keeps where the viewer's links, outline entries, and
named actions jumped from: `back()` returns to the position and zoom before
the last jump, and `forward()` to where `back()` left; a new jump forgets
the positions `forward()` had. `canGoBack` and `canGoForward` say whether
there is one, and the `GoBack` and `GoForward` actions of a PDF's links
call them. The history starts with the first call of `useHistory()` (or of
`historyOf(viewer)`, without React) and stays until its `detach()`. Links to
other documents open in a new tab; `externalLinks="disabled"` leaves them
inert.

## Keeping the view

`getViewState(viewer)` returns where and how the viewer shows its
document, as a plain object to store or put in a URL: the `page` at the
viewport's top-left corner, the point of that page there (`x`, `y`, in PDF
points from its top-left corner), `scale` (a number, `"fit-width"`, or
`"fit-page"`), `rotation`, `spread`, and `scrollMode`; null until the
document is ready. The point keeps its place on the page whatever the zoom
or the viewport's size, so the view moves between a phone and a desktop.

`setViewState(viewer, view)` shows such a view again, and the
`initialViewState` prop opens the document with it, before anything is
drawn elsewhere; it wins over `defaultPage`, the zoom, the spread, the
scroll mode, and `initialView`, and the fields it leaves out still follow
them. Neither adds a history entry, and values out of range are clamped or
ignored, so a view read from a URL needs no checking:

```tsx
import { getViewState, PdfDocument, PdfViewer, useViewer, type ViewState } from "parapdf";
import { useEffect, useState } from "react";

// Reopen where the reader left off.
function ResumingReader({ url }: { url: string }) {
  const viewer = useViewer();
  const [saved] = useState(() => {
    const stored = localStorage.getItem(`view:${url}`);
    return stored ? (JSON.parse(stored) as Partial<ViewState>) : undefined;
  });
  useEffect(() => {
    const save = () => {
      const view = getViewState(viewer);
      if (view) localStorage.setItem(`view:${url}`, JSON.stringify(view));
    };
    // When the page is left, and as the reader moves through the document.
    const unsubscribe = viewer.store.subscribe(save);
    window.addEventListener("pagehide", save);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", save);
    };
  }, [viewer, url]);
  return (
    <PdfDocument source={url}>
      <PdfViewer viewer={viewer} initialViewState={saved} style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

The viewer's store publishes as the mounted pages, the current page, and
the zoom change, not at every scrolled frame, so saving there costs little.

## The document's initial view

A PDF may ask where it opens (`/OpenAction`), how its pages are arranged
(`/PageLayout`), and which panel shows beside them (`/PageMode`).
`useInitialView()` reports them: `destination`, `pageLayout`
(`"SinglePage"`, `"OneColumn"`, `"TwoColumnLeft"`, `"TwoColumnRight"`,
`"TwoPageLeft"`, or `"TwoPageRight"`), and `pageMode` (`"UseNone"`,
`"UseOutlines"`, `"UseThumbs"`, `"FullScreen"`, `"UseOC"`, or
`"UseAttachments"`), each null when the document asks nothing.

With `initialView="document"`, the viewer opens at the destination, with
its zoom, and arranges the pages as pdf.js's viewer does: two columns are
`"odd"` or `"even"` spreads, and the `TwoPage` and `SinglePage` layouts show
one row at a time (`"page"` mode). What you set wins: `defaultPage` over
the destination, the zoom over its zoom, and the spread and the scroll mode
over the layout, whether controlled or by default. The panel is the
application's to open:

```tsx
// Under a Suspense boundary, as useInitialView() suspends until it is read.
function useDocumentPanel() {
  const pageMode = useInitialView()?.pageMode ?? null;
  const [panel, setPanel] = useState<"outline" | "thumbnails" | null>(null);
  useEffect(() => {
    if (pageMode === "UseOutlines") setPanel("outline");
    if (pageMode === "UseThumbs") setPanel("thumbnails");
  }, [pageMode]);
  return [panel, setPanel] as const;
}
```

## Thumbnails

`PdfThumbnails` lists the pages of a viewer's document as buttons with
thumbnails, marks its current page, and goes to a page when it is chosen:

```tsx
<PdfDocument source="/manual.pdf">
  <div style={{ display: "flex", height: "100vh" }}>
    <PdfThumbnails viewer={viewer} width={120} style={{ overflow: "auto" }} />
    <PdfViewer viewer={viewer} style={{ flex: 1 }} />
  </div>
</PdfDocument>
```

- `width` is each thumbnail's width in CSS pixels (120 by default);
  `onSelect(pageIndex)` replaces going to the page; `label` names the list
  ("Page thumbnails" by default) and `pageLabel(pageNumber, pageCount)` each
  button ("Page 3 of 12" by default), for example with `usePageLabels()`.
- Thumbnails follow the viewer's rotation and draw at a lower priority than
  its pages, from their drawing when the viewer already has one, so they
  need the viewer shown in a `PdfViewer`. Only thumbnails near the visible
  part of their scroll container hold pixels, so a list of every page stays
  cheap.
- `PdfThumbnail` (`viewer`, `pageIndex`, `width`) is one of them, for lists
  of your own. It is a picture: wrap it in a button labelled with the page.

## Forms, printing, and saving

With `forms`, form fields become inputs, check boxes, radio buttons, and
lists the reader can fill in; without it, they show as the PDF draws them.
What the reader types belongs to the document:

- `save(viewer)` resolves to the PDF's bytes with the values written in,
  and `download(viewer, filename?)` hands them to the browser as a download,
  named after the document's URL by default.
- `print(viewer, { resolution, onProgress, signal })` draws every page for
  printing, the typed values included, at 150 dpi by default, and opens the
  browser's print dialog with only those pages. A new print request stops
  the previous job; that job resolves without opening another dialog.

Applications read and fill the form themselves:

```tsx
import { getFormFields, setFormValues, useFormChange, type Viewer } from "parapdf";

function FormSync({ viewer, onChange }: { viewer: Viewer; onChange: (name: string, value: unknown) => void }) {
  // Each value the reader enters, as they type.
  useFormChange(viewer, ({ name, value }) => onChange(name, value));
  const fill = async () => {
    const fields = await getFormFields(viewer);
    console.log(fields.map(({ name, type, value }) => [name, type, value]));
    await setFormValues(viewer, { name: "Ada Lovelace", agree: true, size: "large" });
  };
  return <button type="button" onClick={fill}>Fill in</button>;
}
```

- `getFormFields(viewer)` resolves to every field (`FormField`): its
  qualified `name`, `type` (`"text"`, `"checkbox"`, `"radio"`,
  `"combobox"`, `"listbox"`, `"button"`, or `"signature"`), current `value`,
  `defaultValue`, `readOnly`, `required`, `multiple`, the `options` of a
  list, the `exportValues` that check its boxes, and its `widgets`, each a
  page and a rectangle in PDF points. A value is text, the export value of
  the checked box or radio button (`"Off"` for none), or the selected
  options' export values, an array for a list that takes several.
  `useFormFields()` gives the fields as first read, under Suspense.
- `setFormValues(viewer, values)` sets fields by name, `true` and `false`
  checking the first box or none, and resolves to the names it set. The
  fields shown show the values, and `save()` and `print()` include them; it
  is not heard as the reader's input.
- `useFormChange(viewer, listener)` hears `{ name, value }` for each value
  the reader enters, with `forms` on.

The values belong to the document, so every viewer of it shows them. Form
scripts (JavaScript actions) do not run.

## Permissions

An encrypted PDF may refuse printing, copying, changing, or annotating it.
The document state's `permissions` reports what it permits: `print`,
`printHighQuality`, `modify`, `copy`, `copyForAccessibility`, `annotate`,
`fillForms`, and `assemble`, and `restricted`, true when any of them is
false. Documents that are not encrypted permit everything.

The viewer only reports them unless `enforcePermissions` is set, as in
pdf.js. Then, without `copy`, the text cannot be selected or copied, though
assistive technology still reads it; without `print`, `print()` fails;
without `annotate`, `annotationEditing` stays off; and form fields can be
filled in with `fillForms` or `annotate`. `permits(viewer, what)` says
whether a viewer lets something be done. Permissions are advisory: a
document that opens can be read whole by any program that ignores them, so
they protect nothing an application must keep secret.

## Annotations

With `annotationEditing`, the reader can create highlights, text, drawings,
images, and signatures, with pdf.js's editors. `useAnnotations(viewer)`
gives the editing state and its methods, or null until the editor's code
has loaded and while the prop is off. Its `setTool(tool)` chooses what a
pointer does on the pages:

| Tool | |
|---|---|
| `"highlight"` | Selecting text highlights it; a drag outside text highlights freehand. |
| `"freetext"` | A click adds text where the reader types. |
| `"ink"` | A drag draws. |
| `"stamp"`, `"signature"` | Select and move images and signatures, which `addImage()` and `addSignature()` add. |
| `"none"` | The default: annotations show, but cannot be selected. |

With any tool, the reader selects, moves, resizes, and deletes the
annotations created, and a selected one shows pdf.js's small toolbar with
its color and a delete button. Ctrl or ⌘ with Z undoes, and the arrow keys
move what is selected.

```tsx
import { useAnnotations, type Viewer } from "parapdf";

function AnnotationTools({ viewer }: { viewer: Viewer }) {
  const annotations = useAnnotations(viewer);
  if (!annotations) return null;
  const ink = annotations.styles?.ink;
  return (
    <div role="toolbar" aria-label="Annotations">
      <button
        type="button"
        aria-pressed={annotations.tool === "ink"}
        onClick={() => void annotations.setTool("ink")}
      >
        Draw
      </button>
      <input
        type="color"
        aria-label="Line color"
        value={ink?.color.toLowerCase() ?? "#000000"}
        onChange={(event) => annotations.setStyle("ink", { color: event.target.value })}
      />
      <button type="button" disabled={!annotations.state?.canUndo} onClick={annotations.undo}>
        Undo
      </button>
    </div>
  );
}
```

- `tool`, `state`, and `styles`: the tool chosen; whether there is something
  to undo or redo (`canUndo`, `canRedo`), whether annotations are selected
  (`hasSelection`), and whether there are any (`isEmpty`); and each tool's
  style, or the selected annotation's. `state` and `styles` are null until
  editing starts.
- `setStyle(tool, style)` restyles the selected annotations, or, with none
  selected, the next ones `tool` creates: `color` for each tool,
  `thickness` for `"ink"` and freehand highlights, `opacity` for `"ink"`,
  and `fontSize` for `"freetext"`, in PDF points.
- `undo()`, `redo()`, `deleteSelected()`, and `selectAll()`.
- `addImage(image, { pageIndex, altText })` adds an image, a `Blob` or a
  URL, to the current page or `pageIndex`, in the middle of its visible
  part, and selects it. `altText` describes it to assistive technology, in
  the saved PDF too.
- `addSignature(signature, { pageIndex, description })` adds a signature
  the same way, from typed text (`{ text, fontFamily }`, italic serif by
  default), an image (`{ image }`, whose outline is traced), or strokes the
  application drew (`{ strokes, width, height, thickness }`, each stroke a
  list of x and y coordinates in a box of `width` by `height`). ParaPDF
  shows no signature pad or dialog of its own.

Both addition methods resolve to `true` once the annotation is ready to
save or export, or `false` if it cannot be added. Await them before saving;
an image's download, decoding, or signature tracing may take time.
Choosing another annotation tool while either addition is pending cancels
that insertion, which resolves to `false`. Empty or untraceable signatures
also resolve to `false`, without adding an annotation or undo step.

Annotations go into the document's bytes that `save()`, `download()`, and
`print()` use, those every viewer of the document created included. To
keep them apart from the PDF, say on a server, `export()` returns the
viewer's annotations as JSON-compatible data, and `import(annotations)`
adds them again where they were, after the same document opens again,
without an undo step, resolving to how many it added:

```ts
localStorage.setItem("annotations", JSON.stringify(annotations.export()));
// Later, once editing has started (state is not null):
await annotations.import(JSON.parse(localStorage.getItem("annotations") ?? "[]"));
```

Each exported annotation has `pageIndex`, `type` (the tool that made it),
and `data`, pdf.js's own description of it: keep `data` as it is. It is the
form pdf.js pastes copies in, which may change when ParaPDF moves to
another pdf.js; the changelog says when. Text being typed counts once it is
committed, when the reader clicks elsewhere or another tool is chosen.

A viewer keeps its annotations while its `PdfViewer` unmounts and shows
them again when it returns; they go when the viewer goes or the document
closes, so export or save them before. Each viewer shows the annotations it
created, not those of other viewers of the document. The editor's code and
styles load when the prop is set, so applications that do not edit
annotations do not download them. Thumbnails show pages without the
annotations created, as pdf.js's do. Label the editor's controls in the
application's language with `annotationLabels`; the defaults are pdf.js's
English names. `useAnnotationEditing(viewer)` gives the feature itself,
with a `store` to subscribe to, for code outside React.

## Encrypted documents

An encrypted document waits for its password with `status` `"password"`;
`passwordReason` says whether one is `"required"` or the last one was
`"incorrect"`. Answer with the session's `submitPassword(password)`, or
`submitPassword(null)` to give up, which fails the document:

```tsx
import { useDocumentState, useSession } from "parapdf";
import { useState } from "react";

function PasswordPrompt() {
  const session = useSession();
  const reason = useDocumentState((state) => state.passwordReason);
  const [password, setPassword] = useState("");
  if (!reason) return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        session.submitPassword(password);
      }}
    >
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
asks only when it is wrong. Changing `source.password` tries the new value
on the document still loading, even before its password request arrives.

An application without such a prompt sets `passwordPrompt={false}` on its
`PdfDocument`: an encrypted document then shows `status` `"error"` at once,
with the error pdf.js gives without a password, instead of waiting for a
password no one can type. Other `PdfDocument`s of the same source may still
answer the request.

## Layers and attachments

`useLayers()` lists the document's layers (optional content) in its own
order: `{ id, name, visible, children }`, where a heading that only groups
others has a null `id`. `setLayerVisible(viewer, id, visible)` shows or
hides one in every viewer of the document, its thumbnails, and its
printouts; showing one of a set of exclusive layers hides the others, and
links in the document that switch layers work too.

`useAttachments()` lists the embedded files as `{ id, filename,
description }`. `getAttachmentContent(viewer, id)` resolves to a file's
bytes, and `openAttachment(viewer, attachment)` does what activating a file
attachment annotation does: by default, the browser downloads the file. The
`openAttachment` prop of `PdfViewer` replaces that, for both.

## Scroll modes, spreads, and fitting

`setScrollMode()`, or the `scrollMode` prop, arranges pages as pdf.js's
viewer does: `"vertical"`, the default, stacks them top to bottom;
`"horizontal"` puts them in one row that scrolls sideways, centered in the
viewport's height; `"wrapped"` fills each row with as many pages as fit the
viewport's width, again when it resizes; `"page"` shows one page, or one
spread, at a time. In `"page"` mode, `goToPage()`, `nextPage()`,
`previousPage()`, links, and search flip pages, and so do the keys that
would scroll past the edge of the page shown: Page Down, space, and ↓ at its
bottom and → at its right edge go forward, and Page Up, Shift+space, ↑, and
← go back; Home and End go to the first and last page. On touch screens, a
one-finger swipe to the left or up turns to the next page, and to the right
or down back, like turning paper; short or slanted swipes, pinches, and
swipes with an annotation tool chosen do not. A zoomed page scrolls within
itself, and the pages beside it are drawn before they show: a swipe from
its edge turns it. The current page stays in view when the mode changes.

`setSpread("odd")` shows pages side by side in pairs, 1–2, 3–4; `"even"`
shows page 1 alone and pairs 2–3, 4–5, like a book with its cover; `"none"`
goes back to one page per row. Pairs stay together in every scroll mode: in
a wrapped row and when `"page"` mode flips. `setScale("fit-page")` fits all
of the current page, or of its spread, and keeps fitting it as the viewport
resizes; in a spread mode, fitting counts two pages, so the zoom stays the
same from row to row, as in pdf.js. In `"horizontal"` mode, where all pages
share one row, fitting counts one.

## Selections and highlights

`getSelection(viewer)` returns the text selected in the viewer and the
rectangles it covers, page by page, in the PDF points `PdfPageRect` takes,
so you can keep a selection as a highlight. `useSelection(viewer)` follows
it, at most once a frame while the reader drags:

```tsx
const selection = useSelection(viewer);
// { text: "…", pages: [{ pageIndex: 0, rects: [{ x, y, width, height }] }], start, end } or null
```

`start` and `end` are where the selection begins and ends in the document's
text, for [`getText()`](#document-text); null for an end outside the pages'
text.

## Overlays

`renderOverlay(pageIndex)` draws your own elements over pages. React
renders them through a portal into a layer of the page above its drawing
and text; place them with `PdfPageRect`, in PDF points from the page's
top-left corner. Overlays follow zoom and rotation through layout alone,
without rendering again:

```tsx
<PdfViewer
  style={{ height: "100vh" }}
  renderOverlay={(pageIndex) =>
    pageIndex === 0 ? (
      <PdfPageRect x={72} y={72} width={200} height={24}>
        <mark style={{ display: "block", height: "100%", opacity: 0.4 }} />
      </PdfPageRect>
    ) : null
  }
/>
```

## Several viewers

A `PdfDocument` may hold any number of viewers, each with its own position,
zoom, rotation, spread, scroll mode, tool, search, history, and pixel
budgets. The document is opened once for all of them: its pages' text, its
outline and other data, and its layers' visibility are read once and
shared, and its form values belong to it.

```tsx
function SplitView() {
  const left = useViewer();
  const right = useViewer();
  return (
    <PdfDocument source="/manual.pdf">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
        <PdfViewer viewer={left} />
        <PdfViewer viewer={right} defaultPage={10} />
      </div>
    </PdfDocument>
  );
}
```

A viewer lives as long as the component that called `useViewer()`. When
its `PdfViewer` unmounts, it stops drawing and searching but keeps its view
and annotations, and a `PdfViewer` given it again returns to where it was.
To keep a view while it is hidden, for example in React's `<Activity>`,
create the viewer above what hides it: a `PdfViewer`'s own viewer goes with
it. Documents of the same source are shared across `PdfDocument`s too, and
closed a second after the last one unmounts (see [Sources](#sources)).

## Viewer props

`PdfViewer`'s props are live: changing any of them needs no remount and
keeps the position and the edits. Besides `viewer`, the view state
[above](#controlled-view-state), `defaultPage`, `onPageChange`,
`initialView`, and `initialViewState`:

| Prop | Default | |
|---|---|---|
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links, comment popups, and, with `forms`, form fields. |
| `forms` | `false` | Form fields the reader can fill in (see [Forms](#forms-printing-and-saving)). |
| `annotationEditing` | `false` | Highlights, text, drawings, images, and signatures the reader creates (see [Annotations](#annotations)). |
| `annotationLabels` | English | The accessible names of the annotation editor's controls, such as `{ removeInk: "線を削除" }`. |
| `enforcePermissions` | `false` | Follow what the document permits (see [Permissions](#permissions)). |
| `destinationZoom` | `true` | `false` keeps the zoom when following links and the outline. |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert. |
| `openAttachment` | download | What opening an embedded file does: `({ filename, content }) => void`. |
| `pageColors` | none | `{ background, foreground }` to draw pages in two colors, for example `Canvas` and `CanvasText` in forced-colors mode. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas; larger pages are drawn sharp only around the visible area. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together, kept ones included. Kept canvases go first, then those of pages outside the viewport; past the budget, visible pages lose their sharp margin and then resolution, but keep their low-resolution canvases. |
| `maxKeptPixels` | six viewports' worth of device pixels | Pixels kept of the canvases of pages that leave the mounted window, so that a page the reader comes back to shows at once; `0` keeps none. Pages whose form fields are shown keep nothing. |
| `className`, `style` | | The scroll container's. |
| `label` | `"PDF document"` | The accessible name of the document. |
| `pageLabel` | `"Page 3 of 12"` | The accessible name of each page: `(pageNumber, pageCount) => string`. |
| `renderOverlay` | none | Content over each page (see [Overlays](#overlays)). |

`PdfDocument` takes `source` (see [Sources](#sources)), `passwordPrompt`
(see [Encrypted documents](#encrypted-documents)), and `children`.

## Configuring pdf.js

Most applications configure nothing. `configurePdfjs()`, called once before
the first `PdfDocument` renders, changes how ParaPDF loads pdf.js:

```tsx
import { configurePdfjs } from "parapdf";

configurePdfjs({ documentOptions: { withCredentials: true } });
```

| Option | |
|---|---|
| `assetBase` | Base URL of a copy of `node_modules/parapdf/pdfjs/`, ending with a slash, for bundlers that do not emit the files themselves (see [Bundlers](#bundlers)). |
| `imageResourcesPath` | Base URL of pdf.js's annotation icons, which comments without an appearance of their own show, ending with a slash. By default they are the icons the package ships, or `${assetBase}web/images/` with `assetBase`. |
| `workerSrc` | URL of pdf.js's worker script, when it is not `${assetBase}pdf.worker.js`. |
| `build` | `legacyBuild` from `parapdf/legacy`: pdf.js's legacy build for older browsers, with its worker and files from the package like the modern build's. |
| `pdfjs` | Loads another build of the same pdf.js version, with its worker as `workerSrc` and its files as `assetBase`. |
| `enableHWA` | GPU-backed canvases, `true` by default; `false` asks pdf.js for CPU-backed ones, which block the main thread for longer in Chromium and drop more frames in WebKit, though WebKit holds less memory with them. |
| `documentOptions` | More pdf.js `getDocument` parameters for every document, such as `withCredentials`, `httpHeaders`, or `password`. |
| `rendererSrc` | pdf.js's renderer worker (see [Limitations](#limitations)). |

`preloadPdfjs()` starts loading pdf.js and its worker before any
`PdfDocument` renders, for example when the pointer moves over a link to a
document.

For browsers that need pdf.js's legacy build:

```tsx
import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";

configurePdfjs({ build: legacyBuild });
```

Only applications that import `parapdf/legacy` emit the legacy worker, but
the modern worker, about 1.3 MB, is emitted either way: the build output
grows, the browser fetches only the worker it uses.

`pdfjsVersion` is the version of pdf.js the package ships, for URLs of
files you serve yourself.

## Bundlers

The package holds pdf.js's worker and the files pdf.js loads on demand:
CMaps for CJK text in fonts without their own encoding, the Symbol and
ZapfDingbats fonts, the JPEG 2000 and JBIG2 image decoders, and the ICC
profile and decoder pdf.js converts CMYK colors with. ParaPDF refers to
each with `new URL(…, import.meta.url)`, so bundlers copy them to the build
output, about 5 MB, and the browser fetches one only when a PDF needs it.
ParaPDF also asks bundlers not to inline the small ones as `data:` URLs,
which Vite does with files under 4 KB, so no `assetsInlineLimit` setting is
needed.
The worker's own URL passes it the others' URLs, so pdf.js manages colors as
it does with its files served from one directory: a fill in CMYK red (0, 1,
1, 0) shows as rgb(236 31 37), where pdf.js without its ICC profile shows
rgb(255 46 23).

That works as it is with Vite 8, webpack 5, Rsbuild 2, and Next.js 16
(Turbopack and webpack), in development and production builds: the
repository's checks install the packed package into an application of each
that configures nothing, on every change. Parcel 2 bundles the worker again into a script that
does not start, and esbuild and Bun copy none of the files. With those,
copy `node_modules/parapdf/pdfjs/` to where your application serves static
files, such as `public/pdfjs/`, and tell ParaPDF where it is:

```tsx
configurePdfjs({ assetBase: "/pdfjs/" });
```

With a Content Security Policy, the worker needs `worker-src 'self'` and the
decoders `script-src 'wasm-unsafe-eval'`. When the files come from another
origin than the page, such as a CDN, pdf.js starts its worker from a
`blob:` URL, which `worker-src` must then allow.

## Sources

A source is a URL, `{ url }`, or `{ data }`, where `data` is a `Uint8Array`
or an `ArrayBuffer`. A URL source may add `httpHeaders` and `withCredentials`
for its request, and either kind the `password` of an encrypted document;
its own headers and credentials replace those of `documentOptions`.
`PdfDocument`s of the same URL (with the same headers and credentials), or
of the same bytes, share one open document, and React's StrictMode or a
quick remount reuses it instead of opening it again. A document is closed a
second after the last `PdfDocument` holding it unmounts or opens another
source; one still loading or waiting for a password stops loading. A new
source object with the same URL keeps the open document, so
`source={{ url }}` inline is fine. ParaPDF copies `data` before pdf.js
transfers it to its worker, so your bytes stay usable.

## pdf.js's own API

`useSession().proxy` is pdf.js's `PDFDocumentProxy` of the open document,
null until it is ready, for what ParaPDF does not wrap:

```tsx
import { useDocumentState, useSession } from "parapdf";
import { useEffect, useState } from "react";

function MarkInfo() {
  const session = useSession();
  const ready = useDocumentState((state) => state.status === "ready");
  const [tagged, setTagged] = useState<boolean | null>(null);
  useEffect(() => {
    if (ready) void session.proxy?.getMarkInfo().then((info) => setTagged(info?.Marked ?? false));
  }, [session, ready]);
  return tagged === null ? null : <p>{tagged ? "Tagged PDF" : "Untagged PDF"}</p>;
}
```

Features of your own extend a viewer through `viewer.extend()`, the same
hooks ParaPDF's features use (`ViewerExtension`): the document being laid
out or ready, a page's text layer built or removed, a link about to jump,
and the rest. It returns the function that removes them.

## Server rendering

ParaPDF's React modules declare `"use client"`, and its components render on
the server as an empty viewport, with a preload of the PDF in the page's
head. pdf.js loads only in the browser, so components that render
`PdfDocument` need no `next/dynamic` or other browser-only wrapper.

The preload matches the CORS mode pdf.js fetches with, including a source's
`withCredentials`, so pdf.js takes the response. There is no preload when the
request has `httpHeaders`, which no preload can carry, whether the source or
`configurePdfjs({ documentOptions })` sets them, or with `disableStream`.

## Accessibility

The viewport is a focusable, labelled `role="document"`, each page a
labelled region, and the canvases are hidden from assistive technology,
which reads the text layer instead. A tagged PDF's structure gives that
text its headings, paragraphs, lists, tables, and figures' alternative text,
as in pdf.js's viewer. Text layers carry the PDF's language (`/Lang`), or the
page's when the PDF declares none. Label the document and its pages in your
application's language with `label` and `pageLabel`, and the thumbnails
with `PdfThumbnails`'s.

## Limitations

- Released pdfjs-dist draws pages on the main thread. Drawing in a worker
  needs pdf.js's renderer worker (`configurePdfjs({ rendererSrc })`), which
  is only in unreleased pdf.js builds so far.
- Not yet supported: editing annotations the PDF already holds, form
  scripts (calculations, validation, and button actions), XFA forms, and
  right-to-left page order (`/ViewerPreferences /Direction`). Annotations
  the reader creates can be moved, restyled, and deleted; those in the file
  stay as they are drawn.
- The current page is reported, never controlled: `onPageChange` reports it
  and `viewer.goToPage()` sets it.
- Comments on created annotations and pdf.js's alt text dialog are not
  shown; images take their alternative text from `addImage()`.
- A viewer shows the annotations it created, not those other viewers of the
  document create, though saving and printing include them all.
- Chromium and Firefox give pdf.js the PDF's preloaded download. Whether
  Safari does is not verified yet; where a browser does not, the PDF
  downloads twice.
- Text layers exist only for mounted pages, so the browser's own find and
  selection see only those; use `useSearch()` and `getText()`.
- Search highlights need the CSS Custom Highlight API; browsers without it
  find and scroll to matches without painting them.
- In Safari on iPadOS, a pinch that starts while a fling still scrolls does
  not reach the page; the next pinch zooms.
- The functional checks run in Playwright's builds of Chromium, WebKit, and
  Firefox; 0.4 was also tried by hand in Safari in the iPadOS simulator.
  Safari on macOS and real iOS and iPadOS devices are not verified yet.
- No screen reader has been tried. The checks inspect what the page exposes
  (text language, accessible names, the tagged structure), not what
  VoiceOver, NVDA, or another reader announces.
- Whether iOS Safari counts the canvases pages keep when they unmount
  (`maxKeptPixels`) toward its canvas memory cap is not verified; it needs a
  device.

## License

[MIT](https://github.com/yhay81/parapdf/blob/main/LICENSE). Parts of
ParaPDF are derived from pdf.js, licensed under the Apache License 2.0: see
[NOTICE.md](https://github.com/yhay81/parapdf/blob/main/NOTICE.md).
