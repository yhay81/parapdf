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
around React rather than an `<iframe>` ([Why React, not an iframe](/why-react/)).

## Layers of the runtime

- **pdf.js**: loading pdf.js, its worker, and its files, and what is
  specific to how ParaPDF drives it: drawing a page or a region into a
  canvas, the text layer, links, the structure tree, forms, and the
  annotation editor.
- **Documents**: a session per open document, shared by its viewers.
- **Views**: a `Viewer` per viewport, with its layout, scrolling, zoom,
  gestures, keyboard, mounted window, current page, and navigation.
- **Rendering**: a planner chooses drawings. The renderer manages canvases
  and PDF layers inside each page.
- **Features**: search, history, forms, annotation editing, printing,
  thumbnails, and the rest, each attaching to a viewer or a session. The
  core imports none of them.
- **React**: `PdfDocument`, `PdfView`, `PdfViewer`, `PdfThumbnails`,
  `PdfOutline`, and the hooks. React is used only here.

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

The lifetimes are React's. A render may never mount: a Suspense boundary
above it waits, or React abandons a transition. So a `PdfDocument` starts
its session as it renders, and what a render reads of the document is kept
in the registry, where the next render of the same source finds the same
promise; a session no `PdfDocument` came to hold closes ten seconds after
it loaded. And React destroys effects alike when it hides a tree
(`<Activity>`), runs them twice (StrictMode), and unmounts: everything
held, the document and what a viewer drew, is held by an effect and let go
by its cleanup, while the viewer, which the component's state keeps, keeps
the reader's place, search, and annotations to show again.

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
the content element and restores the anchored scroll position. A pinch
previews that position with a CSS transform. Pages brought into view
mount and draw before the fingers lift.

## React stays out of the hot path

React places the scroll container and an empty element for the pages.
As the reader scrolls, the viewer adds or removes a `<section>` for each
page entering or leaving the mounted window. The renderer can start drawing
in a new section in the same frame. React places application overlays inside
those sections through portals.

Each viewer tells subscribers which fields changed. A page
counter can subscribe to the current page and update once when the reader
crosses a page boundary. A `PdfPageOverlay` on a single page follows that
page's host as it mounts and unmounts.

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
start of that page's section.

## Pages you come back to show at once

A page that leaves the mounted window keeps its canvases, up to
`maxKeptPixels`, twelve viewports' worth of device pixels by default. When it
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
expose their text to assistive technology, in the structure a tagged PDF
gives them. The
renderer builds DOM layers one at a time, after scrolling settles, in idle
time, never while a visible page still waits for its first pixels: text,
then links and forms, then the annotations being edited. Text layers keep
the zoom they were laid out at and follow later zooms with CSS; a visible
page's text is laid out again, one page per idle period, only once the zoom
goes in past twice the one it was laid out at.

Search indexes each page with the normalization of pdf.js's find controller,
once per session for every viewer, and paints matches with the CSS Custom
Highlight API, without touching the text layer.

## Features load when used

A feature attaches to a viewer, a session, or both, and detaching it undoes
what it added; the viewer's controller reaches it only through internal
extension hooks, and the core imports none of them. Forms, annotation editing,
addresses linked in the text, and permission enforcement are declarative
components (`PdfForms`, `PdfAnnotationEditor`, `PdfAutoLinks`,
`PdfPermissions`), while search, print, saving, and the other features are
hooks or standalone functions — absent from builds that import none of them.

## Off the main thread

pdf.js parses documents in its worker, which ParaPDF starts while React
renders, beside pdf.js's module. By default pdf.js draws pages into GPU-backed canvases on the main
thread. With `configurePdfjs({ rendererSrc: true })`, the package also
loads pdf.js's drawing worker. It reduces stalls on some text-heavy PDFs.
Scanned pages can take longer to present in Chromium and WebKit.

## pdf.js in the package

`parapdf` depends on one exact pdfjs-dist and ships its worker and the files
it loads on demand, each referenced with `new URL(…, import.meta.url)` so
bundlers emit them. The first `PdfDocument` starts the worker at once and
preloads its PDF with React's `preload()`, which pdf.js then takes, except
in WebKit browsers, where pdf.js cannot take a preload still downloading.

ParaPDF is licensed under Apache-2.0. Some parts are ported from pdf.js's viewer:
[NOTICE.md](https://github.com/yhay81/parapdf/blob/main/NOTICE.md) lists
them.
