---
title: State
description: The view state a viewer publishes, the document state its session publishes, and the PdfSession.
---

State lives in three places, each published in a store of its own: each
viewer's view state, the document's state, which every viewer of it shares,
and each feature's own (search, history, annotation editing). React reads
them through `useSyncExternalStore` selectors and renders a component again
only when its selected value changes.

```tsx
const page = useViewState(viewer, (state) => state.currentPage);
const status = useDocumentState((state) => state.status);
```

A selector must return a primitive or an existing reference, so that equal
states compare equal: `(state) => state.layout?.sizes.length ?? 0`, not
`(state) => ({ page: state.currentPage })`.

## View state

`useViewState(viewer, selector)` reads a viewer's `ViewerState`. Outside
React, `viewer.store.get()` returns it and `viewer.store.subscribe(listener)`
hears each change; `viewer.store.hot` and `viewer.store.cold` publish its
two parts apart.

The store publishes when the document is laid out, the mounted pages or the
current page change, or the view does; scrolling and zoom gestures change
nothing in it per frame.

| Field | Part | Meaning |
|---|---|---|
| `layout` | hot | The pages laid out at the current zoom, null until a document shows: their sizes in PDF points (`layout.sizes`, whose length is the page count), boxes, rows, and the content's size. |
| `first`, `last` | hot | The mounted pages: those in view and `overscan` beyond each edge. |
| `currentPage` | hot | The zero-based page being read: the one nearest the viewport's center, except that the current page stays current while all of it is in view, as in pdf.js. `goToPage()`, links, `back()`, and search make the page they show current. |
| `scale` | hot | CSS pixels per PDF point. |
| `zoomMode` | hot | `"fit-width"` or `"fit-page"` while the page is fitted as the viewport resizes or the view turns, otherwise `"custom"`. |
| `rotation` | cold | The clockwise rotation of every page: 0, 90, 180, or 270. |
| `spread` | cold | `"none"`, `"odd"`, or `"even"` (see [Scroll modes and spreads](/guides/layout/)). |
| `scrollMode` | cold | `"vertical"`, `"horizontal"`, `"wrapped"`, or `"page"`. |
| `tool` | cold | What a mouse drag does: `"select"` text, or scroll the document with the `"hand"`. |

## Document state

`useDocumentState(selector)` reads the `DocumentState` of the nearest
`PdfDocument`'s session, which it publishes from the moment the document
starts to open, before pdf.js has loaded. Outside React,
`useSession().state` is the store.

| Field | Meaning |
|---|---|
| `status` | `"loading"`, `"password"` while an encrypted document waits for a password (see [Encrypted documents](/guides/encrypted/)), `"ready"` once pdf.js's document and its permissions are read, or `"error"`. |
| `error` | The error's message, otherwise null. |
| `passwordReason` | `"required"` or `"incorrect"` while the document waits for a password, otherwise null. |
| `progress` | `{ loaded, total }` bytes of the document received, `total` null when the server did not say; null before any arrive. It is published at most once an animation frame, and pdf.js may keep fetching the rest of a large document after it is ready. |
| `pageCount` | Pages in the document, 0 until it is ready. |
| `permissions` | What the document permits (see [Permissions](/guides/permissions/)), everything when it is not encrypted; null until it is ready, and when reading them failed. |

With `passwordPrompt={false}`, a `PdfDocument` shows a password request as
the error pdf.js gives without a password: status `"error"`, and a null
`passwordReason`.

## The session

`useSession()` returns the nearest `PdfDocument`'s `PdfSession`, which it
creates as it renders: its children read it at once.

| Member | |
|---|---|
| `source` | The source it shows. |
| `state` | The document state's store, as above. |
| `submitPassword(password)` | Tries a password while the document asks for one; a wrong one asks again, with the reason `"incorrect"`, and null stops opening it, which then fails. Any `PdfDocument` of the document may answer. |
| `proxy` | pdf.js's `PDFDocumentProxy`, for its APIs ParaPDF does not wrap; null until it loads (see [Sources](/reference/sources/#pdfjss-own-api)). |
| `signal` | Aborted once the `PdfDocument` lets the session go, or the session closes. |
| `outline()`, `pageLabels()`, `metadata()`, `attachments()`, `layers()`, `initialView()` | Promises of the document's secondary data, each read once and settled with an empty value when the read or the document fails. `useOutline()` and the other data hooks read them with `use()`. |

A `PdfSession` has no method that opens, closes, or releases anything:
`PdfDocument` holds the document while it is mounted.

## Features' state

| Store | Fields |
|---|---|
| `searchOf(viewer).store`, `useSearch(viewer)` | `query`, `options`, `status` (`"idle"`, `"searching"`, or `"done"`), `matches` in page order, `current` (the selected match's index, -1 for none), and `pagesSearched` (see [Search](/guides/search/)). |
| `historyOf(viewer).store`, `useHistory(viewer)` | `canGoBack` and `canGoForward` (see [Navigation](/guides/navigation/)). |
| `useAnnotationEditing(viewer)?.store`, `useAnnotations(viewer)` | `tool`; `state`, with `canUndo`, `canRedo`, `hasSelection`, and `isEmpty`; and `styles`, each tool's style; the last two null until editing starts (see [Annotations](/guides/annotations/)). |
