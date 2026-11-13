---
title: Keeping the view
description: Store where the reader is, open there again, and follow how the document asks to be shown.
---

## View states

`viewer.viewState()` returns where and how the viewer shows its document,
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

`viewer.setViewState(view)` shows such a view again, `PdfViewer`'s
`initialViewState` opens the document with it before anything is drawn
elsewhere, and `PdfViewer`'s `onViewStateChange` hears settled `ViewState`
snapshots as the reader moves through the document. `initialViewState` wins
over `defaultPage`, the zoom, the spread, the scroll mode, and `initialView`,
and the fields it leaves out still follow them.
For example, `defaultPage={2}` with `initialViewState={{ scale: 1.5 }}`
opens the third page at that scale.
Neither adds a back entry, and values out of range are clamped or ignored,
so a view read from a URL needs no checking:

```tsx
import { PdfDocument, PdfViewer } from "parapdf";
import { useState } from "react";

function Reader({ url }: { url: string }) {
  // Read once: the opening view applies only as the document opens.
  const [saved] = useState(() => localStorage.getItem(`view:${url}`));
  return (
    <PdfDocument source={url}>
      <PdfViewer
        initialViewState={saved ? JSON.parse(saved) : undefined}
        onViewStateChange={(view) => {
          localStorage.setItem(`view:${url}`, JSON.stringify(view));
        }}
      />
    </PdfDocument>
  );
}
```

`onViewStateChange` stays silent when the document opens, coalesces scrolls
until they settle (including intra-page scrolls) rather than firing per frame,
and flushes any unsettled scroll on `pagehide` and when `PdfViewer` unmounts.
A viewer whose `PdfViewer` unmounts and mounts again returns to where it was on
its own.

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
