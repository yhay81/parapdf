---
title: Configuring pdf.js
description: Change how ParaPDF loads pdf.js, its worker, and its files.
---

Most applications configure nothing. `configurePdfjs()`, called once before
the first `PdfDocument` renders, changes how ParaPDF loads pdf.js:

```tsx
import { configurePdfjs } from "parapdf";

configurePdfjs({ documentOptions: { withCredentials: true } });
```

| Option | |
|---|---|
| `assetBase` | Base URL of a copy of `node_modules/parapdf/pdfjs/`, ending with a slash, for bundlers that do not emit the files themselves (see [Bundlers](/setup/bundlers/)). |
| `imageResourcesPath` | Base URL of pdf.js's annotation icons, which comments without an appearance of their own show, ending with a slash. By default they are the icons the package ships, or `${assetBase}web/images/` with `assetBase`. |
| `workerSrc` | URL of pdf.js's worker script, when it is not `${assetBase}pdf.worker.js`. |
| `build` | `legacyBuild` from `parapdf/legacy`: pdf.js's legacy build for older browsers, with its worker and files from the package like the modern build's. |
| `pdfjs` | Loads another build of the same pdf.js version, with its worker as `workerSrc` and its files as `assetBase`. |
| `enableHWA` | GPU-backed canvases, `true` by default; `false` asks pdf.js for CPU-backed ones, which block the main thread for longer in Chromium and drop more frames in WebKit, though WebKit holds less memory with them. |
| `documentOptions` | More pdf.js `getDocument` parameters for every document, such as `withCredentials`, `httpHeaders`, or `password`. |
| `rendererSrc` | pdf.js's renderer worker, which draws pages off the main thread; it is only in unreleased pdf.js builds so far. |

## Loading early

`preloadPdfjs()` starts loading pdf.js and its worker before any
`PdfDocument` renders, for example when the pointer moves over a link to a
document. The first `PdfDocument` starts it anyway, with the worker's
download beside pdf.js's module rather than after it.

## The legacy build

For browsers that need pdf.js's legacy build:

```tsx
import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";

configurePdfjs({ build: legacyBuild });
```

Only applications that import `parapdf/legacy` emit the legacy worker, but
the modern worker, about 1.3 MB, is emitted either way: the build output
grows, the browser fetches only the worker it uses.

## The version

`pdfjsVersion` is the version of pdf.js the package ships, for URLs of files
you serve yourself. ParaPDF depends on that version exactly: pdf.js refuses a
worker of another version, so an application cannot move to another pdf.js
by itself. When pdf.js publishes a security fix, a ParaPDF release moves to
it ([security policy](https://github.com/yhay81/parapdf/blob/main/SECURITY.md)).
