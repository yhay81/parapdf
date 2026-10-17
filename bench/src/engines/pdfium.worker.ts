import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { serve, toBitmap } from "./worker-host.ts";

// fpdfview.h render flags.
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

let module: WrappedPdfiumModule | undefined;
let doc = 0;

function pdfium(): WrappedPdfiumModule {
  if (!module) throw new Error("PDFium is not initialized");
  return module;
}

serve({
  async init() {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    module = await init({ wasmBinary });
    module.PDFiumExt_Init();
    return { result: null };
  },

  async open({ data }) {
    const m = pdfium();
    const bytes = new Uint8Array(data);
    // PDFium reads from this buffer for the document's lifetime, so it stays allocated.
    const pointer = m.pdfium.wasmExports.malloc(bytes.byteLength);
    m.pdfium.HEAPU8.set(bytes, pointer);
    doc = m.FPDF_LoadMemDocument64(pointer, bytes.byteLength, "");
    if (!doc) throw new Error(`FPDF_LoadMemDocument64 failed with error ${m.FPDF_GetLastError()}`);
    return { result: { pageCount: m.FPDF_GetPageCount(doc) } };
  },

  async pageSize({ index }) {
    const m = pdfium();
    const pointer = m.pdfium.wasmExports.malloc(8);
    try {
      if (!m.FPDF_GetPageSizeByIndexF(doc, index, pointer)) {
        throw new Error(`FPDF_GetPageSizeByIndexF failed for page ${index}`);
      }
      const floats = m.pdfium.HEAPF32;
      return { result: { width: floats[pointer >> 2], height: floats[(pointer >> 2) + 1] } };
    } finally {
      m.pdfium.wasmExports.free(pointer);
    }
  },

  async render({ index, scale }) {
    const m = pdfium();
    const start = performance.now();
    const page = m.FPDF_LoadPage(doc, index);
    if (!page) throw new Error(`FPDF_LoadPage failed for page ${index}`);
    const width = Math.floor(m.FPDF_GetPageWidthF(page) * scale);
    const height = Math.floor(m.FPDF_GetPageHeightF(page) * scale);
    const bitmap = m.FPDFBitmap_Create(width, height, 1);
    // Like pdfium_test, render pages with transparency onto a transparent
    // backdrop: soft masks and blend groups drawn onto opaque white can lose
    // their content. The browser composites the result over the white page.
    const transparent = m.FPDFPage_HasTransparency(page);
    m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, transparent ? 0x00000000 : 0xffffffff);
    // REVERSE_BYTE_ORDER makes PDFium write RGBA instead of BGRA.
    m.FPDF_RenderPageBitmap(
      bitmap,
      page,
      0,
      0,
      width,
      height,
      0,
      FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER,
    );
    const buffer = m.FPDFBitmap_GetBuffer(bitmap);
    const stride = m.FPDFBitmap_GetStride(bitmap);
    const rowBytes = width * 4;
    const pixels = new Uint8ClampedArray(rowBytes * height);
    const heap = m.pdfium.HEAPU8;
    if (stride === rowBytes) {
      pixels.set(heap.subarray(buffer, buffer + pixels.length));
    } else {
      for (let y = 0; y < height; y++) {
        const row = buffer + y * stride;
        pixels.set(heap.subarray(row, row + rowBytes), y * rowBytes);
      }
    }
    m.FPDFBitmap_Destroy(bitmap);
    m.FPDF_ClosePage(page);
    const image = await toBitmap(pixels, width, height);
    return {
      result: { bitmap: image, width, height, rasterMs: performance.now() - start },
      transfer: [image],
    };
  },

  async memory() {
    return { result: pdfium().pdfium.HEAPU8.byteLength };
  },
});
