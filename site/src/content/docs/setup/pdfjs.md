---
title: Configuring pdf.js
description: Change how ParaPDF loads pdf.js, its worker, and its files.
---

Most applications configure nothing. `configurePdfjs()`, called once before
the first `PdfDocument` renders, changes how ParaPDF loads pdf.js. Once
pdf.js has loaded, a different configuration is ignored with a warning, and
the same one, as hot module replacement passes it again, silently.

```tsx
"use client";

import { configurePdfjs } from "parapdf";

configurePdfjs({ documentOptions: { withCredentials: true } });
```

| Option | |
|---|---|
| `assetBase` | Public URL of the directory written by `parapdf-copy-assets` (with or without a trailing slash; relative paths resolve against `document.baseURI`), for bundlers that do not emit the files themselves (see [Bundlers](/setup/bundlers/)). |
| `imageResourcesPath` | Base URL of pdf.js's annotation icons, which comments without an appearance of their own show (with or without a trailing slash). By default they are the icons the package ships, or `${assetBase}/web/images/` with `assetBase`. |
| `workerSrc` | URL of pdf.js's worker script, when it is not `${assetBase}pdf.worker.js`. |
| `build` | `legacyBuild` from `parapdf/legacy`: pdf.js's legacy build for older browsers, with its worker and files from the package like the modern build's. |
| `pdfjs` | Loads another build of the same pdf.js version, with its worker as `workerSrc` and its files as `assetBase`. |
| `enableHWA` | `true` by default. Requests GPU-backed canvases from the browser. Set to `false` to ask pdf.js for CPU-backed canvases. |
| `documentOptions` | More pdf.js `getDocument` parameters for every document, such as `withCredentials`, `httpHeaders`, `disableAutoFetch`, or `maxImageSize`; they override ParaPDF's own. ParaPDF sets the source and the worker. |
| `rendererSrc` | Set to `true` to draw pages in the bundled renderer worker, or supply a worker URL. The worker matches the modern or legacy build and is loaded only when enabled. By default pdf.js draws on the main thread. |

## Mesh shadings

Applications displaying PDFs with mesh gradients can ask pdf.js to draw them
using WebGPU. pdf.js tries to acquire a GPU device when the first document
opens. It uses the CPU if WebGPU is unavailable. The option defaults to off.

```ts
configurePdfjs({ documentOptions: { enableWebGPU: true } });
```

## Loading early

Call `preloadDocument(source, options?)` when you know which PDF the reader
may open next, for example when they hover over a document link. It starts
loading pdf.js and opening the document, including its first page size,
permissions, reading direction, optional-content layers, initial view, and page
labels. It also resolves destinations in the URL fragment or
`options.destinations`. Eligible URL sources can download alongside pdf.js.
[URL preload behavior](/setup/server-rendering/)

A `PdfDocument` for the same source reuses this work. When the required data
is ready, the viewer can lay out its opening view synchronously. Pages still
need to draw. An unused preload closes after ten seconds of inactivity.

When you do not know which document will open yet, `preloadPdfjs()` starts
loading pdf.js and its worker alone. The first `PdfDocument` also starts
this load. With the built-in modern or legacy build, the worker and the
pdf.js module load in parallel when the worker is on the same origin,
including a static copy served from `assetBase`.

## The legacy build

For browsers that need pdf.js's legacy build:

```tsx
"use client";

import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";

configurePdfjs({ build: legacyBuild });
```

Only applications that import `parapdf/legacy` emit the legacy worker,
about 1.3 MB, but the modern worker, about 1.2 MB, is emitted either way:
the build output grows, the browser fetches only the worker it uses.

## The version

`pdfjsVersion` is the version of pdf.js the package ships, for URLs of files
you serve yourself. ParaPDF depends on that version exactly: pdf.js refuses a
worker of another version, so an application cannot move to another pdf.js
by itself. When pdf.js publishes a security fix, a ParaPDF release moves to
it ([security policy](https://github.com/yhay81/parapdf/blob/main/SECURITY.md)).
