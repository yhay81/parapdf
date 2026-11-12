# 0030. DOM layers and search boxes follow the page's PDF user-space unit

- Status: adopted
- Date: 2026-11-13

## Decision

Use the page proxy's `userUnit` when building its text, annotation, and
editor layers. pdf.js sizes these elements with raw PDF coordinates and a
CSS scale. A text layer keeps its layout scale until it needs to be laid
out again. The viewer's layout, canvas viewports, and application overlays
already use physical points. For search, convert both corners of the
approximate text box with the page viewport so its dimensions also follow
the unit and intrinsic rotation.

## Evidence

On a page with `/UserUnit 2` and `/Rotate 90`, a link intended to cover
(280, 80) to (304, 200) CSS pixels at scale 1 covered (140, 40) to
(152, 100). The form field, selectable text, and editor layer had the same
error. `check:rotation` checks these elements with other pages using the
default unit in the same document, at scales 1 and 1.5. It also checks the
text box search uses before the text layer exists.

On an M2 Pro on AC power, `commit-bench.ts` measured the `scale-up`
scenario on the 110-page `bill-hr815.pdf`, three runs each of the baseline
(`bb2ca4c`) and this build in the same run. Both builds had zero blank
frames, five detail renders, and the same peak canvas memory in each browser.
Separately, after the first text layer and page sizes were ready in a
fresh context, the timed operation awaited `session.text(i)` sequentially
for all 110 pages, totaling 22,341 items. Each build ran three times with
the order reversed each round, with one browser running at a time. Times
in the table are medians in milliseconds.

| Browser | Zoom, before → after | Read all text, before → after |
|---|---:|---:|
| [Chromium 158](../../examples/prototype/results/commit-user-unit-chromium.md) | 12 → 11 | 92 → 93 |
| [WebKit 27.2](../../examples/prototype/results/commit-user-unit-webkit.md) | 7 → 10 | 128 → 134 |
| [Firefox 159](../../examples/prototype/results/commit-user-unit-firefox.md) | 86 → 78 | 222 → 171 |

The correction is retained for accurate selection, hit testing, and search
on these pages, including the increases in the WebKit medians.

## Reopen if

pdf.js starts incorporating the page unit into the CSS dimensions of its
layers, or profiling identifies box conversion as a significant cost.
