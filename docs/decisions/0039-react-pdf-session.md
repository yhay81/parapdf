# 0039. Narrow React-only PdfSession interface and drop duplicate promise readers

- Status: adopted
- Date: 2026-11-14

## Decision

`PdfSession` (`packages/parapdf/src/document/pdf-session.ts`) was previously a
concrete class exported directly as `type PdfSession`. Its public surface
duplicated all seven Suspense data hooks (`useOutline()`, `usePageLabels()`,
`useMetadata()`, `useAttachments()`, `useComments()`, `useLayers()`, and
`useInitialView()`) with promise methods (`outline()`, `pageLabels()`,
`metadata()`, `attachments()`, `comments()`, `layers()`, and `initialView()`),
leaked internal `LayerState | null` through `layers()`, exposed
`session.state: ReadableStore<DocumentState>` instead of a synchronous
`DocumentState` snapshot matching `viewer.state` (decision 0038), and carried
ten `static {}` friend-function trampolines solely to hide React lifecycle
operations from the class's public type.

`docs/architecture.md`, "document/" and "react/", splits the public handle from
the internal controller:

- `PdfSession` (`src/document/pdf-session.ts`) is now a narrow TypeScript
  `interface` exported with `export type { PdfSession }`, exposing only
  `readonly source: PdfSource`, `readonly state: DocumentState` (a synchronous
  snapshot for event handlers and callbacks, while reactive updates go through
  `useDocumentState()`), `readonly proxy: PDFDocumentProxy | null`,
  `readonly signal: AbortSignal`, and `submitPassword(password: string | null): void`.
  The seven duplicate promise methods (`outline()`, `pageLabels()`, `metadata()`,
  `attachments()`, `comments()`, `layers()`, `initialView()`) are removed from
  the public surface; `src/react/data.ts` and `src/react/thumbnails.ts` read
  through the internal controller directly.
- Internal `PdfSessionController` implements `PdfSession`, registers instances
  in a module-private `WeakSet`, and exposes `sessionControllerOf(session)` plus
  direct methods and getters (`stateStore`, `start()`, `connect()`,
  `document()`, `openDocument()`, `reads`, `read()`, `setPasswordPrompt()`,
  `setOpenAttachment()`, `openAttachmentHandler`, `fragment`, `setFragment()`),
  eliminating all ten `static {}` friend trampolines. `SessionContext` carries
  `PdfSessionController`, while standalone document functions (`save`,
  `download`, `getAttachmentContent`, `openAttachment`, `setLayerVisible`,
  `getFormFields`, `setFormValues`, `getText`) and `useOptionalSession` resolve
  `sessionControllerOf(session)`.

## Evidence

[`pdf-session.test.ts`](../../packages/parapdf/test/pdf-session.test.ts),
[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts), and
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts)
cover synchronous `session.state` snapshots, `sessionControllerOf()` brand
validation, `stateStore` subscriptions, and Suspense data read caching/retry via
`PdfSessionController.read()`.
[`check-package.ts`](../../packages/parapdf/scripts/check-package.ts) verifies
`@ts-expect-error` rejection of `session.stateStore`, `session.state.get`,
`session.state.subscribe`, `session.outline`, and `session.layers` against
packed declarations and confirms `"PdfSession"` is absent from runtime value
exports; the Playwright functional checks, `check:modules`, and the site checks
verify behavior across Chromium, WebKit, and Firefox.

## Reopen if

- An embedding React application needs a capability currently restricted to
  `PdfSessionController` that cannot be expressed cleanly through `<PdfDocument>`
  props, React hooks, or standalone document action functions.

