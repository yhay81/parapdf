# Frame display fidelity: WebKit 27.2

- Run at: 2026-10-27T15:43:40.034Z
- Method: the first 1 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=webkit node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| pdfium-smask-blend.pdf | pdfjs | pdfium | 0/1 | p1 (153, 18.8% in 0 0.5 0.5 1) |
| pdfium-smask-blend.pdf | pdfjs-next | pdfium | 0/1 | p1 (153, 18.8% in 0 0.5 0.5 1) |
| pdfium-smask-blend.pdf | hayro | pdfium | 0/1 | p1 (2, 0.00%) |
| smask-group-luminosity.pdf | pdfjs | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group-luminosity.pdf | pdfjs-next | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group-luminosity.pdf | hayro | pdfium | 0/1 | p1 (153, 6.3% in 0.25 0.5 0.5 0.75) |
| smask-group-typed.pdf | pdfjs | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group-typed.pdf | pdfjs-next | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group-typed.pdf | hayro | pdfium | 0/1 | p1 (2, 0.00%) |
| smask-group.pdf | pdfjs | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group.pdf | pdfjs-next | pdfium | 0/1 | p1 (5, 0.00%) |
| smask-group.pdf | hayro | pdfium | 0/1 | p1 (2, 0.00%) |
| smask-luminosity.pdf | pdfjs | pdfium | 0/1 | p1 (255, 18.8% in 0 0.5 0.5 1) |
| smask-luminosity.pdf | pdfjs-next | pdfium | 0/1 | p1 (255, 18.8% in 0 0.5 0.5 1) |
| smask-luminosity.pdf | hayro | pdfium | 0/1 | p1 (153, 6.3% in 0.25 0.5 0.5 0.75) |
| smask-nomask.pdf | pdfjs | pdfium | 0/1 | p1 (3, 0.00%) |
| smask-nomask.pdf | pdfjs-next | pdfium | 0/1 | p1 (3, 0.00%) |
| smask-nomask.pdf | hayro | pdfium | 0/1 | p1 (2, 0.00%) |
| smask-normal-nomask.pdf | pdfjs | pdfium | 0/1 | p1 (6, 0.00%) |
| smask-normal-nomask.pdf | pdfjs-next | pdfium | 0/1 | p1 (6, 0.00%) |
| smask-normal-nomask.pdf | hayro | pdfium | 0/1 | p1 (6, 0.00%) |
| smask-normal.pdf | pdfjs | pdfium | 0/1 | p1 (102, 12.5% in 0 0.5 0.5 0.75) |
| smask-normal.pdf | pdfjs-next | pdfium | 0/1 | p1 (102, 12.5% in 0 0.5 0.5 0.75) |
| smask-normal.pdf | hayro | pdfium | 0/1 | p1 (6, 0.00%) |
| smask-typed.pdf | pdfjs | pdfium | 0/1 | p1 (153, 18.8% in 0 0.5 0.5 1) |
| smask-typed.pdf | pdfjs-next | pdfium | 0/1 | p1 (153, 18.8% in 0 0.5 0.5 1) |
| smask-typed.pdf | hayro | pdfium | 0/1 | p1 (2, 0.00%) |
