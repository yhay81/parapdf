/**
 * Cross-origin isolation for the Vite servers of the benchmark and the demo.
 * It enables precise timers, SharedArrayBuffer, and
 * performance.measureUserAgentSpecificMemory for every engine equally.
 */
import type { Connect, Plugin } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Sends the isolation headers with every response, revalidations included.
 * Vite's `server.headers` and `preview.headers` reach only the responses
 * that carry a body: both servers answer a revalidation (the preview server
 * sends `Cache-Control: no-cache`) with a 304 without them, and WebKit then
 * refuses the module worker it had cached, "blocked by
 * Cross-Origin-Embedder-Policy", so pdf.js falls back to parsing on the main
 * thread (issue #16).
 */
export function crossOriginIsolation(): Plugin {
  const isolate: Connect.NextHandleFunction = (_request, response, next) => {
    for (const [name, value] of Object.entries(isolationHeaders)) response.setHeader(name, value);
    next();
  };
  return {
    name: "parapdf-cross-origin-isolation",
    configureServer: (server) => void server.middlewares.use(isolate),
    configurePreviewServer: (server) => void server.middlewares.use(isolate),
  };
}
