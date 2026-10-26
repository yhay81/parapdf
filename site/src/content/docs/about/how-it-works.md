---
title: How it works
description: What ParaPDF does to keep scrolling and zooming fast, and what it costs.
---

ParaPDF uses pdf.js alone and directly: its types, its caches, its drawing,
and its layers, through its core display API (`getDocument`, page
rendering, `TextLayer`, `AnnotationLayer`, and the annotation editor), with
no engine boundary between them and the rest. It does not use the viewer
components in `pdfjs-dist/web/`, and it neither forks nor patches pdf.js.
pdf.js won the [engine benchmark](/about/performance/#the-engine) on size
and vector drawing; the rest is ParaPDF's own runtime, designed
around React.

## Layers of the runtime

Dependencies point down only:

- **pdf.js**: loading pdf.js, its worker, and its files, and what is
  specific to how ParaPDF drives it: drawing a page or a region into a
  canvas, the text layer, links, the structure tree, forms, and the
  annotation editor.
- **Documents**: a session per open document, shared by its viewers.
- **Views**: a `Viewer` per viewport, with its layout, scrolling, zoom,
  gestures, keyboard, mounted window, current page, and navigation.
- **Rendering**: a pure planner that decides what each page draws, and a
  renderer that carries the plans out and owns the pages' DOM.
- **Features**: search, history, forms, annotation editing, printing,
  thumbnails, and the rest, each attaching to a viewer or a session. The
  core imports none of them.
- **React**: `PdfDocument`, `PdfViewer`, `PdfThumbnails`, and the hooks.
  React is used only here.

## Documents are sessions

A `PdfDocument` opens a session of its source, or joins the one another
`PdfDocument` opened of it. The session holds pdf.js's document and its
pages, and reads once, for every viewer, what they all need: the pages'
sizes (the first page's for all at once, then the real ones in the
background), their text for search, the permissions, the outline, page
labels, metadata, attachments, layers, and the document's initial view.

Sessions are kept in a registry by source and closed a second after the
last `PdfDocument` lets go, so React's StrictMode and quick remounts open a
document once. Each session owns an `AbortController`: drawing, text,
searches, background reads, and the editor all take its signal, and closing
the session aborts everything at once.

The session publishes the document's state (status, progress, password
request, page count, permissions) in a store of its own from the moment it
starts to open, and every viewer reads that one store.

## Viewers are viewports

A `Viewer` is one viewport onto a session, with its own scroll position,
zoom, rotation, spreads, scroll mode, tool, mounted pages, and canvas
budgets. Several viewers show one session at once: a split view, or
thumbnails beside the pages. A viewer has an `AbortController` of its own:
when its viewport goes, its drawing, searches, and printing stop, while
other viewers of the document carry on. It keeps its position and its
annotations, and returns to them when a viewport shows it again.

Layouts are immutable per zoom level, held in typed arrays. A zoom sizes
the content element imperatively and restores the anchored scroll position
before React renders the mounted pages again. A pinch previews with a CSS
transform where its commit will put the content, and the pages it brings
into view mount and draw before the fingers lift.

## React stays out of the hot path

Each viewer publishes its view state in two parts: the hot part, which
changes while the reader scrolls or zooms (layout, mounted window, current
page, scale, zoom mode), apart from the cold part (rotation, spread, scroll
mode, tool). While the reader scrolls or pinches, the viewer computes every
frame but publishes only changes, and `PdfViewer` selects only the mounted
window and the layout: a scroll across several pages commits React a few
times, not once a frame. `PdfViewer`'s change callbacks are called from the
viewer's own store subscription, so they cost React nothing unless the
application sets state in them.

Pixels never go through React. React renders each mounted page's host, a
`<section>`, and the application's overlay, through a portal into a layer
of that host; everything else in it is the renderer's.

## Rendering: a planner and a renderer

The planner is a pure function from the layout, the viewport, the
devicePixelRatio, whether scrolling has settled, the budgets, and what each
page shows and draws now, to the layers each page should draw, in order.
It runs in Node, where unit tests check its invariants over generated
views: a visible page never stays blank, the budgets hold except for
visible bases, and no base is drawn under a whole-page detail.

Each mounted page stacks two canvases:

- a **base** at half a device pixel per CSS pixel, at most 2 MP
  (`maxBasePixels`), drawn first so scrolling never shows a blank page;
- a **detail** at full device resolution, drawn once scrolling settles. A
  page whose full-resolution drawing fits in 16 MP (`maxDetailPixels`) gets
  detail for all of it; larger pages get it only around the visible area,
  redrawn as the view moves away, as pdf.js's viewer does.

Visible pages draw first. Pages that slow scrolling brings into the mounted
window draw their detail before they scroll in, and get a base only once
they need one in view. After a zoom, a page draws its new detail into a
spare canvas while the old one, scaled, still shows, so it never shows
white or only its base.

The renderer compares the plan with what pages show and draw, and starts,
cancels, and releases drawings. It builds each page's canvases and the
containers of its text, structure, annotation, and editor layers at the
start of the host React places.

## Pages you come back to show at once

A page that leaves the mounted window keeps its canvases, up to
`maxKeptPixels`, six viewports' worth of device pixels by default. When it
mounts again, by a link's back, by scrolling back, or by flipping back, the
same canvas elements move into its new host: no pixel is copied and
nothing is drawn. Over the budget, the least recently kept go first.

Nothing is kept of a page whose form fields are shown as HTML, since pdf.js
draws some fields into canvases of their own, and nothing while the viewer
has no viewport.

## Memory

`maxCanvasPixels` bounds all of a viewer's canvases together, visible pages
and kept canvases included. Kept canvases go first, then pages outside the
viewport, farthest first and detail before base; past the budget, visible
pages lose their sharp margin and then resolution, in quarter-octave steps
that small changes do not cross, but keep their bases, so a visible page
never goes blank. The budget is one an application can rely on in browsers
that cap all canvases together, as iOS Safari does.

## Text, links, and the rest

Text layers, built with pdf.js's `TextLayer`, make pages selectable and
readable by screen readers, in the structure a tagged PDF gives them. The
renderer builds DOM layers one at a time, after scrolling settles, in idle
time, never while a visible page still waits for its first pixels: text,
then the annotations being edited, then links and forms. Text layers keep
the zoom they were laid out at and follow later zooms with CSS; a visible
page's text is laid out again, one page per idle period, only once the zoom
goes in past twice the one it was laid out at.

Search indexes each page with the normalization of pdf.js's find controller,
once per session for every viewer, and paints matches with the CSS Custom
Highlight API, without touching the text layer.

## Features load when used

A feature attaches to a viewer, a session, or both, and detaching it undoes
what it added; the viewer reaches it only through the hooks a feature
registers with `viewer.extend()`. Forms and annotation editing, which change
how pages are drawn, are options of `PdfViewer`, which imports their code
when one is set. Search, print, and the other features are included by
importing their hooks or functions, and absent from builds that import
neither.

## Off the main thread

pdf.js parses documents in its worker, which ParaPDF starts while React
renders, beside pdf.js's module. Released pdf.js still draws pages on the
main thread, into GPU-backed canvases by default (`enableHWA`). pdf.js's
renderer worker, which draws pages on a thread of its own, is in unreleased
builds only; `configurePdfjs({ rendererSrc })` uses it where it exists, and
it replaces drawing on the main thread once a released pdfjs-dist has it and
it measures better.

## pdf.js in the package

`parapdf` depends on one exact pdfjs-dist and ships its worker and the files
it loads on demand, each referenced with `new URL(…, import.meta.url)` so
bundlers emit them. The first `PdfDocument` starts the worker at once and
preloads its PDF with React's `preload()`, which pdf.js then takes.

Some parts are ported from pdf.js's viewer, under the Apache License 2.0:
[NOTICE.md](https://github.com/yhay81/parapdf/blob/main/NOTICE.md) lists
them.
