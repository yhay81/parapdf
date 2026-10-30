# 0021. Focus follows the page being read

- Status: adopted
- Date: 2026-10-29

## Decision

VoiceOver in Safari on macOS read from the first mounted page after the view
moved, stayed at an internal link after following it, and lost the focus
when its page unmounted
([`voiceover-safari-macos.md`](../../examples/prototype/results/voiceover-safari-macos.md)).
So:

- Page hosts are focusable outside the tab order (`tabindex="-1"`). While
  the viewport or a page holds the focus, a current-page change moves focus
  to that page once React mounts it. Focus never scrolls the view.
- Internal destinations and named page actions move focus to their page. If
  the focused page unmounts, focus goes to the current page.
- A text-selection drag, and anything the reader focused meanwhile
  (a field inside the viewer, the application's controls), keeps the focus.
- Comment icons are named by their contents, author, or kind, and form
  tooltips sit on the control, names pdf.js leaves to its viewer's
  localization.

The current-page listener returns at once on other store updates; scrolling
still publishes no React state per frame.

## Evidence

`check:document`, `check:links`, and `check:text` cover focus following,
restoration after unmount, link activation, and the names.

`scroll-bench.ts` with `FOCUS=1` (the viewport focused while scrolling),
against the build before, three runs per cell
([`focus-follow-chromium.md`](../../examples/prototype/results/focus-follow-chromium.md),
[`-webkit`](../../examples/prototype/results/focus-follow-webkit.md),
[`-firefox`](../../examples/prototype/results/focus-follow-firefox.md)):
zero blank area and the same React commits in every job; the largest rise
in median blocked time was 14 ms over four seconds (Chromium, 1000 pages at
900 px/s, 27 → 41, with overlapping ranges). Accepted for keeping the
reader's place.

## Reopen if

Another screen reader (NVDA, VoiceOver on iOS: #32) or a document
interaction loses its place with this focus policy, or measurements show a
repeatable regression.
