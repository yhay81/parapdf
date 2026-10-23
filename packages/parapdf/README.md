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
  settles, and after a zoom keeps showing its old drawing, scaled, until the
  new one is complete; at high zoom only the visible part is drawn sharp,
  within pixel budgets you can set for memory-capped browsers such as iOS
  Safari.
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
- **pdf.js included.** ParaPDF ships pdf.js with its worker and the files it
  loads on demand, and your bundler serves them from your application's
  origin: there is nothing to set up.

## Install

```bash
npm install parapdf
```

ParaPDF needs React 19.2 or later. It depends on pdfjs-dist 6.4.299
exactly, because it ships that version's worker and files.

## Quick start

```tsx
import { PdfDocument, PdfViewport } from "parapdf";

export function App() {
  return (
    <PdfDocument source="/manual.pdf">
      <PdfViewport style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

- `PdfViewport` is the scroll container. Give it a definite height, as above
  or through a flex or grid layout: it contains its own layout and does not
  grow with the document.
- The first `PdfDocument` to render loads pdf.js and starts its worker, and
  each one starts downloading its PDF while it renders, from the page's
  head when the page is rendered on the server. pdf.js takes the preloaded
  response, so the PDF downloads once (see [Limitations](#limitations) for
  Safari).
- This works as it is with bundlers that emit files referenced with
  `new URL(…, import.meta.url)`: see [Bundlers](#bundlers).

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
| `outline`, `canGoBack`, `canGoForward` | The document outline (`null` while it loads), and whether `back()` and `forward()` have a position to return to. |
| `permissions` | What the document permits (see [Permissions](#permissions)); null while it loads. |
| `documentView` | How the document asks to be shown (see [The document's initial view](#the-documents-initial-view)); null while it loads. |
| `metadata` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language; null while it loads. |
| `attachments`, `layers` | The document's embedded files and its layers (see [Layers and attachments](#layers-and-attachments)); null while they load. |
| `annotationTool`, `annotationState`, `annotationStyles` | The annotation tool, undo, redo, and selection, and each tool's style, with `annotationEditing` on (see [Annotations](#annotations)); the last two null while it is off. |

`usePdfViewer()` returns the viewer runtime, whose methods change the view:
`goToPage(index)`, `nextPage()` and `previousPage()` (by a whole spread or
row), `zoomBy(factor)`, `setScale(scale | "fit-width" | "fit-page")`,
`resetScale()`, `rotate(degrees)`, `setRotation(rotation)`,
`setSpread(spread)`, `setScrollMode(mode)`, `setTool("select" | "hand")`,
`goToDestination(dest)`, `back()`, `forward()`, `getViewState()` and
`setViewState(view)` (see [Keeping the view](#keeping-the-view)), and the
methods of the sections below.
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

## Document text

`viewer.getText(options)` reads the document's text from every page,
mounted or not, as search reads it: the text runs in content order, "\n"
where a line ends, and an empty line between pages.

```ts
const { text, pages } = await viewer.getText();
// pages: [{ pageIndex: 0, text: "…", offset: 0 }, …], where offset is the page's start in text
```

- `from` and `to` narrow it to pages (`{ from: 2, to: 4 }` reads pages 3
  to 5) or to points in the text: a search match's ends,
  `{ pageIndex: match.pageIndex, ...match.start }` and `...match.end`, or a
  selection's, `getSelection().start` and `.end`. A point is included as a
  start and excluded as an end.
- `lineBreaks: "join"` joins lines as search does: without a space inside a
  word hyphenated across lines and in Japanese and Chinese text, with one
  elsewhere.
- `signal` stops a read, which then rejects with the signal's reason.

Pages are parsed in pdf.js's worker a few at a time, and the text is kept:
a second read, or a search, parses nothing again. The browser's selection
covers only mounted pages; to copy a range longer than those, read it with
`getText()` between the points where it starts and ends.

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

A destination shows its point at the viewport's top-left corner, with the
zoom it asks for, as in pdf.js: `XYZ` with a zoom factor (1 is the printed
size), `Fit` the whole page, `FitH` the page's width, `FitV` its height, and
`FitR` its rectangle filling the viewport; `fit-width` and `fit-page` keep
fitting as the viewport resizes. `destinationZoom: false` keeps the zoom and
only scrolls.

`navigation.back()` returns to the position and zoom before the last link
or outline jump, and `navigation.forward()` to where `back()` left; a new
jump forgets the positions `forward()` had. `navigation.canGoBack` and
`navigation.canGoForward` say whether there is one, and the `GoBack` and
`GoForward` actions of a PDF's links call them. Links to other documents
open in a new tab; `externalLinks: "disabled"` leaves them inert.

## Keeping the view

`viewer.getViewState()` returns where and how the viewer shows its
document, as a plain object to store or put in a URL: the `page` at the
viewport's top-left corner, the point of that page there (`x`, `y`, in PDF
points from its top-left corner), `scale` (a number, `"fit-width"`, or
`"fit-page"`), `rotation`, `spread`, and `scrollMode`. The point keeps its
place on the page whatever the zoom or the viewport's size, so the view
moves between a phone and a desktop.

`viewer.setViewState(view)` shows such a view again, and the
`initialViewState` option opens the document with it, before anything is
drawn elsewhere; it wins over `initialPage`, `initialScale`, `spread`,
`scrollMode`, and `initialView`, and the fields it leaves out still follow
them. Neither adds a back entry, and values out of range are clamped or
ignored, so a view read from a URL needs no checking:

```tsx
// Reopen where the reader left off.
const saved = localStorage.getItem(`view:${url}`);
<PdfDocument
  source={url}
  options={saved ? { initialViewState: JSON.parse(saved) } : {}}
>
  <SaveView url={url} />
  <PdfViewport />
</PdfDocument>;

function SaveView({ url }: { url: string }) {
  const viewer = usePdfViewer();
  useEffect(() => {
    const save = () => {
      const view = viewer.getViewState();
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
  return null;
}
```

The store publishes as the current page and the zoom change, not at every
scrolled frame, so saving there costs little.

## The document's initial view

A PDF may ask where it opens (`/OpenAction`), how its pages are arranged
(`/PageLayout`), and which panel shows beside them (`/PageMode`). The state's
`documentView` reports them: `destination`, `pageLayout` (`"SinglePage"`,
`"OneColumn"`, `"TwoColumnLeft"`, `"TwoColumnRight"`, `"TwoPageLeft"`, or
`"TwoPageRight"`), and `pageMode` (`"UseNone"`, `"UseOutlines"`,
`"UseThumbs"`, `"FullScreen"`, `"UseOC"`, or `"UseAttachments"`), each null
when the document asks nothing.

With `initialView: "document"`, the viewer opens at the destination, with
its zoom, and arranges the pages as pdf.js's viewer does: two columns are
`"odd"` or `"even"` spreads, and the `TwoPage` and `SinglePage` layouts show
one row at a time (`"page"` mode). Options you set win: `initialPage` over
the destination, `initialScale` over its zoom, and `spread` and `scrollMode`
over the layout. The panel is the application's to open:

```tsx
const pageMode = usePdfState((state) => state.documentView?.pageMode ?? null);
useEffect(() => {
  if (pageMode === "UseOutlines") setPanel("outline");
  if (pageMode === "UseThumbs") setPanel("thumbnails");
}, [pageMode]);
```

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
  browser's print dialog with only those pages. A new print request stops
  the previous job; that job resolves without opening another dialog.

Applications read and fill the form themselves:

```tsx
import { usePdfFormChange, usePdfViewer } from "parapdf";

function FormSync({ onChange }: { onChange: (name: string, value: unknown) => void }) {
  const viewer = usePdfViewer();
  // Each value the reader enters, as they type.
  usePdfFormChange(({ name, value }) => onChange(name, value));
  const fill = async () => {
    const fields = await viewer.getFormFields();
    console.log(fields.map(({ name, type, value }) => [name, type, value]));
    await viewer.setFormValues({ name: "Ada Lovelace", agree: true, size: "large" });
  };
  return <button type="button" onClick={fill}>Fill in</button>;
}
```

- `viewer.getFormFields()` resolves to every field (`FormField`): its
  qualified `name`, `type` (`"text"`, `"checkbox"`, `"radio"`,
  `"combobox"`, `"listbox"`, `"button"`, or `"signature"`), current `value`,
  `defaultValue`, `readOnly`, `required`, `multiple`, the `options` of a
  list, the `exportValues` that check its boxes, and its `widgets`, each a
  page and a rectangle in PDF points. A value is text, the export value of
  the checked box or radio button (`"Off"` for none), or the selected
  options' export values, an array for a list that takes several.
- `viewer.setFormValues(values)` sets fields by name, `true` and `false`
  checking the first box or none, and resolves to the names it set. The
  fields shown show the values, and `save()` and `print()` include them; it
  is not heard as the reader's input.
- `usePdfFormChange(listener)`, or `viewer.onFormChange(listener)`, which
  returns the function that stops it, hears `{ name, value }` for each value
  the reader enters, with `forms` on.

Form scripts (JavaScript actions) do not run.

## Permissions

An encrypted PDF may refuse printing, copying, changing, or annotating it.
The state's `permissions` reports what it permits: `print`,
`printHighQuality`, `modify`, `copy`, `copyForAccessibility`, `annotate`,
`fillForms`, and `assemble`, and `restricted`, true when any of them is
false. Documents that are not encrypted permit everything.

The viewer only reports them unless `enforcePermissions: true`, as in
pdf.js. Then, without `copy`, the text cannot be selected or copied, though
assistive technology still reads it; without `print`, `print()` fails;
without `annotate`, `annotationEditing` stays off; and form fields can be
filled in with `fillForms` or `annotate`. Permissions are advisory: a
document that opens can be read whole by any program that ignores them, so
they protect nothing an application must keep secret.

## Annotations

With `options={{ annotationEditing: true }}`, the reader can create
highlights, text, drawings, images, and signatures, with pdf.js's editors.
`viewer.setAnnotationTool(tool)` chooses what a pointer does on the pages:

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
function AnnotationTools() {
  const viewer = usePdfViewer();
  const tool = usePdfState((state) => state.annotationTool);
  const canUndo = usePdfState((state) => state.annotationState?.canUndo ?? false);
  const ink = usePdfState((state) => state.annotationStyles?.ink);
  return (
    <div role="toolbar" aria-label="Annotations">
      <button type="button" aria-pressed={tool === "ink"} onClick={() => viewer.setAnnotationTool("ink")}>
        Draw
      </button>
      <input
        type="color"
        aria-label="Line color"
        value={ink?.color.toLowerCase() ?? "#000000"}
        onChange={(event) => viewer.setAnnotationStyle("ink", { color: event.target.value })}
      />
      <button type="button" disabled={!canUndo} onClick={() => viewer.undoAnnotation()}>
        Undo
      </button>
    </div>
  );
}
```

- `setAnnotationStyle(tool, style)` restyles the selected annotations, or,
  with none selected, the next ones `tool` creates: `color` for each tool,
  `thickness` for `"ink"` and freehand highlights, `opacity` for `"ink"`,
  and `fontSize` for `"freetext"`, in PDF points. `annotationStyles` shows
  each tool's style, or the selected annotation's.
- `undoAnnotation()`, `redoAnnotation()`, `deleteSelectedAnnotations()`,
  and `selectAllAnnotations()`; `annotationState` says whether there is
  something to undo or redo (`canUndo`, `canRedo`), whether annotations are
  selected (`hasSelection`), and whether there are any (`isEmpty`).
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
`print()` use. To keep them apart from the PDF, say on a server,
`exportAnnotations()` returns them as JSON-compatible data, and
`importAnnotations(annotations)` adds them again where they were, after the
same document opens again, without an undo step:

```ts
localStorage.setItem("annotations", JSON.stringify(viewer.exportAnnotations()));
// Later, once the document is open (status "ready"):
await viewer.importAnnotations(JSON.parse(localStorage.getItem("annotations") ?? "[]"));
```

Each exported annotation has `pageIndex`, `type` (the tool that made it),
and `data`, pdf.js's own description of it: keep `data` as it is. It is the
form pdf.js pastes copies in, which may change when ParaPDF moves to
another pdf.js; the changelog says when. Text being
typed counts once it is committed, when the reader clicks elsewhere or
another tool is chosen. Annotations belong to the open document: they are
gone once the viewer closes it, so export or save them before.

The editor's code and styles load when a viewer with `annotationEditing`
opens a document, so applications that do not edit annotations do not
download them; `annotationState` is null until then. A viewer that edits
annotations opens its own copy of the document instead of sharing one with
other viewers of the same source. Thumbnails show pages without the
annotations created, as pdf.js's do. Label the editor's
controls in the application's language with `annotationLabels`; the
defaults are pdf.js's English names.

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
asks only when it is wrong. Changing `source.password` tries the new value
on the shared document still loading, even before its password request
arrives. This also works with `passwordPrompt: false`.

An application without such a prompt passes `passwordPrompt: false` in
`options`: an encrypted document then fails at once with `status`
`"error"`, as it did before 0.3.0, instead of waiting for a password no one
can type.

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
last page. On touch screens, a one-finger swipe to the left or up turns to
the next page, and to the right or down back, like turning paper; short or
slanted swipes, pinches, and swipes with an annotation tool chosen do not.
A zoomed page scrolls within itself, and the pages beside it are drawn
before they show: a swipe from its edge turns it. The current page stays in view when the mode
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
// { text: "…", pages: [{ pageIndex: 0, rects: [{ x, y, width, height }] }], start, end } or null
```

`start` and `end` are where the selection begins and ends in the document's
text, for [`getText()`](#document-text); null for an end outside the pages'
text.

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

`<PdfDocument options={…}>` takes `ViewerOptions`. They are read when the
component mounts; give it a new `key` to change them.

| Option | Default | |
|---|---|---|
| `initialScale` | `"fit-width"` | A scale in CSS pixels per point, `"fit-width"`, which keeps fitting the page width as the viewport resizes, or `"fit-page"`, which keeps fitting all of it. |
| `initialPage` | `0` | The zero-based page shown first. |
| `initialViewState` | none | A view kept from `getViewState()` to open with (see [Keeping the view](#keeping-the-view)). |
| `initialView` | `"options"` | `"document"` opens where and as the document asks (see [The document's initial view](#the-documents-initial-view)). |
| `destinationZoom` | `true` | `false` keeps the zoom when following links and the outline. |
| `enforcePermissions` | `false` | Follow what the document permits (see [Permissions](#permissions)). |
| `spread` | `"none"` | `"odd"` or `"even"` shows pages in pairs (see [Spreads](#scroll-modes-spreads-and-fitting)). |
| `scrollMode` | `"vertical"` | `"horizontal"`, `"wrapped"`, or `"page"` arranges pages otherwise (see [Scroll modes](#scroll-modes-spreads-and-fitting)). |
| `initialTool` | `"select"` | `"hand"` makes a mouse drag scroll the document from the start. |
| `minScale`, `maxScale` | `0.25`, `10` | Zoom limits in CSS pixels per point. |
| `gap` | `12` | CSS pixels between pages and around them. |
| `overscan` | `2` | Pages mounted beyond each edge of the viewport. |
| `textLayer` | `true` | Selectable, screen-reader-visible text. Search works without it but paints matches only on text layers. |
| `annotationLayer` | `true` | Focusable links, comment popups, and, with `forms`, form fields. |
| `forms` | `false` | Form fields the reader can fill in (see [Forms](#forms-printing-and-saving)). |
| `annotationEditing` | `false` | Highlights, text, drawings, images, and signatures the reader creates (see [Annotations](#annotations)). |
| `annotationLabels` | English | The accessible names of the annotation editor's controls, such as `{ removeInk: "線を削除" }`. |
| `externalLinks` | `"new-tab"` | `"disabled"` leaves links to other documents inert. |
| `openAttachment` | download | What opening an embedded file does: `({ filename, content }) => void`. |
| `pageColors` | none | `{ background, foreground }` to draw pages in two colors, for example `Canvas` and `CanvasText` in forced-colors mode. |
| `maxDetailPixels` | 16,777,216 | Pixels of one page's full-resolution canvas; larger pages are drawn sharp only around the visible area. |
| `maxDetailViewports` | unlimited | The same limit as a multiple of the viewport's device pixels, so the sharp margin around the visible area follows the viewport's size. |
| `maxBasePixels` | 2,097,152 | Pixels of one page's low-resolution canvas. |
| `maxCanvasPixels` | unlimited | Pixels of all of this viewer's canvases together. Pages outside the viewport give theirs back first; past the budget, visible pages lose their sharp margin and then resolution, but keep their low-resolution canvases. A page drawn sharp again, after a zoom for example, keeps its old sharp canvas until the new one is complete when both fit, and shows its low-resolution one meanwhile when they do not. |
| `maxConcurrentRenders` | `2` | Pages drawn at once. |

`PdfViewport` takes `className`, `style`, `label` (the accessible name of
the document, "PDF document" by default), `pageLabel` (the accessible name
of each page, `(pageNumber, pageCount) => string`, "Page 3 of 12" by
default), and `renderOverlay`.

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

That works as it is with Vite 8 (development server and build), webpack 5,
Rsbuild 2, and Next.js 16 (Turbopack and webpack), which were tested. Parcel
2 bundles the worker again into a script that does not start, and esbuild
and Bun copy none of the files. With those, copy
`node_modules/parapdf/pdfjs/` to where your application serves static files,
such as `public/pdfjs/`, and tell ParaPDF where it is:

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
for its request, and either kind the `password` of an encrypted document.
Viewers of the same URL (with the same headers and credentials), or of the
same bytes, share one loaded document, and React's StrictMode or a quick
remount reuses it instead of loading it again. A document is closed a
second after its last viewer unmounts; one still loading or waiting for a
password stops loading. A new source object with the same URL keeps the open
document, so `source={{ url }}` inline is fine. ParaPDF copies `data` before
pdf.js transfers it to its worker, so your bytes stay usable.

## pdf.js's own API

`usePdfDocument()` returns pdf.js's `PDFDocumentProxy` of the open document,
for what ParaPDF does not wrap, such as metadata or attachments:

```tsx
import { usePdfDocument } from "parapdf";
import { useEffect, useState } from "react";

function Title() {
  const proxy = usePdfDocument();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    void proxy?.getMetadata().then(({ info }) => setTitle((info as { Title?: string }).Title ?? null));
  }, [proxy]);
  return title ? <h1>{title}</h1> : null;
}
```

## Server rendering

ParaPDF's React modules declare `"use client"`, and its components render on
the server as an empty viewport, with a preload of the PDF in the page's
head. pdf.js loads only in the browser, so components that render
`PdfDocument` need no `next/dynamic` or other browser-only wrapper.

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
  needs pdf.js's renderer worker (`configurePdfjs({ rendererSrc })`), which
  is only in unreleased pdf.js builds so far.
- Not yet supported: editing annotations the PDF already holds, form
  scripts (calculations, validation, and button actions), and XFA forms. Annotations the reader creates can be moved,
  restyled, and deleted; those in the file stay as they are drawn.
- Comments on created annotations and pdf.js's alt text dialog are not
  shown; images take their alternative text from `addImage()`.
- Chromium and Firefox give pdf.js the PDF's preloaded download. Whether
  Safari does is not verified yet; where a browser does not, the PDF
  downloads twice.
- Text layers exist only for mounted pages, so the browser's own find and
  selection see only those; use `usePdfSearch` and `getText()`.
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
