# pdf.js's display bundle, tree-shaken

pdfjs-dist 6.4.299, `node bench/scripts/pdfjs-tree-shaking.ts`, 2026-10-30.
Sizes in KiB of the minified output, then gzip (level 9) and brotli.
Variants: G, L, E, P, I, T as in bench/upstream/pdfjs-tree-shaking-issue.md.

## Vite 8.3.4

| pdf.mjs | imports | minified | gzip | brotli |
|---|---|---|---|---|
| dist | getDocument | 420.4 | 124.9 | 103.9 |
| dist | viewer | 420.4 | 125.0 | 103.9 |
| dist | viewer + editor | 420.5 | 125.0 | 103.8 |
| G | getDocument | 380.5 | 113.6 | 94.8 |
| G | viewer | 407.0 | 120.2 | 100.3 |
| G | viewer + editor | 414.8 | 122.6 | 102.0 |
| GL | getDocument | 369.9 | 110.6 | 92.8 |
| GL | viewer | 396.4 | 117.1 | 98.0 |
| GL | viewer + editor | 414.8 | 122.6 | 102.0 |
| GLE | getDocument | 276.0 | 84.6 | 72.3 |
| GLE | viewer | 336.9 | 101.6 | 86.1 |
| GLE | viewer + editor | 414.9 | 122.6 | 102.0 |
| GLEP | getDocument | 262.7 | 80.1 | 68.4 |
| GLEP | viewer | 323.6 | 97.1 | 82.2 |
| GLEP | viewer + editor | 414.9 | 122.6 | 102.0 |
| GLEPI | getDocument | 191.5 | 59.3 | 51.0 |
| GLEPI | viewer | 252.6 | 76.4 | 65.5 |
| GLEPI | viewer + editor | 414.9 | 122.6 | 101.9 |
| GLEPIT | getDocument | 188.2 | 58.0 | 50.1 |
| GLEPIT | viewer | 249.2 | 75.2 | 64.4 |
| GLEPIT | viewer + editor | 414.8 | 122.6 | 102.0 |
| LEPIT | getDocument | 420.4 | 124.9 | 103.9 |
| LEPIT | viewer | 420.5 | 125.0 | 103.9 |
| LEPIT | viewer + editor | 420.5 | 125.0 | 103.9 |
| GEPIT | getDocument | 380.5 | 113.6 | 94.9 |
| GEPIT | viewer | 407.0 | 120.2 | 100.2 |
| GEPIT | viewer + editor | 414.8 | 122.6 | 101.8 |
| GLPIT | getDocument | 369.8 | 110.6 | 92.8 |
| GLPIT | viewer | 396.4 | 117.1 | 98.1 |
| GLPIT | viewer + editor | 414.7 | 122.6 | 102.1 |
| GLEIT | getDocument | 272.7 | 83.5 | 71.4 |
| GLEIT | viewer | 333.6 | 100.4 | 85.1 |
| GLEIT | viewer + editor | 414.8 | 122.6 | 102.0 |
| GLEPT | getDocument | 259.3 | 78.9 | 67.4 |
| GLEPT | viewer | 320.3 | 95.8 | 81.3 |
| GLEPT | viewer + editor | 414.8 | 122.6 | 101.9 |

## webpack 5.112.0

| pdf.mjs | imports | minified | gzip | brotli |
|---|---|---|---|---|
| dist | getDocument | 426.1 | 126.2 | 105.2 |
| dist | viewer | 426.1 | 126.2 | 105.3 |
| dist | viewer + editor | 426.1 | 126.2 | 105.3 |
| G | getDocument | 373.2 | 111.1 | 93.4 |
| G | viewer | 400.2 | 117.9 | 98.8 |
| G | viewer + editor | 419.0 | 123.4 | 102.9 |
| GL | getDocument | 264.4 | 80.0 | 68.7 |
| GL | viewer | 326.4 | 97.6 | 82.8 |
| GL | viewer + editor | 419.0 | 123.4 | 103.1 |
| GLE | getDocument | 264.4 | 80.0 | 68.7 |
| GLE | viewer | 326.4 | 97.6 | 82.9 |
| GLE | viewer + editor | 419.1 | 123.4 | 102.9 |
| GLEP | getDocument | 264.4 | 80.0 | 68.7 |
| GLEP | viewer | 326.4 | 97.6 | 82.8 |
| GLEP | viewer + editor | 419.1 | 123.4 | 102.9 |
| GLEPI | getDocument | 191.9 | 59.0 | 50.9 |
| GLEPI | viewer | 253.9 | 76.6 | 65.6 |
| GLEPI | viewer + editor | 419.0 | 123.4 | 103.0 |
| GLEPIT | getDocument | 188.4 | 57.7 | 49.9 |
| GLEPIT | viewer | 250.4 | 75.3 | 64.5 |
| GLEPIT | viewer + editor | 419.0 | 123.4 | 103.0 |
| LEPIT | getDocument | 426.1 | 126.2 | 105.2 |
| LEPIT | viewer | 426.2 | 126.2 | 105.1 |
| LEPIT | viewer + editor | 426.2 | 126.2 | 105.1 |
| GEPIT | getDocument | 373.2 | 111.1 | 93.4 |
| GEPIT | viewer | 400.2 | 117.9 | 98.7 |
| GEPIT | viewer + editor | 419.0 | 123.4 | 103.1 |
| GLPIT | getDocument | 188.4 | 57.7 | 49.9 |
| GLPIT | viewer | 250.4 | 75.3 | 64.5 |
| GLPIT | viewer + editor | 418.9 | 123.4 | 103.0 |
| GLEIT | getDocument | 189.1 | 58.0 | 50.1 |
| GLEIT | viewer | 251.1 | 75.6 | 64.7 |
| GLEIT | viewer + editor | 419.0 | 123.4 | 102.9 |
| GLEPT | getDocument | 260.9 | 78.7 | 67.6 |
| GLEPT | viewer | 322.9 | 96.3 | 81.8 |
| GLEPT | viewer + editor | 419.0 | 123.4 | 103.1 |

## esbuild 0.28.2

| pdf.mjs | imports | minified | gzip | brotli |
|---|---|---|---|---|
| dist | getDocument | 421.2 | 126.5 | 105.4 |
| dist | viewer | 421.2 | 126.6 | 105.3 |
| dist | viewer + editor | 421.2 | 126.6 | 105.2 |
| G | getDocument | 381.2 | 114.8 | 95.9 |
| G | viewer | 407.8 | 121.6 | 101.4 |
| G | viewer + editor | 415.5 | 124.1 | 103.3 |
| GL | getDocument | 370.5 | 111.8 | 93.8 |
| GL | viewer | 397.1 | 118.6 | 99.0 |
| GL | viewer + editor | 415.5 | 124.2 | 103.4 |
| GLE | getDocument | 276.0 | 85.4 | 73.1 |
| GLE | viewer | 337.2 | 102.8 | 87.3 |
| GLE | viewer + editor | 415.6 | 124.2 | 103.4 |
| GLEP | getDocument | 262.6 | 80.7 | 69.1 |
| GLEP | viewer | 323.8 | 98.1 | 83.2 |
| GLEP | viewer + editor | 415.6 | 124.2 | 103.4 |
| GLEPI | getDocument | 191.1 | 59.8 | 51.5 |
| GLEPI | viewer | 252.5 | 77.4 | 66.4 |
| GLEPI | viewer + editor | 415.6 | 124.2 | 103.5 |
| GLEPIT | getDocument | 187.8 | 58.5 | 50.4 |
| GLEPIT | viewer | 249.2 | 76.1 | 65.3 |
| GLEPIT | viewer + editor | 415.5 | 124.1 | 103.4 |
| LEPIT | getDocument | 421.2 | 126.5 | 105.4 |
| LEPIT | viewer | 421.3 | 126.6 | 105.3 |
| LEPIT | viewer + editor | 421.3 | 126.6 | 105.2 |
| GEPIT | getDocument | 381.2 | 114.8 | 96.0 |
| GEPIT | viewer | 407.8 | 121.6 | 101.5 |
| GEPIT | viewer + editor | 415.5 | 124.1 | 103.4 |
| GLPIT | getDocument | 370.4 | 111.8 | 93.7 |
| GLPIT | viewer | 397.0 | 118.5 | 99.1 |
| GLPIT | viewer + editor | 415.5 | 124.1 | 103.5 |
| GLEIT | getDocument | 272.6 | 84.2 | 72.0 |
| GLEIT | viewer | 333.9 | 101.6 | 86.3 |
| GLEIT | viewer + editor | 415.5 | 124.1 | 103.4 |
| GLEPT | getDocument | 259.2 | 79.4 | 67.9 |
| GLEPT | viewer | 320.5 | 96.8 | 82.2 |
| GLEPT | viewer + editor | 415.6 | 124.1 | 103.4 |
