# Rendering fidelity: Firefox 157.0

- Run at: 2026-11-12T14:41:59.325Z
- Engines: pdfjs-hwa (pdfjs-dist 6.5.438), pdfjs-hwa-renderer (pdfjs-dist 6.5.438)
- Method: the first 2 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=firefox FILES=pdfium-jpx-lzw.pdf,patent-us223898.pdf,bill-hr815.pdf PAGES=2 SCALE=2.6667 PAIRS=pdfjs-hwa:pdfjs-hwa-renderer OUTPUT=release65- node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| pdfium-jpx-lzw.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 1/1 | — |
| patent-us223898.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 2/2 | — |
| bill-hr815.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 2/2 | — |
