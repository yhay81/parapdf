---
title: Server rendering
description: Use ParaPDF in server-rendered React applications and React Server Components.
---

ParaPDF's React modules declare `"use client"`. On the server, `PdfViewer`
renders an empty viewport and `PdfDocument` a preload of a URL source in the
page's head; pdf.js loads only in the browser, so components that render
them need no `next/dynamic` or other browser-only wrapper, and nothing
suspends.

```tsx
// app/manual/page.tsx: a Server Component.
import { PdfDocument, PdfViewer } from "parapdf";

export default function Page() {
  return (
    <PdfDocument source="/manual.pdf">
      <PdfViewer style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

The preload matches the CORS mode pdf.js fetches with, including a source's
`withCredentials`, so pdf.js takes the response and the PDF downloads once.
There is no preload when the request has `httpHeaders`, which no preload can
carry, whether the source or `configurePdfjs({ documentOptions })` sets them,
or with `disableStream`, with which pdf.js reads only the ranges it needs.
A provider rendered in Safari or another WebKit browser does not preload
either, but the server's page still does: Safari gives pdf.js the response
only once it has finished, and downloads a PDF pdf.js asks for earlier
again ([limitations](/about/limitations/)).

Hooks such as `useViewer()`, `useViewState()`, and `useDocumentState()`
belong in Client Components: put the toolbar and other controls in a file
that starts with `"use client"`. A viewer from `useViewer()` cannot be
passed from a Server Component; without one, `PdfViewer` uses a viewer of
its own.

The hooks that read the document's data and suspend, such as `useOutline()`
and `usePageLabels()`, need a Suspense boundary on the server too: the
server opens no document, so the boundary renders its fallback there, and
what it holds in the browser.
