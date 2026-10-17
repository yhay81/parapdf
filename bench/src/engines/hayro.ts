import type { EngineAdapter } from "./types.ts";
import { createWorkerEngine } from "./worker-client.ts";

/** hayro (pure Rust) compiled to WebAssembly with SIMD, in a worker. */
export function createHayroEngine(): EngineAdapter {
  return createWorkerEngine(
    "hayro",
    "hayro 0.8.0 (wasm32, simd128)",
    () => new Worker(new URL("./hayro.worker.ts", import.meta.url), { type: "module" }),
  );
}
