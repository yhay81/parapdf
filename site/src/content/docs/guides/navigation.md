---
title: Links, outline, and navigation
description: Follow the document's links and outline, and go back and forward.
---

Links inside the document and its outline jump through the viewer, and its
history remembers where each jump started:

```tsx
import { PdfOutline, useHistory } from "parapdf";
import { Suspense } from "react";

function BackForward() {
  const history = useHistory();
  return (
    <>
      <button type="button" disabled={!history.canGoBack} onClick={history.back}>Back</button>
      <button type="button" disabled={!history.canGoForward} onClick={history.forward}>Forward</button>
    </>
  );
}

// PdfOutline reads useOutline(), which suspends until read: keep it apart from the viewer.
<Suspense fallback={null}>
  <PdfOutline />
</Suspense>;
```

`PdfOutline` renders `<nav><ol>…</ol></nav>` with nested bookmark entries,
applies the PDF's `bold` and `italic` flags, jumps internal destinations through
`viewer.goToDestination(item.dest)`, follows `viewer.externalLinks` (`"new-tab"`
with `rel="noopener noreferrer nofollow"`, or inert `aria-disabled="true"` when
`"disabled"`), and returns `null` when the document has no outline. Pass
`defaultExpanded={false}` to start nested sections collapsed, `renderItem`
(`(item, helpers: OutlineItemHelpers) => ReactNode`) to add custom disclosure
toggles around `helpers.link` and `helpers.children`, or call `useOutline()`
directly to build a tree of your own.

[The demo](/demo/?file=usrguide.pdf) shows the outline of the LaTeX guide in
its sidebar, and the guide's links jump within it.

## Destinations

A destination shows its point at the viewport's top-left corner, with the
zoom it asks for, as in pdf.js:

| Destination | Zoom |
|---|---|
| `XYZ` | Its zoom factor, 1 being the printed size; none keeps the zoom. |
| `Fit` | The whole page, as `"fit-page"`. |
| `FitH` | The page's width, as `"fit-width"`. |
| `FitV` | The page's height. |
| `FitR` | Its rectangle, filling the viewport. |

`"fit-width"`, `"fit-page"`, and `"auto"` keep fitting as the viewport resizes. With
`destinationZoom={false}`, the viewer keeps the zoom and only scrolls.

`viewer.goToDestination(dest)` takes a named destination or an explicit
one, as the outline's `dest` holds them, and resolves to whether it found
it; an entry without one (`dest` null) resolves to false.

## Back and forward

`useHistory(viewer?)` gives the viewer's history, which keeps the jumps from
its first use on: mount it with the viewer, not only when a button shows.
`back()` returns to the position and zoom before the last link or outline
jump, and `forward()` to where `back()` left; a new jump forgets the
positions `forward()` had. `canGoBack` and `canGoForward` say whether there
is one, and the `GoBack` and `GoForward` actions of a PDF's links call them.
The history keeps 50 positions, tracks read fields when called without a
selector, and keeps `back` and `forward` referentially stable.

Named actions in the document's links work too: `NextPage`, `PrevPage`,
`FirstPage`, and `LastPage`.

## Links to other documents

Links to other documents open in a new tab, with
`rel="noopener noreferrer nofollow"`. `externalLinks="disabled"` on
`PdfViewer` leaves them inert: neither focusable nor followable, while links within the
document keep working.

## Addresses in the text

Documents made from text often show URLs and e-mail addresses that the
file does not link. `<PdfAutoLinks />` inside `<PdfViewer>` turns them into
links, as pdf.js's viewer does: once a page's text and annotation layers are
built, the `https://`, `www.`, and e-mail addresses in its text become links
of its annotation layer, except where a link of the file already covers them.

```tsx
<PdfViewer>
  <PdfAutoLinks />
</PdfViewer>
```

They need `textLayer` and `annotationLayer`, which are on by default, and
follow `externalLinks`. Its code is in your bundle only when you import
`PdfAutoLinks`.
