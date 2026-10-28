# WebKit loses unreferenced `AbortSignal.any()` signals

Issue #1, reduced to a standalone case. In Playwright's WebKit, aborting
the source of a signal that `AbortSignal.any()` returned, after the engine
has collected garbage, no longer aborts that signal when nothing else
references it, so listeners added with it stay. The draft report for
WebKit is at the end; it has not been filed.

## Reproduction

`bench/scripts/abort-any-repro.ts` on about:blank: per case, 500
controllers, a signal per controller, a `pointerdown` listener on the
window added with that signal, three seconds of 10 ms timers, then the
controllers (or the shared root controller) are aborted and one
`pointerdown` is dispatched. Listeners that still ran, of 500, 2026-10-28,
macOS, two runs in WebKit:

| Signal the listener was added with | WebKit 27.2 | Chromium 156 | Firefox 157 |
|---|---|---:|---:|
| the controller's own `signal` | 0, 0 | 0 | 0 |
| `AbortSignal.any([signal])` | 500, 0 | 0 | 0 |
| `AbortSignal.any([root, signal])` | 500, 500 | 0 | 0 |
| the same, the root aborted instead | 0, 0 | 0 | 0 |
| the same, each returned signal kept in an array | 0, 0 (all 500 report `aborted`) | 0 | 0 |

- Safari 27.0.1 on macOS 27.0.1 (through `bench/scripts/safari.ts`,
  `BROWSER=safari`) reproduces it too, less often: of two runs, one gave
  500 of 500 for the root aborted and 0 elsewhere, the other 0 in every
  row. Two more WebKit runs in between gave 500 for both `AbortSignal.any()`
  rows, and 500, then 0, for the root aborted. So the workaround is needed
  in Safari, not only in Playwright's WebKit.
- It needs time for a collection: with the controllers aborted right away
  no listener runs, and with the same number of timers but 20 instead of
  300, none did. Allocating heavily between 20 timers has the same
  effect as more time.
- Keeping the returned signals referenced prevents it, and so does
  aborting the root, which is the other source.
- `AbortSignal.any([root, signal])` is what pdf.js's
  `AnnotationEditorUIManager.combinedSignal()` returns; its drawing editors
  add window listeners with it and abort the controller when a drawing
  ends. That is how ParaPDF met it: every press after a drawing threw in a
  listener of a drawing already finished.

The likely cause: WebKit keeps a dependent signal alive only while
something references it or it has `abort` listeners, while the
specification keeps it alive while any source can still abort it and it
has abort algorithms (an event listener's removal is one). WebKit bug
298499 (fixed in 299758@main, September 2025) made signals with event
listeners collectable; this may be its other side. pdf.js PR 21638
(closed, July 2026) reported listeners bound with a locally held
`AbortSignal.any()` composite misbehaving after a collection in iOS
Safari.

## What ParaPDF does

`src/pdfjs/editor.ts` replaces the manager's `combinedSignal` with one that
keeps each combined signal until it aborts, which the "signals kept" row
shows is enough; `check:annotations` in WebKit fails without it. Remove the
workaround once a WebKit release no longer reproduces: rerun the script
with `BROWSER=webkit` and see 0 listeners in every row, then run
`check:annotations` in WebKit without the workaround.

## Draft report for WebKit (not filed)

> **Listeners added with an unreferenced `AbortSignal.any()` signal are not
> removed when its source aborts after GC**
>
> ```html
> <script>
> const root = new AbortController();
> const controllers = [];
> let called = 0;
> for (let i = 0; i < 500; i++) {
>   const controller = new AbortController();
>   const signal = AbortSignal.any([root.signal, controller.signal]);
>   window.addEventListener("pointerdown", () => called++, { signal });
>   controllers.push(controller);
> }
> setTimeout(() => {
>   for (const controller of controllers) controller.abort();
>   window.dispatchEvent(new PointerEvent("pointerdown"));
>   document.body.textContent = `${called} of 500 listeners ran after abort`;
> }, 3000);
> </script>
> ```
>
> Expected: 0 of 500 (each listener's signal is aborted through its
> source). Actual, in WebKit (Playwright's WebKit 27.2 and Safari 27.0.1 on
> macOS): 500 of 500 in most WebKit runs and some Safari ones; 0 when the delay is short or when the signals returned
> by `AbortSignal.any()` are kept in an array. Chromium and Firefox give 0.
>
> The dependent signal seems to be collected while its sources can still
> abort it, although the listener registered with it depends on it. Per
> the DOM specification, a dependent signal must not be collected while
> any of its sources is unaborted and it has abort algorithms or `abort`
> listeners. pdf.js's annotation editors hit this through
> `combinedSignal()` (window listeners of finished drawings keep firing).
