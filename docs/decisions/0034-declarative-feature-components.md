# 0034. Declarative feature components and synchronous annotation controls

- Status: adopted
- Date: 2026-11-13

## Decision

`<PdfViewer>` previously turned optional capabilities on through boolean props
(`forms`, `formScripts`, `annotationEditing`, `annotationLabels`, `autoLinks`,
and `enforcePermissions`) backed by dynamic `import()` calls in
`src/react/features.ts`, while `Viewer.defer()` held back initial layout until
every requested feature chunk resolved. That arrangement forced bundlers to emit
code-split chunks for every optional feature even in applications that never
passed the boolean prop, injected annotation editor CSS asynchronously after
mount, and made `useAnnotations()` return `AnnotationControls | null` until the
editor chunk arrived.

`docs/architecture.md`, "React", replaces boolean feature props and internal
dynamic imports with declarative feature components:

- `<PdfForms viewer? scripts? onChange? />`, `<PdfAnnotationEditor viewer? labels? tool? defaultTool? onToolChange? />`,
  `<PdfAutoLinks viewer? />`, and `<PdfPermissions viewer? />` attach their
  feature to the context `Viewer` (or an explicit `viewer` prop) in a layout
  effect. `<PdfViewer>` accepts `children?: ReactNode` inside its viewport
  container and removes `forms`, `formScripts`, `annotationEditing`,
  `annotationLabels`, `autoLinks`, and `enforcePermissions`.
- Because `packages/parapdf` declares `"sideEffects": false` and nothing in
  `<PdfViewer>` references unused feature modules, bundlers eliminate unimported
  features completely rather than emitting unused dynamic chunks. Applications
  that want on-demand feature loading wrap the feature component in standard
  `React.lazy()` and `<Suspense>`.
- `Viewer.defer()` and the `defer` / `loaded` extension hooks are removed;
  layout runs synchronously once the viewport attaches and pages open, and a
  lazy feature component triggers a normal layout pass when it mounts.
- `<PdfAnnotationEditor>` hoists `<style href="parapdf-editor" precedence="parapdf">`
  synchronously from its first render (including SSR), accepts controlled `tool`,
  `defaultTool`, and `onToolChange`, and detaches immediately when unmounted
  while `<PdfViewer>` stays attached (while keeping snapshots across
  `<StrictMode>` remounts and `<Activity>` hides).
- `useAnnotations(viewer?)` returns a non-nullable, getter-tracked (or
  `shallowEqual`-selected) `AnnotationControls` synchronously in any render
  order, including toolbars mounted above `<PdfViewer>`.
- The document permissions data interface is named `DocumentPermissions`
  (matching `DocumentState` and `DocumentText`) so `PdfPermissions` names the
  component without collision.

## Evidence

[`react-features.test.ts`](../../packages/parapdf/test/react-features.test.ts)
covers synchronous non-nullable `useAnnotations()` mounted before
`<PdfAnnotationEditor>`, controlled `tool` / `defaultTool` / `onToolChange`
synchronization, live unmount detachment versus `<Activity>` snapshot
preservation, `<PdfForms onChange />`, `<PdfAutoLinks />`, `<PdfPermissions />`,
and SSR `<style precedence="parapdf">` hoisting. [`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts)
builds `minimal.html` standalone and verifies that zero chunks for `search`,
`forms`, `annotations`, `print`, or `autoLinks` are emitted on disk. Every
functional check, `check:package`, `check:modules`, and the site's `check:demo`
pass with `ENGINE=pdfjs` in Playwright's Chromium 158.0.8127.18, WebKit 27.2,
and Firefox 159.0, and `check:bundlers` passes across webpack, Rsbuild, and
Next.js (Turbopack and webpack) in Chromium.

`scroll-bench.ts` measured the demo built from this branch against
`viewer-context-and-state` (`f8f2dec`) in turn, job by job: 1280×900 at
`devicePixelRatio` 2, fit-width, four seconds of scrolling at 900 and 3600 CSS
pixels per second through `synthetic-text-1000.pdf` and `bill-hr815.pdf`, median
of five runs
([`scroll-declarative-features-chromium.md`](../../examples/prototype/results/scroll-declarative-features-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-declarative-features-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-declarative-features-firefox.md)),
plus a five-run Chromium check with `QUERY='forms=1&annotations=1&autoLinks=1'`
on `bill-hr815.pdf`
([`scroll-declarative-features-loaded-chromium.md`](../../examples/prototype/results/scroll-declarative-features-loaded-chromium.md)).
In every browser and job, both builds have 0.0% blank area, commit React the
same number of times (4 at 900 px/s, 24 and 20 at 3600 px/s), publish the same
store updates, and hold the same canvas memory (156, 111, 183, and 127 MiB, and
183 and 14 MiB with lazy features enabled). Main thread blocked while scrolling,
in ms, after and before:

| Job | Chromium | WebKit | Firefox | Chromium (features) |
|---|---:|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 2, 4 | 10, 5 | 12, 8 | — |
| synthetic-text-1000.pdf, 3600 px/s | 4, 5 | 14, 22 | 22, 25 | — |
| bill-hr815.pdf, 900 px/s | 8, 9 | 31, 55 | 18, 16 | 5, 6 |
| bill-hr815.pdf, 3600 px/s | 5, 4 | 30, 53 | 16, 12 | 2, 3 |

Chromium and Firefox drop 0 frames in every job; WebKit drops 0 and 0, 1 and 1,
2 and 2, and 2 and 1 of 289. First paint with `forms`, `annotations`, and
`autoLinks` enabled in Chromium is 140 vs 139 ms at 900 px/s and 137 vs 142 ms
at 3600 px/s. No timing difference beyond run-to-run variation is claimed.

## Reopen if

- Mounting a feature lazily with `React.lazy()` after the first paint produces a
  visible layout shift on pages whose geometry depends on that feature.
- A bundler used by applications fails to tree-shake unimported feature
  components from `parapdf`.
