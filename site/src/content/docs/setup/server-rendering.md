---
title: Server rendering
description: Use ParaPDF in server-rendered React applications and React Server Components.
---

ParaPDF's React modules declare `"use client"`, and its components render on
the server as an empty viewport, with a preload of the PDF in the page's
head. pdf.js loads only in the browser, so components that render
`PdfDocument` need no `next/dynamic` or other browser-only wrapper.

```tsx
// app/manual/page.tsx: a Server Component.
import { PdfDocument, PdfViewport } from "parapdf";

export default function Page() {
  return (
    <PdfDocument source="/manual.pdf">
      <PdfViewport style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

The preload matches the CORS mode pdf.js fetches with, including a source's
`withCredentials`, so pdf.js takes the response and the PDF downloads once.
There is no preload when the request has `httpHeaders`, which no preload can
carry, whether the source or `configurePdfjs({ documentOptions })` sets them,
or with `disableStream`, with which pdf.js reads only the ranges it needs.

Hooks such as `usePdfViewer` and `usePdfState` belong in Client Components:
put the toolbar and other controls in a file that starts with
`"use client"`.
