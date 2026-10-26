---
title: Sources
description: What PdfDocument opens, how viewers share documents, and pdf.js's own API.
---

A source is a URL, `{ url }`, or `{ data }`, where `data` is a `Uint8Array`
or an `ArrayBuffer`:

```tsx
<PdfDocument source="/manual.pdf" />
<PdfDocument source={{ url: "/api/report.pdf", httpHeaders: { Authorization: `Bearer ${token}` } }} />
<PdfDocument source={{ data: bytes, password: "secret" }} />
```

| Field | |
|---|---|
| `url` | The document's URL. A string source is `{ url }`. |
| `httpHeaders` | With `url`: headers for pdf.js's requests, instead of those of `documentOptions`. A source with headers is not preloaded (see [Server rendering](/setup/server-rendering/)). |
| `withCredentials` | With `url`: send cookies and credentials with cross-origin requests, instead of following `documentOptions`. |
| `data` | The document's bytes. ParaPDF copies them before pdf.js transfers them to its worker, so your bytes stay usable. |
| `password` | The password of an encrypted document, for either kind: it is tried first, and another is asked for only when it is wrong (see [Encrypted documents](/guides/encrypted/)). |

## Sessions

- One open document is a session, which every `PdfDocument` of the same
  source joins: the same URL with the same headers and credentials mode, or
  the same bytes object. Its viewers share pdf.js's document, its pages'
  sizes and text, its outline and other data, and which layers show.
- A new source object with the same URL keeps the open document, so
  `source={{ url }}` inline is fine. A changed URL, headers, credentials
  mode, or password, or another bytes object, opens another; a new password
  for the same source tries it on the shared document, as after a wrong one.
- A document is closed a second after the last `PdfDocument` of it
  unmounts, so React's StrictMode and a quick remount reuse it instead of
  loading it again; one still loading or waiting for a password stops
  loading. Closing it stops everything started for it: drawing, searches,
  background reads, the annotation editor, and printing.
- Under one `PdfDocument`, any number of `PdfViewer`s and `PdfThumbnails`
  show the document, each viewer with its own view. Viewers that edit
  annotations share the document too: `save()` and `print()` from any of
  them include what every one created, while each shows the annotations it
  created itself.

## pdf.js's own API

`useSession().proxy` is pdf.js's `PDFDocumentProxy` of the open document,
or null before it opens, for what ParaPDF does not wrap:

```tsx
import { useDocumentState, useSession } from "parapdf";

/** The document's own ID, to keep views and annotations by, whatever its URL. */
function useDocumentId(): string | null {
  const session = useSession();
  // Renders again once the document is ready, when the proxy is set.
  const ready = useDocumentState((state) => state.status === "ready");
  return ready ? (session.proxy?.fingerprints[0] ?? null) : null;
}
```

The proxy belongs to the session, which every viewer of the document
shares: do not destroy it. `viewer.session?.proxy` is the same document.
