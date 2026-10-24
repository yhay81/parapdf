# 0007. Keeping unmounted pages' parsed content

- Status: rejected
- Date: 2026-10-24

## Idea

Do not call `page.cleanup()` on the last six pages that left the mounted
window, so that a page drawn again keeps pdf.js's operator list and decoded
images instead of asking the worker for them again.

## Evidence

The result files are on branch `claude/frame-bench`.

- Engine benchmark: a page's second drawing took 21 instead of 54 ms on
  bill-hr815.pdf and 17 instead of 84 on a scanned page in Chromium, but
  that compares a first drawing, fonts included, with a second.
- Return benchmark (`return-bench.ts`, variant "none" against "before",
  three runs in each browser): the way back got sharp within 11 ms of the
  build before in every browser, scenario, and file, for example after 173
  against 184 ms on bill-hr815.pdf in Firefox, and 167 against 167 on
  synthetic-vector-pages.pdf in Chromium.

## Why rejected

No measured effect where it would show, while the pages hold their memory.

## Reopen if

Multi-page scans, which the corpus lacks, come back slowly because their
images are decoded again.
