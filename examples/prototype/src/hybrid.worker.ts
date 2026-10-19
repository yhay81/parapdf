/**
 * Worker entry of the hybrid engine. The page classifier (hayro's parser
 * without its rasterizer) loads with the worker; the hayro renderer's glue
 * and its 4 MB WebAssembly module load only when the first image-only page
 * is about to render.
 */
import { serveHybridWorker } from "parapdf/hybrid-worker";
import initClassifier, {
  PageClassifier,
} from "../../../bench/hayro-classify/pkg/hayro_classify.js";
import classifierWasm from "../../../bench/hayro-classify/pkg/hayro_classify_bg.wasm?url";
import rendererWasm from "../../../bench/hayro-wasm/pkg/hayro_wasm_bench_bg.wasm?url";

serveHybridWorker({
  async loadClassifier() {
    const { memory } = await initClassifier({ module_or_path: classifierWasm });
    return { memory, open: (data) => new PageClassifier(data) };
  },
  async loadRenderer() {
    const hayro = await import("../../../bench/hayro-wasm/pkg/hayro_wasm_bench.js");
    const { memory } = await hayro.default({ module_or_path: rendererWasm });
    return {
      memory,
      open(data) {
        const doc = new hayro.HayroDocument(data);
        return {
          render(index, scale) {
            const page = doc.render(index, scale);
            const { width, height } = page;
            return {
              width,
              height,
              // Read memory.buffer each time: it is replaced when the module's memory grows.
              view: () =>
                new Uint8ClampedArray(memory.buffer, page.pixelsPtr(), width * height * 4),
              reduce: (factor) => page.reduce(factor),
              free: () => page.free(),
            };
          },
          free: () => doc.free(),
        };
      },
    };
  },
});
