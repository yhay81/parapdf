# 0016. Form scripts start after the first paint

- Status: adopted
- Date: 2026-10-28

## Decision

`formScripts` runs a document's JavaScript in pdf.js's QuickJS sandbox.
Starting it reads every field, the calculation order, and the document's
actions from pdf.js's worker, and loads the sandbox (66 KB) and QuickJS
(475 KB). A viewer's form layers therefore start the scripts once the
document's pages first show pixels (`ViewerExtension.painted()`), not as the
document opens. A document without scripts loads none of it.

A script that changes how the first page looks (a field the Open script
fills or hides) takes effect a moment after the page shows; the scripts of a
viewer that never paints do not start.

## Evidence

`scroll-bench.ts` with `QUERY='forms=1&scripts=1'`, 5 runs, Chromium,
median first paint, as the document opens → after the first paint
([`form-scripts-deferred-chromium.md`](../../examples/prototype/results/form-scripts-deferred-chromium.md)):
f1040.pdf 228 → 214 ms (4 of 5 jobs faster); synthetic-scripts.pdf
139 → 126 ms, within the noise.

With scripts on against forms alone, f1040.pdf: Chromium 195 → 203 ms,
WebKit 225 → 229, Firefox 317 → 297, with blocked time unchanged
([`form-scripts-vs-main-chromium.md`](../../examples/prototype/results/form-scripts-vs-main-chromium.md),
[`-webkit`](../../examples/prototype/results/form-scripts-vs-main-webkit.md),
[`-firefox`](../../examples/prototype/results/form-scripts-vs-main-firefox.md)).

## Reopen if

A document's Open script needs to run before the first paint, or a pdf.js
release lets the sandbox start without reading every field first.
