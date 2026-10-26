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

- A URL source may add `httpHeaders` and `withCredentials` for its request,
  and either kind the `password` of an encrypted document. A source's own
  headers and credentials replace those of `documentOptions`, and one with
  headers is not preloaded while the page renders (see
  [Server rendering](/setup/server-rendering/)).
- Viewers of the same URL (with the same headers and credentials), or of the
  same bytes, share one loaded document, and React's StrictMode or a quick
  remount reuses it instead of loading it again.
- A document is closed a second after its last viewer unmounts; one still
  loading or waiting for a password stops loading.
- A new source object with the same URL keeps the open document, so
  `source={{ url }}` inline is fine.
- ParaPDF copies `data` before pdf.js transfers it to its worker, so your
  bytes stay usable.

A viewer with `annotationEditing` opens its own copy of the document instead
of sharing one: annotations live in the document, and another viewer of it
would save them too.

## pdf.js's own API

`usePdfDocument()` returns pdf.js's `PDFDocumentProxy` of the open document,
or null before it opens, for what ParaPDF does not wrap:

```tsx
import { usePdfDocument } from "parapdf";

/** The document's own ID, to keep views and annotations by, whatever its URL. */
function useDocumentId(): string | null {
  const proxy = usePdfDocument();
  return proxy?.fingerprints[0] ?? null;
}
```

The proxy belongs to the viewer: do not destroy it.
