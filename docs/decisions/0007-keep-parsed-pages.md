# 0007. Keeping unmounted pages' parsed content

- Status: rejected
- Date: 2026-10-24

## Idea

Do not call `page.cleanup()` on the last six pages that left the mounted
window, so that a page drawn again keeps pdf.js's operator list and decoded
images instead of asking the worker for them again.

## Evidence

- Engine benchmark: a page's second drawing took 21 instead of 54 ms on
  bill-hr815.pdf and 17 instead of 84 on a scanned page in Chromium, but
  that compares a first drawing, fonts included, with a second.
- Return benchmark (`return-bench.ts`,
  `examples/prototype/results/return-keep-parsed-*.md`, three runs in each
  browser, medians), on a build that skipped `page.cleanup()` for the last
  six pages that unmounted. Its variant "none", which kept no canvases, got
  sharp within 11 ms of the build before after a jump back and after
  flipping back, in every browser and file (for example 173 against 184 ms
  on bill-hr815.pdf in Firefox, and 167 against 167 on
  synthetic-vector-pages.pdf in Chromium), and at the end of a scroll back
  within 10 ms, except 53 ms sooner on bill-hr815.pdf in Firefox. It blocked
  the main thread longer in some of them: over a scroll back on
  bill-hr815.pdf, 71 against 39 ms in Chromium.
- That build's variant "kept" also kept canvases. Decision 0004 cites the
  return benchmark run again on M1's build, which keeps no parsed content.

## Why rejected

No measured effect where it would show, while the pages hold their memory.

## Reopen if

Multi-page scans, which the corpus lacks, come back slowly because their
images are decoded again.
