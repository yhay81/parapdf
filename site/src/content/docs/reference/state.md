---
title: State
description: The fields of ViewerState, which usePdfState reads.
---

`usePdfState(selector)` reads the viewer's state (`ViewerState`) and
re-renders its component only when the selected value changes. Outside React,
`viewer.store.subscribe(listener)` hears each change and `viewer.store.get()`
returns the state.

```tsx
const page = usePdfState((state) => state.currentPage);
```

The store publishes when the document loads, the mounted pages or the
current page change, or the view does; scrolling and zoom gestures change
nothing in it per frame.

| Field | Meaning |
|---|---|
| `status`, `error` | `"idle"`, `"loading"`, `"password"` (see [Encrypted documents](/guides/encrypted/)), `"ready"`, or `"error"`, and the error's message. |
| `passwordReason` | `"required"` or `"incorrect"` while the document waits for a password, otherwise null. |
| `progress` | `{ loaded, total }` bytes of the document received, `total` null when the server did not say; null before any arrive. |
| `pageCount`, `currentPage` | Pages in the document, and the zero-based page being read: the one nearest the viewport's center, except that the current page stays current while all of it is in view, and that navigation makes the page it shows current. |
| `pageLabels` | Each page's label, such as `"iv"` or `"A-3"`, when the PDF defines them; otherwise null. |
| `scale`, `zoomMode` | CSS pixels per PDF point; `"fit-width"` or `"fit-page"` while the page is fitted as the viewport resizes, otherwise `"custom"`. |
| `rotation`, `spread`, `scrollMode` | The view's clockwise rotation (0, 90, 180, or 270); `"none"`, `"odd"`, or `"even"`; and `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"` (see [Scroll modes](/guides/layout/)). |
| `tool` | What a mouse drag does: `"select"` text, or scroll the document with the `"hand"`. |
| `search` | The search in progress or done (see [Search](/guides/search/)). |
| `outline`, `canGoBack`, `canGoForward` | The document outline (null while it loads), and whether `back()` and `forward()` have a position to return to. |
| `permissions` | What the document permits (see [Permissions](/guides/permissions/)); null while it loads. |
| `documentView` | How the document asks to be shown (see [The document's initial view](/guides/view-state/#the-documents-initial-view)); null while it loads. |
| `metadata` | Title, author, subject, keywords, creator, producer, creation and modification dates, PDF version, and language; null while it loads. |
| `attachments`, `layers` | The document's embedded files and its layers (see [Layers and attachments](/guides/layers-attachments/)); null while they load. |
| `annotationTool`, `annotationState`, `annotationStyles` | The annotation tool, undo, redo, and selection, and each tool's style, with `annotationEditing` on (see [Annotations](/guides/annotations/)); the last two null while it is off. |
| `layout`, `first`, `last` | The page boxes at the current zoom, and the mounted pages. |
| `document` | The engine's open document; `usePdfDocument()` returns pdf.js's proxy of it. |
