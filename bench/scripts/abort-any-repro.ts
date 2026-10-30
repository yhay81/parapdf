/**
 * Standalone reproduction of issue #1: WebKit loses a signal from
 * `AbortSignal.any()` that nothing references, so aborting its source no
 * longer aborts it, and listeners added with `{ signal }` stay. pdf.js's
 * `combinedSignal()` makes such signals; ParaPDF keeps them referenced
 * (`src/pdfjs/editor.ts`). Filed as https://bugs.webkit.org/show_bug.cgi?id=329251.
 *
 * On about:blank, each case makes 500 controllers and a signal per
 * controller, adds a `pointerdown` listener to the window with that signal,
 * lets a few seconds of timers pass (the engine collects in between), aborts
 * the controllers (or the shared root controller), dispatches one
 * `pointerdown`, and prints how many listeners still ran and how many
 * signals report `aborted` (counted only where the signals are kept).
 *
 * Usage: BROWSER=webkit node bench/scripts/abort-any-repro.ts
 */
import { launchBrowser } from "./browsers.ts";

const cases = [
  { name: "the controller's own signal", any: 0, abortRoot: false, keep: false },
  { name: "AbortSignal.any([signal])", any: 1, abortRoot: false, keep: false },
  { name: "AbortSignal.any([root, signal])", any: 2, abortRoot: false, keep: false },
  { name: "AbortSignal.any([root, signal]), root aborted", any: 2, abortRoot: true, keep: false },
  { name: "AbortSignal.any([root, signal]), signals kept", any: 2, abortRoot: false, keep: true },
] as const;

const launched = await launchBrowser();
const page = await launched.browser.newPage();
await page.goto("about:blank");
console.log(launched.label);
try {
  for (const test of cases) {
    const result = await page.evaluate(async ({ any, abortRoot, keep }) => {
      const count = 500;
      const root = new AbortController();
      const controllers: AbortController[] = [];
      const kept: AbortSignal[] = [];
      let called = 0;
      for (let i = 0; i < count; i++) {
        const controller = new AbortController();
        const signal =
          any === 0
            ? controller.signal
            : any === 1
              ? AbortSignal.any([controller.signal])
              : AbortSignal.any([root.signal, controller.signal]);
        window.addEventListener(
          "pointerdown",
          () => {
            called++;
          },
          { signal },
        );
        controllers.push(controller);
        if (keep) kept.push(signal);
      }
      for (let i = 0; i < 300; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      if (abortRoot) root.abort();
      else for (const controller of controllers) controller.abort();
      window.dispatchEvent(new PointerEvent("pointerdown"));
      return { called, count, aborted: keep ? kept.filter((s) => s.aborted).length : null };
    }, test);
    const aborted = result.aborted === null ? "" : `, ${result.aborted} report aborted`;
    console.log(`${test.name}: ${result.called} of ${result.count} listeners still ran${aborted}`);
  }
} finally {
  await launched.close();
}
