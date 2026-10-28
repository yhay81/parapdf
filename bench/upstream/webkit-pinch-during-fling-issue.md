# Safari on iPadOS drops a pinch that starts during a fling

Issue #15, reduced to a page without ParaPDF. In Safari in the iPadOS
simulator, a two-finger pinch that starts while a scroll container still
scrolls from a fling reaches the page as nothing: no
`pointerdown`, `touchstart`, or `gesturestart`. The next pinch, once
nothing scrolls, arrives as usual. ParaPDF sees the same, since it never
hears the first pinch. Not yet tried on a real iPad; no report has been
filed.

## Reproduction

`bench/upstream/pinch-during-fling.html`: a scroll container of 40 tall
blocks (`touch-action: pan-x pan-y`, as ParaPDF's viewport) under a log of
the events it hears, with the time since the last `scroll` event. Served
from the Mac at 127.0.0.1 and opened in Safari in the simulator; touches
from the simulator's touch injection (Claude Code's iOS simulator control:
a one-finger path of 560 points in 48 ms for the fling, then a two-finger
pinch from 100 to 300 points apart in 150 ms, about a second later).

2026-10-28, iPad Air 11-inch (M4) simulator, iPadOS 27.0, Xcode's
simulator runtime 27.0:

| Pinch | Started | Events the page heard |
| --- | --- | --- |
| Alone | nothing scrolling | `pointerdown` ×2, `touchstart` (2 touches), `gesturestart`, `gesturechange`, `touchmove`, `gestureend`, `touchend` |
| After a slow drag | 1128 ms after the last `scroll` | the same |
| During a fling (two tries) | while `scroll` events still came (`scrollTop` 770 → 2995, then 3175 → 5333) | none |
| Right after that | 709 ms after the last `scroll` | the same as alone |

The trace of the second try, oldest first (ms since the page loaded):

```
50394 pointerdown, touchstart touches=1         (the fling)
50424 pointercancel                              (Safari takes it as a scroll)
50594 touchend touches=0
50728 … 51485 scroll ×35, scrollTop 4128 → 5333  (momentum; the pinch was sent here)
51986 pointerdown ×2, touchstart touches=2 sinceScroll=709  (the second pinch)
52040 gesturestart scale=1.40 … 52309 gestureend scale=3.00
52310 touchend touches=0
```

## What it means for ParaPDF

Nothing ParaPDF listens for arrives, so ParaPDF cannot zoom on that pinch;
listening on the document or the window instead would not help either, as
the page hears nothing. The limitation stays documented ("In Safari on
iPadOS, a pinch that starts while a fling still scrolls does not reach the
page; the next pinch zooms"). What #15 still needs: the same page on a real
iPad, which decides whether this is Safari's or the simulator's, and then a
report to WebKit with this page if it is Safari's.

## Draft report for WebKit (not filed)

> **iPadOS Safari: a pinch that starts during a scroll container's
> momentum scroll fires no touch, pointer, or gesture events**
>
> Open the attached page, fling the lower container, and pinch while it is
> still scrolling. Expected: `touchstart` with two touches and
> `gesturestart`, as when the same pinch starts with nothing scrolling.
> Actual: the page receives no event for the whole
> pinch; the next pinch is delivered normally. Seen in the iPadOS 27.0
> simulator.
