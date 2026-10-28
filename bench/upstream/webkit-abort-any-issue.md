# WebKit loses unreferenced `AbortSignal.any()` signals

Issue #1, reduced to a standalone case. In WebKit, a signal that
`AbortSignal.any()` returned and that nothing references can be collected
while its sources can still abort; listeners added with it then stay after
the sources abort. Filed as WebKit bug 329251
(https://bugs.webkit.org/show_bug.cgi?id=329251), 2026-10-28, with the
report at the end and `abort-any-gc.html` attached. No existing report on bugs.webkit.org covers it (searched
2026-10-28: summaries with "AbortSignal", "abort signal", or
"AbortController"; bug 298499 is the nearest).

## Reproduction

Two cases, both on a page of their own:

- `bench/upstream/abort-any-gc.html`, the test case for WebKit: six
  rounds; each adds 500 window listeners with
  `AbortSignal.any([root.signal, controller.signal])`, one controller per
  listener, and 500 more whose returned signals it also keeps in an array,
  waits three seconds of 10 ms timers, aborts every controller, dispatches
  one event of each type, and prints how many listeners still ran.
  Query parameters `rounds`, `ticks` (10 ms timers per round), and `alloc`
  (objects allocated per timer) change it.
- `bench/scripts/abort-any-repro.ts` (`BROWSER=webkit node …`), the
  variants on about:blank: per row, 500 controllers, a signal per
  controller, a `pointerdown` listener on the window added with it, three
  seconds of timers, then the controllers (or the shared root) aborted and
  one `pointerdown` dispatched.

`abort-any-gc.html`, 2026-10-28, macOS 27.0.1, listeners that still ran
of 500 per round:

| Browser | Signals unreferenced | Signals kept |
|---|---|---|
| Playwright WebKit 27.2, two launches | 500, 0, 500, 0, 0, 0 (both) | 0 in every round, all report `aborted` |
| Safari 27.0.1 (22625.1.29.11.28) | 500, 500, 0, 0, 0, 0; 500, 500, 500, 0, 0, 0 | 0 in every round, all report `aborted` |
| Chromium 156 | 0 in every round | 0 |
| Firefox 157 | 0 in every round | 0 |

`abort-any-repro.ts`, listeners that still ran of 500:

| Signal the listener was added with | WebKit 27.2 | Safari 27.0.1 | Chromium 156 | Firefox 157 |
|---|---|---|---:|---:|
| the controller's own `signal` | 0, 0, 0, 0 | 0, 0, 0, 0 | 0 | 0 |
| `AbortSignal.any([signal])` | 500, 0, 0, 0 | 0, 0, 0, 0 | 0 | 0 |
| `AbortSignal.any([root, signal])` | 500, 500, 500, 500 | 0, 0, 0, 0 | 0 | 0 |
| the same, the root aborted instead | 0, 0, 0, 0 | 500, 0, 0, 0 | 0 | 0 |
| the same, each returned signal kept | 0, 0, 0, 0 | 0, 0, 0, 0 | 0 | 0 |

Safari through `bench/scripts/safari.ts` (`BROWSER=safari`). The first two
runs in each column are from earlier on 2026-10-28, the rest from later
that day on main at 8f2ffb7. The script shows it less often than the page,
in Safari in one run of four. WebKit runs between those Safari runs gave
500 for both `AbortSignal.any()` rows and 500, then 0, for the root
aborted.

- It needs a collection between adding the listener and aborting, and
  whether one comes is up to the engine: no listener runs when the
  controllers are aborted right away, or after 20 timers instead of 300,
  and a round or a run often shows nothing. Repeating rounds, as the HTML
  page does, makes it show up.
- Whichever source aborts, the root or the listener's own controller, the
  listener can stay. Keeping the returned signal referenced prevents it:
  across every round and run above, kept signals all aborted and their
  listeners were all removed.
- Once, in an earlier form of the HTML page that ran the unreferenced and
  kept cases one after the other rather than together, the kept case left
  500 listeners, without recording whether its signals reported `aborted`.
  It did not happen again in twelve rounds of the page as it is.
- `AbortSignal.any([root, signal])` is what pdf.js's
  `AnnotationEditorUIManager.combinedSignal()` returns; its drawing editors
  add window listeners with it and abort the controller when a drawing
  ends. That is how ParaPDF met it: every press after a drawing threw in a
  listener of a drawing already finished.

## Cause

From WebKit's source (main, 2026-10-28):

- `EventTarget::addEventListener()` handles the `signal` option by adding
  an abort algorithm to the signal (`signal->addAlgorithm(…)`, which
  removes the listener); it adds no `abort` event listener.
- `JSAbortSignalOwner::isReachableFromOpaqueRoots()`
  (`Source/WebCore/bindings/js/JSAbortSignalCustom.cpp`) keeps a
  non-aborted dependent signal alive only when it has an `abort` event
  listener and source signals; otherwise only when something references
  it. Abort algorithms are not considered.
- A source holds its dependents weakly (`m_dependentSignals` is a
  `WeakListHashSet`), so once the dependent signal is gone, aborting the
  source no longer reaches it, and the algorithm that would remove the
  listener never runs.

The DOM specification (§3.2.1, "Garbage collection"): "A non-aborted
dependent AbortSignal object must not be garbage collected while its source
signals is non-empty and it has registered event listeners for its abort
event or its abort algorithms is non-empty." WebKit implements the first
half. WebKit bug 298499 (fixed in 299758@main, September 2025) reworked
this function so that signals with event listeners can be collected. pdf.js
PR 21638 (closed, July 2026) reported listeners bound with a locally held
`AbortSignal.any()` composite misbehaving after a collection in iOS
Safari.

## What ParaPDF does

`src/pdfjs/editor.ts` replaces the manager's `combinedSignal` with one that
keeps each combined signal until it aborts, which the "signals kept" row
shows is enough; `check:annotations` in WebKit fails without it. Remove the
workaround once a WebKit release no longer reproduces: open
`abort-any-gc.html` in it, or rerun the script with `BROWSER=webkit`, and
see 0 listeners in every line, then run `check:annotations` in WebKit
without the workaround, or follow bug 329251.

## Report for WebKit (filed as bug 329251)

Product WebKit, component DOM, version Safari 27, hardware Mac, macOS
27.0.1. Attachment: `bench/upstream/abort-any-gc.html`.

**Summary**

AbortSignal.any(): an unreferenced dependent signal is collected while its
sources can still abort, so listeners added with it are never removed

**Description**

A signal returned by `AbortSignal.any()` and passed as the `signal` option
of `addEventListener()`, with no other reference to it, can be garbage
collected while its sources are not aborted. When a source aborts after
that, the listener is not removed.

```js
const root = new AbortController();
const controller = new AbortController();
window.addEventListener("x", () => console.log("still called"), {
  signal: AbortSignal.any([root.signal, controller.signal]),
});
// … a garbage collection …
controller.abort();
window.dispatchEvent(new Event("x")); // logs "still called"
```

Steps to reproduce:

1. Open the attached `abort-any-gc.html` and wait about 20 seconds.
   It runs six rounds. Each round adds 500 window listeners as above (one
   controller each, a shared root), and 500 more whose returned signals it
   also keeps in an array; waits three seconds of 10 ms timers so that the
   engine collects; aborts every controller; dispatches one event of each
   type; and prints how many listeners still ran.

Expected: 0 listeners run in every round. Per the DOM specification
(§3.2.1), "A non-aborted dependent AbortSignal object must not be garbage
collected while its source signals is non-empty and it has registered
event listeners for its abort event or its abort algorithms is non-empty";
the `signal` option adds an abort algorithm that removes the listener.

Actual: in some rounds all 500 listeners with unreferenced signals still
run. The listeners whose signals are kept never do, and those signals all
report `aborted`.

- Safari 27.0.1 (22625.1.29.11.28), macOS 27.0.1: 500 in rounds 1 and 2
  of 6 in one run, rounds 1 to 3 in another.
- Playwright's WebKit 27.2 on macOS 27.0.1: 500 in rounds 1 and 3 of 6,
  in two launches.
- Chromium 156 and Firefox 157: 0 in every round.

Which rounds are affected depends on when the engine collects; if no
round shows it, reload. The same happens when the root aborts instead of
the listener's own controller, and with `AbortSignal.any([signal])`.

Likely cause: `JSAbortSignalOwner::isReachableFromOpaqueRoots()` keeps a
non-aborted dependent signal with source signals alive only if
`hasAbortEventListener()`; it does not consider abort algorithms, which is
what `EventTarget::addEventListener()` adds for the `signal` option. Since
sources hold dependent signals weakly, aborting a source afterwards no
longer reaches the collected signal, and the listener stays. Keeping the
dependent signal alive while it has abort algorithms, as it is for abort
event listeners, would match the specification. This function was last
reworked in bug 298499 (299758@main).

Impact: pdf.js's annotation editor (`AnnotationEditorUIManager
.combinedSignal()`) adds window listeners this way for the duration of a
drawing and aborts their controller when the drawing ends; in Safari those
listeners can keep firing for drawings already finished and throw
(`null is not an object (evaluating 'e.#n.isCancellable')`).
