import assert from "node:assert/strict";
import { it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { configurePdfjs, loadPdfjs } from "../src/pdfjs/loader.ts";

// pdf.js loads once per page, so the load with a worker of the
// application's own has a file, and a process, of its own.
it("shows the annotation icons the package ships with a worker of the application's own", async (context) => {
  // The shipped files' URLs resolve against the page's.
  const global = globalThis as { document?: unknown };
  global.document = { baseURI: "https://example.com/app/" };
  context.after(() => {
    delete global.document;
  });
  const module = {
    GlobalWorkerOptions: { workerSrc: "" },
    PDFWorker: class {},
  } as unknown as typeof Pdfjs;
  configurePdfjs({ workerSrc: "/workers/pdf.worker.js", pdfjs: async () => module });
  const pdfjs = await loadPdfjs();
  assert.equal(module.GlobalWorkerOptions.workerSrc, "/workers/pdf.worker.js");
  const icons = Object.entries(pdfjs.iconUrls ?? {});
  assert.ok(icons.length > 0);
  for (const [name, url] of icons) assert.ok(url.endsWith(`/pdfjs/web/images/${name}`), url);
  assert.ok(pdfjs.scriptingUrls().module.endsWith("/pdfjs/quickjs.js"));
});
