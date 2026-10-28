# Security policy

ParaPDF shows PDFs, which are untrusted input. Report anything a PDF can make
a page that embeds ParaPDF do that it should not: run script, reach another
origin, read the application's data, or take over its user interface.

## Supported versions

Only the latest release gets security fixes. Until 1.0, a fix ships in a new
release rather than as a backport to older ones.

| Version | Supported |
|---|---|
| The latest release | Yes |
| Earlier releases, including 0.4.x and older | No |

The scope is the `parapdf` package (`packages/parapdf/`). The benchmark
(`bench/`) and the demo (`examples/`) are not published.

## pdf.js

`parapdf` depends on one exact version of pdfjs-dist and ships that version's
worker in its own package, so an application cannot move to a newer pdf.js by
itself: pdf.js refuses a worker of another version. When pdf.js publishes a
security fix, a ParaPDF release moves to the fixed version, and its entry in
[`CHANGELOG.md`](CHANGELOG.md) says so.

ParaPDF runs the JavaScript a PDF holds only when the application asks for
it with `formScripts`, and then in pdf.js's scripting sandbox: QuickJS
compiled to WebAssembly, which the package ships, with no access to the
page beyond what pdf.js's sandbox passes it (field values, alerts, timers,
and requests to change page, zoom, print, or save, which ParaPDF carries
out). Without `formScripts`, the sandbox is never loaded and annotation
layers are built with scripting off. A script that escapes the sandbox, or
makes ParaPDF act beyond those requests, is a vulnerability to report here.

## Reporting a vulnerability

Report it privately through
[GitHub's form](https://github.com/yhay81/parapdf/security/advisories/new),
not in a public issue. Include the ParaPDF version, the browser, and a PDF or
code that shows the problem.

A problem in pdf.js itself also shows in
[pdf.js's own viewer](https://mozilla.github.io/pdf.js/web/viewer.html), and
pdf.js takes private reports
[on its repository](https://github.com/mozilla/pdf.js/security/advisories/new).
When you are not sure where it belongs, report it here.

The report stays private until a release fixes it. The advisory then
credits you, unless you would rather it did not.
