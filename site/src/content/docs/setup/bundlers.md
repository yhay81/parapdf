---
title: Bundlers
description: How the files pdf.js needs reach your build, and what to do with bundlers that do not copy them.
---

The package holds pdf.js's worker and the files pdf.js loads on demand:

- CMaps for CJK text in fonts without their own encoding,
- the Symbol and ZapfDingbats fonts,
- the JPEG 2000 and JBIG2 image decoders,
- and the ICC profile and decoder pdf.js converts CMYK colors with.

ParaPDF refers to each with `new URL(…, import.meta.url)`, so bundlers copy
them to the build output, about 5 MB, and the browser fetches one only when a
PDF needs it. ParaPDF also asks bundlers not to inline the small ones as
`data:` URLs, which Vite does with files under 4 KB, so no `assetsInlineLimit`
setting is needed. The worker's own URL passes it the others' URLs, so pdf.js
manages colors as it does with its files served from one directory: a fill in
CMYK red (0, 1, 1, 0) shows as rgb(236 31 37), where pdf.js without its ICC
profile shows rgb(255 46 23).

## Bundlers that work as they are

These were tested and need no setup:

- Vite 8, its development server and its builds (this site is built with
  Astro on Vite)
- webpack 5
- Rsbuild 2
- Next.js 16, with Turbopack and with webpack

## Bundlers that need a copy

Parcel 2 bundles the worker again into a script that does not start, and
esbuild and Bun copy none of the files. With those, copy
`node_modules/parapdf/pdfjs/` to where your application serves static files,
such as `public/pdfjs/`, and tell ParaPDF where it is, before the first
`PdfDocument` renders:

```tsx
import { configurePdfjs } from "parapdf";

configurePdfjs({ assetBase: "/pdfjs/" });
```

## Content Security Policy

With a Content Security Policy, the worker needs `worker-src 'self'` and the
decoders `script-src 'wasm-unsafe-eval'`. When the files come from another
origin than the page, such as a CDN, pdf.js starts its worker from a `blob:`
URL, which `worker-src` must then allow.

The worker, about 1.2 MB, is too large for any bundler to inline as a
`data:` URL, so with the bundlers above it loads from your origin, and a
policy that refuses `blob:` workers still works.
