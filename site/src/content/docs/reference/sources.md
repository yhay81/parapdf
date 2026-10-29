---
title: Sources
description: What PdfDocument opens, how viewers share documents, and pdf.js's own API.
---

A source is a URL, `{ url }`; `{ data }`, where `data` is a `Uint8Array`
or an `ArrayBuffer`; or `{ range }`, a transport:

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
| `range` | A `PDFDataRangeTransport` of pdf.js through which your code hands pdf.js the ranges it asks for (see [Transports](#transports)). |
| `password` | The password of an encrypted document, for any kind: it is tried first, and another is asked for only when it is wrong (see [Encrypted documents](/guides/encrypted/)). |

## Transports

A transport source, `{ range }`, hands pdf.js the byte ranges it asks for
through pdf.js's `PDFDataRangeTransport`, for a document your own code
fetches: from a store of its own, or with authentication that request
headers cannot carry. Subclass it from the `pdfjs-dist` ParaPDF depends on,
give it the file's length, and answer each `requestDataRange(begin, end)`
with `onDataRange(begin, bytes)`:

```tsx
import { PDFDataRangeTransport } from "pdfjs-dist";

class StoreTransport extends PDFDataRangeTransport {
  override requestDataRange(begin: number, end: number) {
    store.read(key, begin, end).then((bytes) => this.onDataRange(begin, bytes));
  }
}
const range = new StoreTransport(length, null);

<PdfDocument source={{ range }} />
```

Import it dynamically to keep pdf.js out of your first chunk. ParaPDF hands
pdf.js a transport of its own that forwards to yours, so yours stays usable
and opens again after its document was closed.

## Sessions

- One open document is a session, which every `PdfDocument` of the same
  source joins: the same URL with the same headers and credentials mode, or
  the same bytes or transport object. Its viewers share pdf.js's document, its pages'
  sizes and text, its outline and other data, and which layers show.
- A new source object with the same URL keeps the open document, so
  `source={{ url }}` inline is fine. A changed URL, headers, credentials
  mode, or password, or another bytes or transport object, opens another; a new password
  for the same source tries it on the shared document, as after a wrong one.
- A URL's fragment is not part of the source: it says where to open, with
  the open parameters of RFC 8118 that pdf.js's viewer reads. `#page=3`
  opens page 3, `#zoom=150,72,700` at 150% with that point of the page
  (left and top, in PDF points from its bottom left) at the viewport's
  corner, `#zoom=FitH,700` (or `Fit`, `FitV`, `FitR`, `page-width`, `page-fit`) fitted, and
  `#nameddest=intro` at a destination the document names. It wins over
  `initialView="document"`, `defaultPage`, and `defaultZoom`, and
  `initialViewState` wins over it. A new fragment of the same URL moves the `PdfDocument`'s
  viewers there, as following a link does, without opening the document
  again. `search` and `pagemode` are left to the application, whose find
  bar and sidebars they address.
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
