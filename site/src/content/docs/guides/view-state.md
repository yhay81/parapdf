---
title: Keeping the view
description: Store where the reader is, open there again, and follow how the document asks to be shown.
---

## View states

`viewer.getViewState()` returns where and how the viewer shows its document,
as a plain object to store or put in a URL:

| Field | |
|---|---|
| `page` | The page at the viewport's top-left corner. |
| `x`, `y` | The point of that page there, in PDF points from its top-left corner. |
| `scale` | A number, `"fit-width"`, or `"fit-page"`. |
| `rotation`, `spread`, `scrollMode` | How the pages are turned and arranged. |

The point keeps its place on the page whatever the zoom or the viewport's
size, so the view moves between a phone and a desktop.

`viewer.setViewState(view)` shows such a view again, and the
`initialViewState` option opens the document with it, before anything is
drawn elsewhere. It wins over `initialPage`, `initialScale`, `spread`,
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
`documentView` reports them, each null when the document asks nothing:

| Field | Values |
|---|---|
| `destination` | Where the document opens. |
| `pageLayout` | `"SinglePage"`, `"OneColumn"`, `"TwoColumnLeft"`, `"TwoColumnRight"`, `"TwoPageLeft"`, or `"TwoPageRight"`. |
| `pageMode` | `"UseNone"`, `"UseOutlines"`, `"UseThumbs"`, `"FullScreen"`, `"UseOC"`, or `"UseAttachments"`. |

With `initialView: "document"`, the viewer opens at the destination, with
its zoom, and arranges the pages as pdf.js's viewer does: two columns are
`"odd"` or `"even"` spreads, and the `TwoPage` and `SinglePage` layouts show
one row at a time (`"page"` mode). Options you set win: `initialPage` over
the destination, `initialScale` over its zoom, and `spread` and `scrollMode`
over the layout.

The panel is the application's to open:

```tsx
const pageMode = usePdfState((state) => state.documentView?.pageMode ?? null);
useEffect(() => {
  if (pageMode === "UseOutlines") setPanel("outline");
  if (pageMode === "UseThumbs") setPanel("thumbnails");
}, [pageMode]);
```
