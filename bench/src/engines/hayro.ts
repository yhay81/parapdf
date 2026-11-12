import type { EngineAdapter } from "./types.ts";
import { createWorkerEngine } from "./worker-client.ts";

/** Installed engine version embedded by Vite when building the harness. */
declare const HAYRO_VERSION: string;

/** hayro (pure Rust) compiled to WebAssembly with SIMD, in a worker. */
export function createHayroEngine(): EngineAdapter {
  return createWorkerEngine(
    "hayro",
    `hayro ${HAYRO_VERSION} (wasm32, simd128)`,
    () => new Worker(new URL("./hayro.worker.ts", import.meta.url), { type: "module" }),
  );
}
