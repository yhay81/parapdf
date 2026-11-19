# Text-layer virtualization evaluation (webkit 27.2)

- Run at: 2026-11-19T07:18:48.557Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5 → 5.5; waited once (5 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs that another browser overlapped
- Viewport: 1280×900 at devicePixelRatio 2, fit-width zoom, vertical scroll, annotation layers off, maxCanvasPixels 25165824 (24 MP), median of 3 runs.
- Versions: pdfjs-dist 6.5.438.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit RUNS=3 OUTPUT=text-virtualization-webkit node examples/prototype/scripts/text-virtualization-bench.ts`

## Browser behavior checks

- `hidden="until-found"`: `onbeforematch`=true, computed `display`=`block`, `contentVisibility`=`hidden`, `window.find()` matches hidden=true, `selectAllChildren()` includes hidden=false.
- Line-wrapped phrases: `window.find("parapdfhyphenprobe")` across `<span>parapdf-</span><br><span>hyphenprobe</span>`=false; `window.find("パラPDF検索検証九八四")` across `<span>パラＰＤＦ</span><br><span>検索検証九八四</span>`=false.
- `bill-hr815.pdf` (110 pages): `getText(session)`=128 ms (300678 chars); `findText(session, "appropriations")`=38.8 ms (74 matches).
- Cross-window DOM Selection: anchor lost when page 1 unmounts=true; pinning only endpoint pages (1 and 10) silently drops unmounted pages 2–7=true (8694 chars copied vs 24808 chars across 10 pages from `getText(session, { from, to })` in 0.44 ms).

## bill-hr815.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 157.3 | 251.9 | 3 / 3 | 1314 (572) | 3 | 0.2 / 7503 | 13.1 | 39.8 / 11.1 | 0 / 147 | 10 |
| bounded-20 | 142.8 | 700.8 | 21 / 21 | 10256 (4542) | 21 | 1.16 / 56748 | 100.2 | 248.7 / 25.1 | 1 / 146 | 8 |
| until-found | 163.8 | 349.6 | 3 / 3 | 1528 (572) | 3 | 0.64 / 7503 | 13.5 | 8.6 / 9.8 | 0 / 147 | 10 |
| all-text | 155.6 | 4313.1 | 110 / 110 | 50818 (22102) | 110 | 9.7 / 300460 | 310.9 | 1447.4 / 135 | 20 / 67 | 3 |

## synthetic-text-1000.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 192 | 273.3 | 3 / 3 | 500 (159) | 3 | 0.1 / 12192 | 14 | 15.5 / 11.8 | 0 / 147 | 11 |
| bounded-20 | 193.4 | 659.6 | 21 / 21 | 3488 (1113) | 21 | 0.66 / 83456 | 30.6 | 82.8 / 15.1 | 0 / 147 | 8 |
| until-found | 201.1 | 1341.7 | 3 / 3 | 2494 (159) | 3 | 0.36 / 12192 | 18 | 43 / 11.3 | 0 / 147 | 11 |
| all-text | 201.4 | 80366.4 | 1000 / 1000 | 166002 (53000) | 1000 | 27.32 / 3982283 | 740.8 | 2064 / 522.3 | 10 / 12 | 3 |
