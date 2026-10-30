# 0007. Keeping unmounted pages' parsed content

- Status: rejected
- Date: 2026-10-24

## Decision

A page that leaves the mounted window calls `page.cleanup()`. Skipping it
for the last pages that unmounted, so that pdf.js keeps their operator lists
and decoded images, had no measured effect where it would show, while the
pages hold their memory. Kept canvases (decision 0004) bring pages back
instead.

## Evidence

`return-bench.ts`, three runs in each browser, medians
([`return-keep-parsed-chromium.md`](../../examples/prototype/results/return-keep-parsed-chromium.md),
[`-webkit`](../../examples/prototype/results/return-keep-parsed-webkit.md),
[`-firefox`](../../examples/prototype/results/return-keep-parsed-firefox.md)):
without kept canvases, pages got sharp within 11 ms of the build that cleans
up, after a jump back and after flipping back, in every browser and file; it
blocked the main thread longer over a scroll back on bill-hr815.pdf in
Chromium (71 against 39 ms).

## Reopen if

Multi-page scans, which the corpus lacks, come back slowly because their
images are decoded again.
