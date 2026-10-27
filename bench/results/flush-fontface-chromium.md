# GPU canvas flush with FontFace and path text, Chromium

Issue #18. `bench/scripts/knockout-repro.ts` rendering page 1 of bill-hr815.pdf (annotations off) at several resolutions with `enableHWA`, `PROBE=1` (reading one pixel right after each render, which waits for the GPU work the render queued), with pdf.js's FontFace text and then with `disableFontFace` (`PATH_TEXT=1`), which draws glyphs as paths.

Reproduce: `BROWSER=chromium BUILDS=pdfjs-dist,master-worker HWA=1 ANNOTATIONS=0 PROBE=1 VIEWS=page-2,page-4,page-6,page-7,page-8,detail,detail-blank PATH_TEXT=0 node bench/scripts/knockout-repro.ts`, then `PATH_TEXT=1`.

## FontFace text (pdf.js's default)

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version); bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 16.9–18.7; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
Render: until the render task's promise resolves; settled: two animation frames later. Main-thread tasks: Chromium's TaskDuration over the settled time. drawImage and backdrop copies: on the main thread, or in the renderer worker when the page is drawn there. The other copies are the median of the remaining calls.
| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size | Read after render (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | whole page at 2 px/pt (1440×2160) | off | 15.7 | 47.9 | 3.1 | main thread | 0 | 0.0 | 0 | – | – | – | 0.9 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 15.5 | 47.5 | 3.6 | main thread | 0 | 0.0 | 0 | – | – | – | 1.1 |
| 6.4.299 (d0991a0d5) | true | whole page at 6 px/pt (4320×6480) | off | 16.0 | 48.1 | 3.3 | main thread | 0 | 0.0 | 0 | – | – | – | 0.9 |
| 6.4.299 (d0991a0d5) | true | whole page at 7 px/pt (5040×7560) | off | 15.1 | 47.2 | 21.1 | main thread | 0 | 0.0 | 0 | – | – | – | 18.6 |
| 6.4.299 (d0991a0d5) | true | whole page at 8 px/pt (5760×8640) | off | 15.8 | 47.8 | 22.2 | main thread | 0 | 0.0 | 0 | – | – | – | 18.4 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 15.5 | 47.9 | 19.2 | main thread | 0 | 0.0 | 0 | – | – | – | 17.2 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt, page bottom | off | 15.9 | 48.5 | 2.2 | main thread | 0 | 0.0 | 0 | – | – | – | 0.2 |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | off | 16.8 | 47.3 | 1.6 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 16.7 | 46.5 | 3.0 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 6 px/pt (4320×6480) | off | 17.3 | 47.3 | 1.6 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 7 px/pt (5040×7560) | off | 34.3 | 47.1 | 1.8 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 8 px/pt (5760×8640) | off | 33.3 | 47.3 | 1.6 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 32.8 | 47.6 | 2.4 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt, page bottom | off | 16.1 | 47.8 | 2.6 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |

## Path text (`disableFontFace: true`)

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version); bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 10.7–16.9; waited once (1 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
Render: until the render task's promise resolves; settled: two animation frames later. Main-thread tasks: Chromium's TaskDuration over the settled time. drawImage and backdrop copies: on the main thread, or in the renderer worker when the page is drawn there. The other copies are the median of the remaining calls.
| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size | Read after render (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | whole page at 2 px/pt (1440×2160) | off | 15.4 | 47.6 | 2.8 | main thread | 0 | 0.0 | 0 | – | – | – | 0.5 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 15.8 | 48.0 | 2.8 | main thread | 0 | 0.0 | 0 | – | – | – | 0.5 |
| 6.4.299 (d0991a0d5) | true | whole page at 6 px/pt (4320×6480) | off | 14.5 | 46.5 | 3.5 | main thread | 0 | 0.0 | 0 | – | – | – | 0.6 |
| 6.4.299 (d0991a0d5) | true | whole page at 7 px/pt (5040×7560) | off | 11.0 | 43.2 | 3.5 | main thread | 0 | 0.0 | 0 | – | – | – | 0.6 |
| 6.4.299 (d0991a0d5) | true | whole page at 8 px/pt (5760×8640) | off | 14.5 | 46.1 | 3.2 | main thread | 0 | 0.0 | 0 | – | – | – | 0.5 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 16.0 | 48.2 | 2.7 | main thread | 0 | 0.0 | 0 | – | – | – | 0.4 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt, page bottom | off | 15.7 | 48.1 | 2.5 | main thread | 0 | 0.0 | 0 | – | – | – | 0.3 |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | off | 16.6 | 48.0 | 1.3 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 18.0 | 47.9 | 1.3 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 6 px/pt (4320×6480) | off | 16.6 | 47.7 | 1.4 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 7 px/pt (5040×7560) | off | 16.3 | 47.8 | 1.3 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | whole page at 8 px/pt (5760×8640) | off | 15.0 | 47.4 | 1.7 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 16.5 | 47.0 | 3.5 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt, page bottom | off | 16.4 | 47.6 | 3.2 | renderer worker | 0 | 0.0 | 0 | – | – | – | 0.0 |
