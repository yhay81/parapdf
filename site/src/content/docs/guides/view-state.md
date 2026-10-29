---
title: Keeping the view
description: Store where the reader is, open there again, and follow how the document asks to be shown.
---

## View states

`getViewState(viewer)` returns where and how the viewer shows its document,
as a plain object to store or put in a URL, or null until the document is
ready:

| Field | |
|---|---|
| `page` | The page at the viewport's top-left corner, zero-based. |
| `x`, `y` | The point of that page there, in PDF points from its top-left corner. |
| `scale` | A number, `"fit-width"`, `"fit-page"`, or `"auto"`. |
| `rotation`, `spread`, `scrollMode` | How the pages are turned and arranged. |

The point keeps its place on the page whatever the zoom or the viewport's
size, so the view moves between a phone and a desktop.

`setViewState(viewer, view)` shows such a view again, and `PdfViewer`'s
`initialViewState` opens the document with it, before anything is drawn
elsewhere. It wins over `defaultPage`, the zoom, the spread, the scroll
mode, and `initialView`, and the fields it leaves out still follow them.
Neither adds a back entry, and values out of range are clamped or ignored,
so a view read from a URL needs no checking:

```tsx
import { getViewState, PdfDocument, PdfViewer, useViewer } from "parapdf";
import { useEffect, useState } from "react";

function Reader({ url }: { url: string }) {
  const viewer = useViewer();
  // Read once: the opening view applies only as the document opens.
  const [saved] = useState(() => localStorage.getItem(`view:${url}`));
  useEffect(() => {
    const save = () => {
      const view = getViewState(viewer);
      if (view) localStorage.setItem(`view:${url}`, JSON.stringify(view));
    };
    // As the reader moves through the document, and when the page is left.
    const unsubscribe = viewer.store.subscribe(save);
    window.addEventListener("pagehide", save);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", save);
    };
  }, [viewer, url]);
  return (
    <PdfDocument source={url}>
      <PdfViewer viewer={viewer} initialViewState={saved ? JSON.parse(saved) : undefined} />
    </PdfDocument>
  );
}
```

The viewer's store publishes as the current page and the zoom change, not
at every scrolled frame, so saving there costs little. A viewer whose
`PdfViewer` unmounts and mounts again returns to where it was on its own.

## The document's initial view

A PDF may ask where it opens (`/OpenAction`), how its pages are arranged
(`/PageLayout`), and which panel shows beside them (`/PageMode`).
`useInitialView()` reads them, null when they cannot be read, and each field
is null when the document asks nothing. It suspends until they are read, so
render it under a Suspense boundary of your own:

| Field | Values |
|---|---|
| `destination` | Where the document opens. |
| `pageLayout` | `"SinglePage"`, `"OneColumn"`, `"TwoColumnLeft"`, `"TwoColumnRight"`, `"TwoPageLeft"`, or `"TwoPageRight"`. |
| `pageMode` | `"UseNone"`, `"UseOutlines"`, `"UseThumbs"`, `"FullScreen"`, `"UseOC"`, or `"UseAttachments"`. |

With `initialView="document"`, the viewer opens at the destination, with
its zoom, and arranges the pages as pdf.js's viewer does: two columns are
`"odd"` or `"even"` spreads, and the `TwoPage` and `SinglePage` layouts show
one row at a time (`"page"` mode). What you set wins, controlled or by
default: `defaultPage` over the destination, the zoom over its zoom, and
the spread and the scroll mode over the layout.

The panel is the application's to open:

```tsx
function OpenPanel({ setPanel }: { setPanel: (panel: string) => void }) {
  const pageMode = useInitialView()?.pageMode ?? null;
  useEffect(() => {
    if (pageMode === "UseOutlines") setPanel("outline");
    if (pageMode === "UseThumbs") setPanel("thumbnails");
  }, [pageMode, setPanel]);
  return null;
}
```
