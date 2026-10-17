import initHayro, { HayroDocument } from "../../hayro-wasm/pkg/hayro_wasm_bench.js";
import wasmUrl from "../../hayro-wasm/pkg/hayro_wasm_bench_bg.wasm?url";
import { serve, toBitmap } from "./worker-host.ts";

let memory: WebAssembly.Memory | undefined;
let doc: HayroDocument | undefined;

function ready(): HayroDocument {
  if (!doc) throw new Error("hayro document is not open");
  return doc;
}

serve({
  async init() {
    const exports = await initHayro({ module_or_path: wasmUrl });
    memory = exports.memory;
    return { result: null };
  },

  async open({ data }) {
    doc = new HayroDocument(new Uint8Array(data));
    return { result: { pageCount: doc.pageCount() } };
  },

  async pageSize({ index }) {
    const [width, height] = ready().pageSize(index);
    return { result: { width, height } };
  },

  async render({ index, scale }) {
    const start = performance.now();
    const page = ready().render(index, scale);
    const { width, height } = page;
    const bytes = page.take_pixels();
    page.free();
    // wasm-bindgen copies the pixels into a fresh, non-shared ArrayBuffer.
    const pixels = new Uint8ClampedArray(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const image = await toBitmap(pixels, width, height);
    return {
      result: { bitmap: image, width, height, rasterMs: performance.now() - start },
      transfer: [image],
    };
  },

  async memory() {
    return { result: memory?.buffer.byteLength };
  },
});
