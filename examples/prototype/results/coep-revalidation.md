# WebKit's worker refusals in the isolated demo

Issue #16. In the cross-origin-isolated demo, Playwright's WebKit refused
pdf.js's module worker on later visits, "Worker load was blocked by
Cross-Origin-Embedder-Policy", and pdf.js parsed on the main thread instead
(its fake worker). `check:lifecycle`, `check:viewers`, and `check:text`
reported or avoided it instead of failing.

## Cause

Vite's `server.headers` and `preview.headers` reach only the responses that
carry a body. Its preview server sends `Cache-Control: no-cache`, so a later
visit revalidates the worker script, and both servers answer that with a 304
that has no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`:

```
HTTP/1.1 200 OK                               HTTP/1.1 304 Not Modified
Cross-Origin-Opener-Policy: same-origin       Vary: Origin
Cross-Origin-Embedder-Policy: require-corp    Date: …
Cache-Control: no-cache
ETag: W/"2238397-1793116181990"
```

WebKit then refuses the worker it had cached. A 304's missing headers keep
the stored ones (RFC 9111, 4.3.4), and Chromium and Firefox load the same
worker, so WebKit's refusal looks like a WebKit defect; what ParaPDF owns is
the demo's server, which now sends the isolation headers with every response
(`bench/scripts/isolation.ts`, used by the demo's and the benchmark's Vite
configurations).

## Matrix

`bench/scripts/coep-revalidation-repro.ts` serves a demo build with its own
server and opens the demo seven times in a row: first visit, reload, another
file, another page then the demo, a new context, a new context with two
editing viewers, and their reload. Each cell lists the worker refusals the
seven visits logged. Chromium and Firefox ran both engines in the first two
rows and `pdfjs` in the others.

2026-10-27, macOS, Playwright's WebKit 27.2, Chromium, and Firefox;
pdfjs-dist 6.4.299 (`pdfjs`) and pdf.js master 157d30e83 (`pdfjs-next`,
whose renderer worker is a second module worker).

| Headers | WebKit `pdfjs` | WebKit `pdfjs-next` | Chromium | Firefox |
|---|---|---|---|---|
| isolated, revalidated, 304 without COOP/COEP (Vite before) | 0 3 3 3 0 0 0 | 0 6 0 6 0 0 6 | 0 everywhere | 0 everywhere |
| isolated, revalidated, 304 with COOP/COEP (Vite now) | 0 everywhere | 0 everywhere | 0 everywhere | 0 everywhere |
| isolated, no Cache-Control (no revalidation) | 0 everywhere | not run | 0 everywhere | 0 everywhere |
| not isolated, revalidated, bare 304 | 0 everywhere | not run | 0 everywhere | 0 everywhere |

- Refusals follow revalidations within a context: a new context fetches the
  worker afresh (200) and loads it. Whether the reload of the two-viewer
  page revalidates varied between runs (4 refusals in an earlier run), and
  so did the visit to another file with `pdfjs-next`.
- WebKit refuses whichever module worker it revalidated, the parsing
  worker and, with pdf.js master, the renderer worker; pdf.js falls back to
  its fake worker on the main thread, so documents still open, more slowly.
- Without isolation nothing is refused, and Chromium and Firefox refuse
  nothing in any case.

## Checks

The checks now count a refusal as an error. With the demo's previous Vite
configuration, `check:viewers` fails in WebKit ("Worker load was blocked by
Cross-Origin-Embedder-Policy" among the page's errors) and `check:lifecycle`
and `check:text` pass that run; with `crossOriginIsolation()`, all three pass
in WebKit, and `check:lifecycle` and `check:viewers` in Chromium and Firefox.

## Not covered

Real Safari is not tried (issue #13). For applications: a cross-origin
isolated page that serves pdf.js's worker from a server whose 304s drop
COEP would see the same fallback in WebKit; the remedy is the same, sending
the isolation headers on 304s.
