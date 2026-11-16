# 0047. Atomic view updates, pre-paint state subscriptions, and React action hooks

- Status: adopted
- Date: 2026-11-16

## Decision

Finish the React-first action surface and publish complete synchronous view
transactions to React. A warm viewer must show its page, controls, and thumbnail
selection together before the first paint.

- `Store.batch()` coalesces nested synchronous updates, drops keys whose values
  return to their original values, and restores the original snapshot when no
  stored property changed. Optional properties introduced during a batch count
  as changes. `ViewerStore` also compares the final page sizes and external-link
  setting. Opening, rotation, spread, scroll mode, scale, compound navigation,
  and gesture zoom commits publish one complete view transaction.
- `useStoreKeys()` and `useStoreSlice()` briefly subscribe during layout effects
  until `useSyncExternalStore` installs its passive subscription. This covers
  warm initial mounts and Activity reconnects without a second steady-state
  listener, and retains server snapshots for hydration.
- `useSave()` and `usePrint()` own the public save, download, and print actions.
  Remove the standalone action exports. Replace `permits()` with reactive
  `usePermits(what, viewer?)` / `usePermits(viewer?)`, backed by a viewer slot
  whose store follows document readiness and permission enforcement.
- Share non-suspending thumbnail labels in one lazy viewer slot. `PdfView` uses
  `LazyViewerHolder`, and its implementation joins the other viewer hooks in
  `react/viewer.ts`. Memoize the opening rules and avoid single-listener copies
  in extension, overlay, and view-state notifications. A default controller
  starts directly from the default store snapshot rather than reapplying it in
  a constructor.

This extends decisions 0041–0046. It does not change the drawing planner,
canvas budgets, or ownership of a document. Runtime modules still import no
feature or React code, and no per-frame gesture or scroll state enters React.

## Evidence

The release review found that a batch adding a previously absent optional
property discarded its value: `Store({}).batch(() => set({ error: "failed" }))`
restored the empty snapshot. Compare keys present in either snapshot before
restoring it. The regression test also covers adding and reverting that field.

The 1,073 Node tests in 120 suites pass, including nested batches, reverted
keys, derived sizes and links, atomic warm opens and view changes, reactive
permissions, lazy viewer scopes, and thumbnail label lifetimes:

- [`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts)
- [`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts)
- [`permissions.test.ts`](../../packages/parapdf/test/permissions.test.ts)
- [`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts)

`pnpm check`, the full `pnpm typecheck`, `pnpm test`, package contents and
consumer type checks (`check:package`), and feature tree-shaking
(`check:modules`) pass. All thirteen prototype check commands pass with
`ENGINE=pdfjs` in Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0 on
macOS (39 command runs), including webpack, Rsbuild, Next.js Turbopack, and
Next.js webpack in development and production with modern and legacy pdf.js.
The initial bundler attempts could not bind port 4185 because another local
benchmark owned it; all three passed when rerun with `BUNDLER_PORT=4188`.
`check:bundlers` now accepts a port within the existing 4179–4189 test range.

`check:lifecycle` checks a preloaded document's toolbar, current thumbnail, and
page hosts synchronously after mounting. `check:document` checks the reactive
Print button while permission enforcement is toggled. The site build,
`check:demo` and `check:showcases` in all three browsers, and all four local
launcher checks pass. The production dependency audit reports zero known
vulnerabilities.

### Paired measurements

The comparison build is `712f15e1173851fe55e83d817b2ff98ad05d75ae`, whose
runtime is decision 0046. It was archived into a separate directory, installed
from the frozen lockfile, and built separately from the candidate. Both builds
use pdfjs-dist 6.5.438 and React 19.3.1. Runs alternate the two builds within
each job, on AC power with other Playwright browsers excluded and a maximum
one-minute load average of 10. Playwright's headless WebKit is not Safari.

`scroll-bench.ts`: 1280×900, devicePixelRatio 2, fit-width, GPU-backed canvases,
4,000 ms at 900 and 3,600 CSS px/s through `synthetic-text-1000.pdf` and
`bill-hr815.pdf`, five runs per build and job:

- [Chromium](../../examples/prototype/results/scroll-atomic-stores-chromium.md)
- [WebKit](../../examples/prototype/results/scroll-atomic-stores-webkit.md)
- [Firefox](../../examples/prototype/results/scroll-atomic-stores-firefox.md)

`commit-bench.ts`: 820×1000, devicePixelRatio 2, `bill-hr815.pdf`, all eleven
zoom scenarios, three runs per build and scenario. A pixel-reading pass checks
blank pages and loss of detail; a separate pass measures time to sharp and
canvas memory:

- [Chromium](../../examples/prototype/results/commit-atomic-stores-chromium.md)
- [WebKit](../../examples/prototype/results/commit-atomic-stores-webkit.md)
- [Firefox](../../examples/prototype/results/commit-atomic-stores-firefox.md)

The following medians are before → candidate. The four-second scroll jobs
show both increases and decreases in blocked time; these runs do not establish
a general speedup. First paint is quantized by animation frames (decision 0032).

| Browser | Document / CSS px/s | First paint (ms) | Blocked time (ms) | Longest timer lag (ms) |
|---|---|---:|---:|---:|
| Chromium | 1,000-page text / 900 | 195.5 → 197.8 | 8.2 → 10.1 | 7.1 → 7.9 |
| Chromium | 1,000-page text / 3,600 | 180.4 → 177.1 | 39.8 → 21.2 | 9.8 → 9.1 |
| Chromium | bill-hr815 / 900 | 138.7 → 158.9 | 12.8 → 11.7 | 8.4 → 8.3 |
| Chromium | bill-hr815 / 3,600 | 174.6 → 155.7 | 23.8 → 35.4 | 9.6 → 11.1 |
| WebKit | 1,000-page text / 900 | 209.9 → 208.8 | 26.7 → 19.4 | 8.7 → 8.9 |
| WebKit | 1,000-page text / 3,600 | 207.6 → 196.0 | 15.4 → 13.4 | 9.4 → 8.5 |
| WebKit | bill-hr815 / 900 | 179.2 → 193.3 | 49.2 → 44.4 | 15.4 → 14.1 |
| WebKit | bill-hr815 / 3,600 | 168.5 → 180.8 | 35.8 → 30.7 | 10.6 → 9.8 |
| Firefox | 1,000-page text / 900 | 280.4 → 292.8 | 64.6 → 32.0 | 20.4 → 14.8 |
| Firefox | 1,000-page text / 3,600 | 294.2 → 280.6 | 79.6 → 87.0 | 12.8 → 13.5 |
| Firefox | bill-hr815 / 900 | 234.0 → 226.0 | 49.4 → 59.2 | 12.3 → 14.6 |
| Firefox | bill-hr815 / 3,600 | 231.1 → 222.6 | 76.6 → 70.3 | 17.1 → 13.5 |

Every scroll job in both builds has a median blank-page area and blank-frame
share of zero. Canvas memory is identical for every paired job: 155.9 and
111.1 MiB for the 1,000-page PDF, and 183.0 and 126.5 MiB for bill-hr815 at
900 and 3,600 px/s. React commits are 4 and 25 for the former, and 4 and 21
for the latter; store updates are 4/24 and 4/20 in both builds. Dropped-frame
medians match too: all zero in Chromium and Firefox, and 0/1/2/1 in WebKit.

All 198 zoom fidelity runs (11 scenarios × 3 runs × 2 builds × 3 browsers)
contain zero blank frames and zero frames dropping a previously detailed page
to its base. All 198 timing runs finish sharp without an error. Base renders,
detail renders, and cancellations have identical paired medians in every
scenario. Time-to-sharp differences nevertheless go in both directions:

| Browser | Largest decrease (ms) | Largest increase (ms) |
|---|---:|---:|
| Chromium | -9.8 (`scale-down`) | +4.8 (`scale-up`) |
| WebKit | -3.7 (`zoom-step`) | +6.9 (`zoom-in-far`) |
| Firefox | -16.9 (`ctrl-wheel`) | +43.2 (`zoom-in-far`) |

Chromium and WebKit keep identical peak canvas-memory medians in all eleven
zoom scenarios. Firefox varies with overlapping canvas lifetimes: `scale-up`
251.1 → 236.6 MiB, `zoom-in-far` 110.5 → 118.5 MiB, `zoom-in-whole`
193.1 → 196.0 MiB, and `ctrl-wheel` 226.1 → 211.5 MiB; the other seven
are unchanged. For `zoom-in-whole`, both builds have the same individual-run
range, 193.1–196.0 MiB. The initial Firefox `zoom-in-far` sharp times are
94.4/137.2/97.5 ms before and 140.6/97.4/282.6 ms after; this warrants a
focused repeat instead of treating a three-run median as a stable regression.

The turn-taking guard repeated one Chromium scroll job and one WebKit zoom
job after another browser overlapped them. Firefox zoom jobs paused for
645 seconds when the machine became busy; the focused repeats below examine
the first-paint differences and the largest zoom-time increase.

### Focused first-paint repeats

The same bill-hr815 job at 900 px/s was repeated fifteen times per build,
still with four seconds of scrolling and `MAX_LOAD=10`:

| Browser | First paint before → candidate (ms) | Individual-run ranges before / candidate (ms) | Blocked time before → candidate (ms) |
|---|---:|---:|---:|
| [Chromium](../../examples/prototype/results/scroll-atomic-stores-first-paint-chromium.md) | 228.5 → 255.3 | 174.6–368.9 / 160.3–310.3 | 8.7 → 10.0 |
| [WebKit](../../examples/prototype/results/scroll-atomic-stores-first-paint-webkit.md) | 251.1 → 254.0 | 200.0–329.5 / 193.4–322.6 | 12.6 → 13.1 |

Both builds retain zero median blank area, blank-frame share, and dropped
frames, four React commits, and 183.0 MiB of canvases in both browsers.
The WebKit first-paint difference shrinks from 14.1 to 2.9 ms; Chromium's
candidate median remains longer. Individual paints span many frames, with
overlapping ranges. The machine's load averages are 8.7 → 6.9 for Chromium
and 6.8 → 10.2 for WebKit, including 33 and 98 seconds of waiting.
Do not infer a startup speedup from these runs. The following checks reverse
the build order and repeat Firefox's largest zoom-time increase under lower load.

The [reversed-order Chromium check](../../examples/prototype/results/scroll-atomic-stores-first-paint-reversed-chromium.md)
uses thirty runs per build, `MAX_LOAD=8`, and 200 ms of scrolling to focus on
first paint (the method used in decision 0032). `DIST` is the old build and
`BEFORE` is the candidate, so this report's plain `pdfjs-hwa` row is the old
build and its `pdfjs-hwa, before` row is the candidate, second in each pair.
First paint is 157.2 → 156.9 ms. The observed frame bands below 150 ms,
150–167 ms, and 167–184 ms contain 9/20/1 old-build runs and 10/19/1
candidate runs. The one-minute load average falls from 6.9 to 4.0, with no
waiting or overlapped jobs. The earlier longer candidate medians do not
persist in this paired run; these samples do not establish a startup timing
regression. Its shorter scroll totals are not compared with the four-second
jobs above.

The [focused Firefox zoom check](../../examples/prototype/results/commit-atomic-stores-firefox-repeat.md)
runs `zoom-in-far` seven times per build with `MAX_LOAD=8`. It waits 1,374
seconds for other browsers and load to settle; the initial load average of
14.7 is recorded before that wait, and the final average is 6.9. Every run
finishes sharp, with zero blank frames or frames down to the base. Median
time to sharp is 112.2 → 115.0 ms, with individual ranges 95.1–136.9 ms
before and 90.1–132.8 ms after. Both medians render five bases and one
detail, cancel nothing, and peak at 110.5 MiB; both individual-run memory
ranges are 110.5–118.5 MiB. The initial 43.2 ms increase and higher median
peak memory are not reproduced.

Adopt the complete pre-paint state updates and the simpler React action
surface for their verified behavior. The measured rendering work and canvas
budgets are preserved; the timing results above include the losses and do not
establish a general speed improvement.

## Reopen if

- Warm controls or thumbnails require another visible paint to catch up, or
  Activity/StrictMode replay leaves duplicate subscriptions.
- A complete view transaction causes consumers to miss a required state change.
- Paired measurements show a repeatable regression in rendering fidelity,
  scrolling, zoom completion, or retained canvas memory.
