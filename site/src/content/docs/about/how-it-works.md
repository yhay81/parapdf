---
title: How it works
description: What ParaPDF does to keep scrolling and zooming fast, and what it costs.
---

ParaPDF draws pages with pdf.js's core display API (`getDocument`, page
rendering, `TextLayer`, and `AnnotationLayer`), not with the viewer
components in `pdfjs-dist/web/`, and it neither forks nor patches pdf.js. The
rest is its own runtime, designed around React.

## React stays out of the hot path

The viewer runtime owns scrolling, layout, zoom, and the render scheduler. It
publishes its state through a small store that `usePdfState` reads with
`useSyncExternalStore`, and while the reader scrolls or pinches it computes
every frame but publishes only changes: the mounted pages, the current page,
the zoom. Pixels reach canvases through refs, never through state, so a
scroll across several pages commits React a few times, not once a frame.

Layouts are immutable per zoom level. A zoom sizes the content element
imperatively and restores the anchored scroll position before React renders
the mounted pages again. A pinch previews with a CSS transform where its
commit will put the content, and the pages it brings into view mount and draw
before the fingers lift.

## Only what is near the viewport exists

Only the pages in view and a few beyond each edge (`overscan`) are mounted.
Pages that unmount zero their canvases and release pdf.js's page data.

Each mounted page stacks two canvases:

- a **base** at half a device pixel per CSS pixel, at most 2 MP, drawn first
  so scrolling never shows a blank page;
- a **detail** at full device resolution, drawn once scrolling settles. A page
  whose full-resolution drawing fits in 16 MP gets detail for all of it;
  larger pages get it only around the visible area, redrawn as the view
  moves away, as pdf.js's viewer does.

The scheduler draws visible bases first, then visible detail once scrolling
settles, then the pages just outside the viewport. Fast scrolling defers
full-resolution work. After a zoom, a page keeps showing its old detail,
scaled, until the new one is complete, so it never shows white or only its
base.

## Memory

`maxCanvasPixels` bounds all of a viewer's canvases together, visible pages
included. Pages outside the viewport give their pixels back first, farthest
first; past the budget, visible pages lose their sharp margin and then
resolution, in steps that small changes do not cross, but keep their bases,
so a visible page never goes blank. The budget is one an application can
rely on in browsers that cap all canvases together, as iOS Safari does.

## Text, links, and the rest

Text layers, built with pdf.js's `TextLayer`, make pages selectable and
readable by screen readers. The scheduler builds one at a time, once
scrolling settles, during idle periods, and not while a visible page still
waits for its first pixels; later zooms scale it with CSS instead of laying
it out again. Annotation layers (links, comments, form fields) follow in the
same pipeline.

Search indexes each page with the normalization of pdf.js's find controller
and paints matches with the CSS Custom Highlight API, without touching the
text layer.

## pdf.js in the package

`parapdf` depends on one exact pdfjs-dist and ships its worker and the files
it loads on demand, each referenced with `new URL(…, import.meta.url)` so
bundlers emit them. The first `PdfDocument` starts the worker at once, beside
pdf.js's module, and preloads its PDF with React's `preload()`, which pdf.js
then takes.

Some parts are ported from pdf.js's viewer, under the Apache License 2.0:
[NOTICE.md](https://github.com/yhay81/parapdf/blob/main/NOTICE.md) lists
them.
