# 0032. Documents open in render, and viewers keep their view while hidden

- Status: adopted
- Date: 2026-11-13

## Decision

ParaPDF follows React's model of lifetimes, not its renderer: scrolling
and zooming stay outside React (decisions 0009 and 0011), and what opens,
holds, and lets go follows what React does to a tree. This changes the
lifetime contract of decisions 0009 and 0011, which opened a document in
the effect of a mounted provider and closed a viewer with its owner's
cleanup.

React gives a tree lifetimes that an effect cannot follow:

- A render may never mount. Under a Suspense boundary that waits, React
  mounts nothing below it and drops the state of what it rendered there. In
  a transition it keeps showing the tree before, and may abandon the render
  for another. A document that opens in an effect never opens there, so
  whatever waits for it waits forever.
- A cleanup does not say why it runs. React destroys effects alike when it
  hides a tree and keeps its state (`<Activity>`), when StrictMode runs
  them again, and when it unmounts, and says nothing more of a tree it
  removes while hidden.

So:

- `PdfDocument` starts its session as it renders, in the browser, and
  holds it in an effect.
- The registry opens a session the first time a render or a lease asks for
  it. Leases hold it, and it closes one second after the last goes, as
  before. A session no lease came to hold closes ten seconds after it came
  to rest, loaded or failed and with nothing being read; each render that
  asks for it gives it ten seconds more.
- What is read of a document (`outline()` and the like) is kept in the
  registry's entry, one promise for each thing read and for every
  `PdfSession` of the source, because the render after a suspended one has
  another `PdfSession` and must find the same promise. A read settles with
  its empty value while the document failed, closed, or waits for a
  password, and is read anew once the password is answered or the provider
  holds a document opened again.
- A viewer shows a session while the session's provider holds the document
  and the viewer's owner holds the viewer (`useViewer()`'s effect). When
  either lets go, the viewer lets go of the document and of what it drew,
  and keeps the session, its position and view state, and what its
  features keep for the reader: the history, a finished search, and
  annotation edits, which leave the document's storage. Extensions hear
  `closed(true)`. Held again, it shows the session where the reader left
  it, in the same pdf.js document or in another opened of the source.
  Opening another session forgets them (`closed(false)`).
- Nothing waits for a cleanup that may not come: a viewer that let go
  holds nothing outside itself, and goes with the component state that
  holds it.

## Evidence

`check:lifecycle` mounts three trees (`?lifetimes=`,
`examples/prototype/src/Lifetimes.tsx`, React 19.3.1) on a build of the
demo with main's runtime (`ce61e6e`) and on this one, in Playwright's
Chromium 158.0.8127.18:

| Tree | Before | After |
|---|---|---|
| A Suspense boundary above the provider, `useOutline()` below it | the fallback stays, and the document never opens | mounts once the outline is read, with one load |
| `source` changed in `startTransition()`, `useOutline()` in a boundary that already shows | the transition never commits | commits, and the document before it is destroyed |
| A transition abandoned for another | not reached | its document is destroyed: 4 loads, 3 destroyed |
| Provider and viewer in an `<Activity>`, hidden for 0.3 s | page, zoom, rotation, tool, search, and annotation are gone | all kept, with one load |
| The same, hidden for 2.5 s, which closes the document | `TypeError: Cannot read properties of null (reading 'sendWithPromise')` three times, and nothing shows | all kept, and the document opens again |

The last two fail before wherever `useViewer()` is called: inside what
hides, and outside it, which the documentation recommended. The build
before passes the check's 32 other assertions and fails 8. After, every
functional check passes with `ENGINE=pdfjs` in Playwright's Chromium
158.0.8127.18, WebKit 27.2, and Firefox 159.0, the hidden tree under
StrictMode too, and `check:bundlers` in Chromium.

A viewer React shows again draws its pages again. The check times it on
usrguide.pdf, on page 2 at 150% and turned a quarter: from React being
told to show the tree to the first frame in which every visible page has
pixels, and to the first in which they are sharp (the production build,
one run with `useViewer()` inside what hides and one with it outside):

| Browser | Hidden for 0.3 s, the document still open | Hidden for 2.5 s, the document opened again |
|---|---|---|
| Chromium | pixels and sharp after 30 and 29 ms | after 70 and 84 ms |
| WebKit | pixels after 61 and 65 ms, sharp after 297 and 302 ms | pixels after 81 and 90 ms, sharp after 316 and 309 ms |
| Firefox | pixels and sharp after 40 and 56 ms | after 106 and 124 ms |

Scrolling and zooming do not change. `scroll-bench.ts` measures the two
builds in turn, job by job: 1280×900 at devicePixelRatio 2, fit-width,
four seconds of scrolling at 900 and at 3600 CSS pixels per second through
synthetic-text-1000.pdf and bill-hr815.pdf, the median of five runs
(`examples/prototype/results/scroll-lifetimes-<browser>.md`). In every job
and browser both builds leave no blank area, commit React as often (4
times at 900 pixels per second, 24 and 20 times at 3600), and draw as many
pages, give or take one base. Main thread blocked while scrolling, in ms,
after and before:

| Job | Chromium | Chromium, again | WebKit | Firefox |
|---|---:|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 18, 18 | 17, 20 | 14, 15 | 50, 50 |
| synthetic-text-1000.pdf, 3600 px/s | 81, 62 | 66, 74 | 23, 22 | 102, 109 |
| bill-hr815.pdf, 900 px/s | 24, 19 | 20, 25 | 48, 47 | 64, 71 |
| bill-hr815.pdf, 3600 px/s | 58, 50 | 56, 56 | 37, 46 | 101, 90 |

The first Chromium run blocked the main thread longer after the change in
three jobs, while the one-minute load average rose from 3.2 to 8.5. Run
again with seven runs at a load of 2.6 to 1.7
(`scroll-lifetimes-chromium-rerun.md`), it blocked it longer in none.
Chromium and Firefox drop no frame of 241 in any job but one of the second
run (1 and 0); WebKit drops 0 and 0, 3 and 1, 2 and 2, and 2 and 2 of 289.
No difference beyond run-to-run variation is claimed either way.

`commit-bench.ts` in Chromium (bill-hr815.pdf, 820×1000 at
devicePixelRatio 2, three runs of eleven zoom commits,
`commit-lifetimes-chromium.md`): neither build shows a frame with a blank
page or a page down to its base, both render as much and hold as much
canvas memory, and their times to sharp are within 3 ms of each other.

The first page does not show sooner or later either. `scroll-bench.ts` with
200 ms of scrolling through bill-hr815.pdf
(`first-paint-lifetimes-<browser>.md`), the median first paint in ms, after
and before:

| Browser | Runs of each build | First paint |
|---|---:|---:|
| Chromium | 60 | 156, 157 |
| Chromium, the builds in the other order | 60 | 156, 157 |
| WebKit | 30 | 174, 176 |
| Firefox | 30 | 221, 220 |

In Chromium the first page shows on an animation frame, at about 140 ms, at
about 157 ms, or later: at about 140 ms in 23 and 28 of 60 runs after the
change, and in 24 and 23 before. A median of few runs therefore moves by a
whole frame when one or two of them change frames. The scroll runs above,
of five and seven, give 141 and 145, 158 and 143, 160 and 158, and 157 and
143 ms in Chromium's bill-hr815.pdf jobs, which says nothing of the builds;
`scroll-bench.ts` now lists every run's first paint.

Opening the document as the provider renders was not expected to show the
first page sooner. The provider already started loading pdf.js as it
rendered, and the document where ParaPDF preloads it (decision 0014), and a
session waits for pdf.js before it asks for the document. A one-off
recording of the messages between pdf.js and its worker in Chromium, thirty
runs of each build, has the document asked for 102 and 103 ms after the
navigation started and the first page's operator list back at 129 and
130 ms, with the same requests in the same order.

### What it costs

- A render React abandons loads its document to the end, however long that
  takes, and the document stays ten seconds more. The ten seconds are a
  choice, not a measurement: long enough for a render to mount after its
  document loaded, short for a worker's memory.
- A viewer React shows again draws its pages again (the table above), as
  one whose viewport alone detached always did.
- A tree first rendered hidden (`<Activity mode="hidden">`) loads its
  document once for nothing, and again when it is shown.
- A document hidden for more than a second closes. Shown again it loads
  again, the data hooks suspend meanwhile, and what the reader typed into
  form fields, which lives in pdf.js's document, is lost.
- A hidden viewer's annotation edits are out of the document, so other
  viewers neither save nor print them meanwhile. A viewport that only
  detaches leaves them in, as before.
- While a document waits for a password the data hooks give their empty
  value instead of suspending, and code that awaited a session's promise
  before the answer has to ask again.
- Opening a document is a side effect of a render. The registry makes it
  idempotent for a source, and the ten seconds undo it.

## Reopen if

- React tells a hidden tree from a removed one, or reports the removal of a
  hidden tree: a hidden provider could then keep its document.
- Measurements show that reopening a document after a hide costs readers
  more than keeping it would cost memory, or that abandoned renders hold
  documents long enough to matter.
