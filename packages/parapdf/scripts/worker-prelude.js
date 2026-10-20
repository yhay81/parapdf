/*
 * ParaPDF's prelude to pdf.js's worker, which scripts/pdfjs-files.ts puts
 * before pdf.js's own code in pdfjs/pdf.worker.js. pdf.js's worker fetches
 * CMaps, standard fonts, image decoders, and ICC profiles as a directory URL
 * plus a file name, but bundlers give every file a URL of its own. ParaPDF
 * passes those URLs, by file name, as JSON in the worker script's URL
 * fragment, and requests the worker makes for one of those files go to its
 * URL. Without a fragment, as when the directory is served as it is, nothing
 * changes.
 */
{
  const hash = new URL(import.meta.url).hash;
  // Only in a worker: when pdf.js cannot start one, it runs this script on
  // the page, whose own requests stay untouched.
  if (hash && typeof WorkerGlobalScope !== "undefined") {
    const files = JSON.parse(decodeURIComponent(hash.slice(1)));
    // pdf.js names a standard font as its directory URL plus its name, and
    // ParaPDF leaves that directory unset, so it becomes "null" plus the name.
    const resolve = (url) => {
      const text = String(url);
      const name = text.slice(text.lastIndexOf("/") + 1);
      return files[name] ?? files[name.replace(/^null/, "")] ?? url;
    };
    const fetch = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      fetch(typeof input === "string" || input instanceof URL ? resolve(input) : input, init);
    // The ICC profile and the color management decoder load synchronously.
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      return open.call(this, method, resolve(url), ...rest);
    };
  }
}
