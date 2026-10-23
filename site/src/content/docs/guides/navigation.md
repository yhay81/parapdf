---
title: Links, outline, and navigation
description: Follow the document's links and outline, and go back and forward.
---

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
the `destinationZoom: false` option, the viewer keeps the zoom and only
scrolls.

`navigation.goToDestination(dest)` takes a named destination or an explicit
one, as the outline's `dest` holds them, and resolves to whether it found
it.

## Back and forward

`navigation.back()` returns to the position and zoom before the last link or
outline jump, and `navigation.forward()` to where `back()` left; a new jump
forgets the positions `forward()` had. `navigation.canGoBack` and
`navigation.canGoForward` say whether there is one, and the `GoBack` and
`GoForward` actions of a PDF's links call them. The viewer keeps 50 positions.

Named actions in the document's links work too: `NextPage`, `PrevPage`,
`FirstPage`, and `LastPage`.

## Links to other documents

Links to other documents open in a new tab, with
`rel="noopener noreferrer nofollow"`. The `externalLinks: "disabled"` option
leaves them inert: neither focusable nor followable, while links within the
document keep working.
