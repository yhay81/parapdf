# Text-layer virtualization evaluation (firefox 159.0)

- Run at: 2026-11-19T07:04:09.558Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5.3 → 3.9; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Viewport: 1280×900 at devicePixelRatio 2, fit-width zoom, vertical scroll, annotation layers off, maxCanvasPixels 25165824 (24 MP), median of 3 runs.
- Versions: pdfjs-dist 6.5.438.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox RUNS=3 OUTPUT=text-virtualization-firefox node examples/prototype/scripts/text-virtualization-bench.ts`

## Browser behavior checks

- `hidden="until-found"`: `onbeforematch`=true, computed `display`=`block`, `contentVisibility`=`hidden`, `window.find()` matches hidden=true, `selectAllChildren()` includes hidden=false.
- Line-wrapped phrases: `window.find("parapdfhyphenprobe")` across `<span>parapdf-</span><br><span>hyphenprobe</span>`=false; `window.find("パラPDF検索検証九八四")` across `<span>パラＰＤＦ</span><br><span>検索検証九八四</span>`=false.
- `bill-hr815.pdf` (110 pages): `getText(session)`=159.9 ms (300678 chars); `findText(session, "appropriations")`=48.8 ms (74 matches).
- Cross-window DOM Selection: anchor lost when page 1 unmounts=true; pinning only endpoint pages (1 and 10) silently drops unmounted pages 2–7=true (8697 chars copied vs 24808 chars across 10 pages from `getText(session, { from, to })` in 0.94 ms).

## bill-hr815.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 244.6 | 344.2 | 3 / 3 | 1314 (572) | 3 | 1.4 / 7505 | 57.6 | 60.4 / 14.3 | 0 / 123 | 9 |
| bounded-20 | 237.6 | 653.9 | 21 / 21 | 10256 (4542) | 21 | 11.72 / 56768 | 64.9 | 81.3 / 18 | 0 / 123 | 7 |
| until-found | 259.6 | 527.8 | 3 / 3 | 1528 (572) | 3 | 2.04 / 7506 | 61.4 | 48.1 / 15.2 | 0 / 123 | 10 |
| all-text | 220.4 | 2123.8 | 110 / 110 | 50818 (22102) | 110 | 57.28 / 300569 | 86.1 | 61.6 / 16.6 | 0 / 123 | 3 |

## synthetic-text-1000.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 271 | 353.8 | 3 / 3 | 500 (159) | 3 | 0.72 / 12194 | 65.4 | 50.5 / 17.7 | 0 / 123 | 11 |
| bounded-20 | 296 | 601.2 | 21 / 21 | 3488 (1113) | 21 | 3.8 / 83476 | 72.5 | 87.7 / 18.9 | 0 / 123 | 8 |
| until-found | 274.3 | 2348.3 | 3 / 3 | 2494 (159) | 3 | 3.9 / 12195 | 66 | 72 / 22.7 | 0 / 123 | 11 |
| all-text | 277.6 | 12669.2 | 1000 / 1000 | 166002 (53000) | 1000 | 196.74 / 3983282 | 202.4 | 147.8 / 21.7 | 0 / 123 | 4 |
