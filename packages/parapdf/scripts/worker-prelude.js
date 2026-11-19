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
  if (hash) {
    const files = Object.assign(Object.create(null), JSON.parse(decodeURIComponent(hash.slice(1))));
    // Shipped files are requested under "parapdf:/<name>" or, for standard
    // fonts whose directory ParaPDF leaves unset, "null<name>". Matching only
    // those prefixes keeps custom cMapUrl/wasmUrl overrides and, when pdf.js
    // runs its worker on the main thread under strict worker CSP, the page's
    // own requests untouched.
    const resolve = (url) => {
      const text = String(url);
      if (text.startsWith("parapdf:/")) {
        return files[text.slice("parapdf:/".length)] ?? url;
      }
      if (text.startsWith("null")) {
        return files[text.slice("null".length)] ?? url;
      }
      const nullFont = /(?:^|\/)null([^/?#]+)$/.exec(text);
      if (nullFont) {
        return files[nullFont[1]] ?? url;
      }
      return url;
    };
    const fetch = globalThis.fetch;
    if (typeof fetch === "function") {
      globalThis.fetch = (input, init) =>
        fetch(typeof input === "string" || input instanceof URL ? resolve(input) : input, init);
    }
    // The ICC profile and the color management decoder load synchronously in a worker.
    if (typeof WorkerGlobalScope !== "undefined" && typeof XMLHttpRequest === "function") {
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        return open.call(this, method, resolve(url), ...rest);
      };
    }
  }
}
