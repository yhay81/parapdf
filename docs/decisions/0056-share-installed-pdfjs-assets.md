# 0056. Resolve on-demand assets from the installed pdfjs-dist

- Status: adopted
- Date: 2026-11-21

## Decision

The npm package uses its exact pdfjs-dist dependency for 211 files totaling 2,908,421 bytes. They include character maps, fonts, decoders, the ICC profile, annotation icons, QuickJS and their licenses. ParaPDF still ships the parsing workers with its prelude, matching modern and legacy drawing workers with a JavaScript extension, and its QuickJS adapter. An application can install with lifecycle scripts disabled.

The build compacts ParaPDF's emitted JavaScript and composes its source maps with TypeScript's. It preserves module boundaries, function and class names, tree-shaking annotations, client directives, declaration maps and the original TypeScript. Terser is a development dependency.

For static hosting, run `npm exec -- parapdf-copy-assets public/pdfjs` when building the application, and use that public directory with `configurePdfjs({ assetBase })`. The export reproduced every one of the previous directory's 217 files byte for byte, including its licenses. Repeating it preserves unrelated files in the destination.

## Bundlers

Production bundlers resolve a literal `new URL` for each resource, so each PDF downloads only the assets it uses. The simple version also opened a Japanese PDF in production, but Vite's development optimizer rebased the bare URLs under ParaPDF's module directory. The color check rendered RGB (255, 46, 23) instead of (236, 31, 37), the JPEG 2000 fixture lost its red image and QuickJS failed to start. Importing the CMaps with `?url` directly also failed during dependency optimization.

Vite's development adapter imports the original URL manifest as a source module so the dev server resolves the package specifiers. A bundle made under development conditions uses the bundled module. The standard production path has no extra manifest request. The Vite fixture places pdfjs-dist inside the consumer project, as npm installs it. Its tests exercise production assets, the static export, and development with HMR disabled. The other bundler checks exercise both builds of pdf.js in webpack, Rsbuild, Next.js Turbopack and Next.js webpack.

## Measurement

Each column is a fresh production npm installation with React and React DOM 19.3.1. “Before” is 52af9f3. The comparison application uses react-pdf 11.1.0 and react-window 2.5.3. All nine installations resolved pdfjs-dist 6.5.438 and the same optional native canvas version. Each row includes the binary for its target. Sizes sum regular files under `node_modules`, excluding npm's hidden lockfile and symlinks.

| npm target | Before (bytes) | ParaPDF (bytes) | react-pdf (bytes) |
| --- | ---: | ---: | ---: |
| macOS arm64 | 84,067,879 | 80,441,420 | 80,602,859 |
| Linux x64, glibc | 90,677,522 | 87,051,063 | 87,212,502 |
| Windows x64 | 95,109,186 | 91,482,727 | 91,644,166 |

The package change saved 3,626,459 bytes in each install and finished 161,439 bytes below the virtualized react-pdf application. npm 12.2.2 ran on macOS. The Linux and Windows rows used npm's target flags and the native binary selected for each target. The native canvas package was 1.2.0 in the macOS consumer check.

| First selectable Japanese page, gzip bytes | Before | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: | ---: |
| Application and pdf.js scripts | 253,931 | 254,124 | 267,373 |
| Separate CSS | 0 | 0 | 2,278 |
| Parsing worker | 381,163 | 381,163 | 380,093 |
| Total code | 635,094 | 635,287 | 649,744 |

Chromium opened each minimal Vite 8.3.8 production reader. The server counted each successful JavaScript and CSS request once, including the worker. The totals exclude the PDF, fonts and HTTP headers. The candidate added 193 gzip bytes to the first page relative to the previous build. Its bundled worker carries the prelude for automatic asset loading, which adds 1,070 gzip bytes over react-pdf's worker.

A third application rendered a single `<Page>` with react-pdf and omitted react-window entirely. Its macOS installation was 80,175,275 bytes, **266,145 bytes smaller than ParaPDF**. Its first page still loaded 643,929 gzip bytes, 8,642 more than ParaPDF. Use `SINGLE_PAGE=1` with the consumer benchmark to include this application.

The two optional drawing workers account for 296,912 bytes that also exist in pdfjs-dist. Sharing those files would cover the single-page install difference. We retained their `.js` entry points so deployment servers that lack a JavaScript MIME type for `.mjs` can serve the workers. The separate [static export](../../packages/parapdf/bin/copy-assets.mjs) keeps the same URLs for such hosts. A future experiment can revisit the copies if it preserves worker loading under a same-origin CSP, modern and legacy drawing, and static hosting.

To repeat the install check, pack both checkouts with `pnpm --filter parapdf pack --pack-destination <absolute-directory>`. For each cell start with an empty project, add the corresponding tarball or the two comparison packages and pin React and React DOM. Run `npm install --omit=dev --ignore-scripts --no-audit --no-fund`, adding `--os=linux --cpu=x64 --libc=glibc` or `--os=win32 --cpu=x64` for the other targets. Run the [consumer benchmark](../../examples/prototype/scripts/reader-footprint.ts) with `PARAPDF_VERSION` pointing to the packed tarball to also measure the JavaScript, CSS and worker for the first selectable Japanese page.

## Reopen if

A supported bundler cannot serve a resource from a clean installation, or a change to pdf.js's distribution removes the need for the development adapter. Check the requested bytes, scripting and rendered colors as well as the first page.
