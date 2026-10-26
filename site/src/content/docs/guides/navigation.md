---
title: Links, outline, and navigation
description: Follow the document's links and outline, and go back and forward.
---

Links inside the document and its outline jump through the viewer, and its
history remembers where each jump started:

```tsx
import { type OutlineNode, useHistory, useOutline, type Viewer } from "parapdf";

function Outline({ viewer }: { viewer: Viewer }) {
  const outline = useOutline();
  const list = (items: readonly OutlineNode[]) => (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          <button type="button" onClick={() => viewer.goToDestination(item.dest)}>
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

// useOutline() suspends until the outline is read: keep it apart from the viewer.
<Suspense fallback={null}>
  <Outline viewer={viewer} />
</Suspense>;
```

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

`"fit-width"` and `"fit-page"` keep fitting as the viewport resizes. With
`destinationZoom={false}`, the viewer keeps the zoom and only scrolls.

`viewer.goToDestination(dest)` takes a named destination or an explicit
one, as the outline's `dest` holds them, and resolves to whether it found
it; an entry without one (`dest` null) resolves to false.

## Back and forward

`useHistory(viewer)` gives the viewer's history, which keeps the jumps from
its first use on: mount it with the viewer, not only when a button shows.
`back()` returns to the position and zoom before the last link or outline
jump, and `forward()` to where `back()` left; a new jump forgets the
positions `forward()` had. `canGoBack` and `canGoForward` say whether there
is one, and the `GoBack` and `GoForward` actions of a PDF's links call them.
The history keeps 50 positions. Outside React, `historyOf(viewer)` gives the
same history.

Named actions in the document's links work too: `NextPage`, `PrevPage`,
`FirstPage`, and `LastPage`.

## Links to other documents

Links to other documents open in a new tab, with
`rel="noopener noreferrer nofollow"`. `externalLinks="disabled"` on
`PdfViewer` leaves them inert: neither focusable nor followable, while links within the
document keep working.
