// pdf.js's sandbox, which pdfjs-dist ships without types (src/pdfjs/scripting.ts).
declare module "pdfjs-dist/build/pdf.sandbox.min.mjs" {
  export function QuickJSSandbox(wasmUrl: string): Promise<unknown>;
}
